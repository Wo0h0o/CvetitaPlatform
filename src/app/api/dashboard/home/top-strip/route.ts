import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  sofiaDate,
  sofiaHoursElapsed,
  shiftDate,
  resolveDateWindow,
  type DateWindow,
  type DateWindowPreset,
} from "@/lib/sofia-date";
import {
  pickSeriesKind,
  expandRange,
  cumulative,
  averageHourly,
  nowIndexForToday,
  weeklyBucketize,
  type SeriesKind,
  type SeriesShape,
} from "@/lib/series";
import { resolveAllHomeMarkets } from "@/lib/store-market-resolver";
import { EARLY_DAY_THRESHOLD_HOURS } from "@/components/dashboard/store-state";
import { fetchGoogleAdsByDateAllMarkets, sumGoogleAds } from "@/lib/google-ads-by-date";

// ============================================================
// Public response contract
// ============================================================

interface TempoMetric {
  /**
   * Aggregate value over the selected window. For preset=today this is the
   * running total so far today; for other presets it is the sum over the
   * entire window.
   */
  value: number;
  /**
   * Percentage delta vs comparison baseline.
   *   - preset=today / yesterday: matched-hour portion of average across the
   *     last 4 same-weekdays (today) or the same hours of those weekdays
   *     (yesterday — same baseline data, used as a full-day comparison).
   *   - other presets: equal-length immediately-preceding period.
   * null when the baseline is unavailable. Clamped to ±999.
   */
  vsTypical: number | null;
  /**
   * Linear extrapolation to end-of-day. Only meaningful for preset=today;
   * always null for other presets.
   */
  projected: number | null;
}

/**
 * Top-strip splits into two internally-composable sections plus a
 * cross-platform overlay. Each section's numbers add up among themselves.
 *
 *   business     — what happened on the store (Shopify truth)
 *   ads          — what Meta did (Meta attribution)
 *   googleAds    — Google Ads via GA4 (last-click)
 *   crossPlatform — composites that blend all three
 *
 * The `series` block carries one chart-ready SeriesShape per card. Its
 * `kind` discriminates how the UI labels the x-axis: "hourly" buckets the
 * 24 hours of a single day (today/yesterday), "daily" plots N daily
 * values (7d/30d/short customs), "weekly" plots N/7 week-ending values
 * (90d/long customs, mobile-friendly).
 */
interface TopStripResponse {
  mode: "today" | "range";
  window: {
    from: string;
    to: string;
    preset: DateWindowPreset;
    days: number;
  };
  business: {
    revenue: TempoMetric;
    orders: TempoMetric;
    aov: { value: number };
  };
  ads: {
    spend: TempoMetric;
    roas: { value: number };
    attribution: {
      pct: number | null;
      metaRevenue: number;
      shopifyRevenue: number;
    };
  };
  googleAds: {
    spend: TempoMetric;
    roas: { value: number };
    purchases: TempoMetric;
  } | null;
  crossPlatform: {
    cac: TempoMetric;
    netAfterAds: TempoMetric;
    channelMix: {
      meta: { revenue: number; pct: number };
      googleAds: { revenue: number; pct: number };
      mixed: { revenue: number; pct: number };
      other: { revenue: number; pct: number };
      shopifyRevenue: number;
    };
  };
  series: {
    business: {
      revenue: SeriesShape;
      orders: SeriesShape;
      aov: SeriesShape;
    };
    ads: {
      spend: SeriesShape;
      roas: SeriesShape;
      attribution: SeriesShape;
    };
    googleAds: {
      spend: SeriesShape;
      roas: SeriesShape;
      purchases: SeriesShape;
    } | null;
    crossPlatform: {
      cac: SeriesShape;
      netAfterAds: SeriesShape;
    };
  };
  anomalyCount: number;
  freshAsOf: string;
}

// ============================================================
// Daily aggregation primitives (unchanged contract)
// ============================================================

interface DailyAggRow {
  order_date: string;
  total_revenue: number | string | null;
  total_orders: number | string | null;
}

interface HourlyAggRow {
  order_date: string;
  hour: number;
  total_revenue: number | string | null;
  total_orders: number | string | null;
}

interface MetaDayRow {
  date: string;
  spend: number | string | null;
  revenue: number | string | null;
  purchases: number | string | null;
  fetched_at: string | null;
}

interface MetaHourlyRow {
  date: string;
  hour: number;
  spend: number | string | null;
  revenue: number | string | null;
  purchases: number | string | null;
  fetched_at: string | null;
}

type ShopifyDaily = { revenue: number; orders: number };
type ShopifyHourly = ShopifyDaily; // same shape per (date, hour)
type MetaDaily = { spend: number; revenue: number; purchases: number };
type MetaHourly = MetaDaily;
type GaDaily = { spend: number; revenue: number; purchases: number };

const num = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
};

// ============================================================
// Shopify fetchers (daily + hourly)
// ============================================================

async function fetchShopifyByDate(
  dates: string[]
): Promise<Map<string, ShopifyDaily>> {
  const markets = await resolveAllHomeMarkets();
  const schemas = markets.map((m) => `store_${m.marketCode}`);

  const perSchema = await Promise.all(
    schemas.map(async (schema) => {
      const { data, error } = await supabaseAdmin.rpc(
        "read_store_daily_aggregates",
        { p_schema: schema, p_dates: dates }
      );
      if (error) {
        logger.error("top-strip: shopify daily fetch failed", {
          schema,
          error: error.message,
        });
        return [] as DailyAggRow[];
      }
      return (data ?? []) as DailyAggRow[];
    })
  );

  const byDate = new Map<string, ShopifyDaily>();
  for (const rows of perSchema) {
    for (const r of rows) {
      const bucket = byDate.get(r.order_date) ?? { revenue: 0, orders: 0 };
      bucket.revenue += num(r.total_revenue);
      bucket.orders += num(r.total_orders);
      byDate.set(r.order_date, bucket);
    }
  }
  return byDate;
}

/**
 * Returns per-(date, hour) Shopify aggregates summed across schemas. Key
 * is `${date}|${hour}` for fast lookups; converted into per-date 24-arrays
 * in `buildHourlyArrayMap` below.
 */
async function fetchShopifyHourlyByDates(
  dates: string[]
): Promise<Map<string, ShopifyHourly>> {
  const markets = await resolveAllHomeMarkets();
  const schemas = markets.map((m) => `store_${m.marketCode}`);

  const perSchema = await Promise.all(
    schemas.map(async (schema) => {
      const { data, error } = await supabaseAdmin.rpc(
        "read_store_hourly_aggregates_multi",
        { p_schema: schema, p_dates: dates }
      );
      if (error) {
        logger.error("top-strip: shopify hourly fetch failed", {
          schema,
          error: error.message,
        });
        return [] as HourlyAggRow[];
      }
      return (data ?? []) as HourlyAggRow[];
    })
  );

  const byKey = new Map<string, ShopifyHourly>();
  for (const rows of perSchema) {
    for (const r of rows) {
      const key = `${r.order_date}|${r.hour}`;
      const bucket = byKey.get(key) ?? { revenue: 0, orders: 0 };
      bucket.revenue += num(r.total_revenue);
      bucket.orders += num(r.total_orders);
      byKey.set(key, bucket);
    }
  }
  return byKey;
}

/**
 * Pivot a (date|hour) keyed map into one 24-element array per date.
 *
 * CRITICAL: dates with ZERO source records are EXCLUDED from the output.
 * The downstream `averageHourly` averages by `priors.length` — without
 * this guard, a missing prior day (e.g. before our backfill horizon)
 * becomes a 24-array of zeros and silently drags the typical baseline
 * DOWN, because the averager treats "no data" as "real day with zero
 * activity". For Meta especially, those are different stories: zero
 * spend means we DID look and there was no ad activity; zero rows means
 * we DID NOT look (date is outside the sync window).
 *
 * Shopify is asymmetric: its hourly RPC zero-fills via generate_series,
 * so EVERY (date, hour) requested comes back with a row. Zero orders
 * on a Shopify prior is real data. The guard below uses `byKey.has(...)`,
 * not the row's values — so Shopify priors with all-zero activity STILL
 * pass (`has` returns true; the row is just `{revenue: 0, orders: 0}`).
 * Only Meta priors with literally no entries are dropped.
 */
function buildHourlyArrayMap<T extends Record<string, number>>(
  byKey: Map<string, T>,
  dates: string[],
  fields: (keyof T)[]
): Map<string, Record<string, number[]>> {
  const out = new Map<string, Record<string, number[]>>();
  for (const date of dates) {
    let hasAny = false;
    for (let h = 0; h < 24; h++) {
      if (byKey.has(`${date}|${h}`)) {
        hasAny = true;
        break;
      }
    }
    if (!hasAny) continue;

    const perField: Record<string, number[]> = {};
    for (const f of fields) perField[f as string] = new Array(24).fill(0);
    for (let h = 0; h < 24; h++) {
      const row = byKey.get(`${date}|${h}`);
      if (!row) continue;
      for (const f of fields) {
        perField[f as string][h] = row[f] ?? 0;
      }
    }
    out.set(date, perField);
  }
  return out;
}

// ============================================================
// Meta fetchers (daily + hourly)
// ============================================================

async function fetchMetaByDate(
  dates: string[]
): Promise<{ byDate: Map<string, MetaDaily>; latestFetched: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("meta_insights_by_store")
    .select("date, spend, revenue, purchases, fetched_at")
    .eq("level", "account")
    .in("date", dates);

  if (error) {
    logger.error("top-strip: meta daily fetch failed", { error: error.message });
    return { byDate: new Map(), latestFetched: null };
  }

  const rows = (data ?? []) as MetaDayRow[];
  const byDate = new Map<string, MetaDaily>();
  let latestFetched: string | null = null;
  for (const r of rows) {
    const bucket = byDate.get(r.date) ?? { spend: 0, revenue: 0, purchases: 0 };
    bucket.spend += num(r.spend);
    bucket.revenue += num(r.revenue);
    bucket.purchases += num(r.purchases);
    byDate.set(r.date, bucket);
    if (r.fetched_at && (!latestFetched || r.fetched_at > latestFetched)) {
      latestFetched = r.fetched_at;
    }
  }
  return { byDate, latestFetched };
}

async function fetchMetaHourlyByDates(
  dates: string[]
): Promise<{ byKey: Map<string, MetaHourly>; latestFetched: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("meta_insights_hourly_by_store")
    .select("date, hour, spend, revenue, purchases, fetched_at")
    .in("date", dates);

  if (error) {
    logger.error("top-strip: meta hourly fetch failed", { error: error.message });
    return { byKey: new Map(), latestFetched: null };
  }

  const rows = (data ?? []) as MetaHourlyRow[];
  const byKey = new Map<string, MetaHourly>();
  let latestFetched: string | null = null;
  for (const r of rows) {
    const key = `${r.date}|${r.hour}`;
    const bucket = byKey.get(key) ?? { spend: 0, revenue: 0, purchases: 0 };
    bucket.spend += num(r.spend);
    bucket.revenue += num(r.revenue);
    bucket.purchases += num(r.purchases);
    byKey.set(key, bucket);
    if (r.fetched_at && (!latestFetched || r.fetched_at > latestFetched)) {
      latestFetched = r.fetched_at;
    }
  }
  return { byKey, latestFetched };
}

// ============================================================
// Tempo math (unchanged)
// ============================================================

function buildTodayTempo<F extends string>(
  todayValue: number,
  priors: Array<Record<F, number>>,
  field: F,
  hoursElapsed: number
): TempoMetric {
  if (hoursElapsed < EARLY_DAY_THRESHOLD_HOURS || priors.length === 0) {
    return { value: todayValue, vsTypical: null, projected: null };
  }
  const typ = priors.reduce((acc, p) => acc + p[field], 0) / priors.length;
  if (typ === 0) {
    return { value: todayValue, vsTypical: null, projected: null };
  }
  const matchedSoFar = typ * (hoursElapsed / 24);
  const vsTypicalRaw = Math.round(((todayValue - matchedSoFar) / matchedSoFar) * 100);
  const vsTypical = Math.max(-999, Math.min(999, vsTypicalRaw));
  const projected = Math.round(todayValue / (hoursElapsed / 24));
  return { value: todayValue, vsTypical, projected };
}

function buildRangeTempo(current: number, previous: number): TempoMetric {
  if (previous === 0) {
    return { value: current, vsTypical: null, projected: null };
  }
  const raw = Math.round(((current - previous) / previous) * 100);
  const vsTypical = Math.max(-999, Math.min(999, raw));
  return { value: current, vsTypical, projected: null };
}

function sumMeta(byDate: Map<string, MetaDaily>, dates: string[]): MetaDaily {
  const out: MetaDaily = { spend: 0, revenue: 0, purchases: 0 };
  for (const d of dates) {
    const row = byDate.get(d);
    if (!row) continue;
    out.spend += row.spend;
    out.revenue += row.revenue;
    out.purchases += row.purchases;
  }
  return out;
}

function sumShopify(byDate: Map<string, ShopifyDaily>, dates: string[]): ShopifyDaily {
  const out: ShopifyDaily = { revenue: 0, orders: 0 };
  for (const d of dates) {
    const row = byDate.get(d);
    if (!row) continue;
    out.revenue += row.revenue;
    out.orders += row.orders;
  }
  return out;
}

// ============================================================
// Series builders
// ============================================================

const HOUR_LABELS: string[] = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0")
);

/**
 * Build the SeriesShape for a single metric in HOURLY mode.
 *
 * `currentHourly` is the 24-element raw per-hour series for the target
 * day; `priorHourlies` are the same shape for the comparison days. The
 * function cumulates both, masks current values past `nowIndex` (today
 * mode), and emits ready-to-render arrays sharing the 00-23 x-axis.
 *
 * `agg` controls how the typical baseline averages priors:
 *   "sum"  — additive metrics (revenue, orders, spend). Sum per hour
 *            across priors, then divide by count; cumulate.
 *   "ratio" — derived metrics (ROAS, AOV, attribution). The per-hour
 *             ratio is computed from the cumulated numerator/denominator
 *             — we ask the caller to pass pre-cumulated arrays via the
 *             `cumulatedRatio` factory below. This branch is unused
 *             directly; the route calls `buildHourlyRatioSeries` instead.
 */
function buildHourlySumSeries(
  currentHourly: number[],
  priorHourlies: number[][],
  nowIdx: number | undefined
): SeriesShape {
  const typicalRaw = averageHourly(priorHourlies);
  const currentCum = cumulative(currentHourly);
  const typicalCum = typicalRaw ? cumulative(typicalRaw) : null;

  // When today, blank out future hours so the area chart doesn't draw
  // a flat horizontal line at the running total to hour 23 (the cumulative
  // function would otherwise carry the last value forward). We render
  // the value only through `nowIndex` and let the comparison line continue
  // full-day. Yesterday + earlier days have nowIdx undefined → no masking.
  if (nowIdx !== undefined) {
    for (let h = nowIdx + 1; h < 24; h++) {
      currentCum[h] = currentCum[nowIdx]; // hold the last value; UI hides via nowIndex
    }
  }

  return {
    kind: "hourly",
    labels: HOUR_LABELS,
    current: currentCum,
    comparison: typicalCum,
    nowIndex: nowIdx,
  };
}

/**
 * Hourly ratio series — used for AOV / ROAS / attribution. Computed from
 * the cumulated numerator/denominator pair (not from per-hour ratios)
 * so the trace stays smooth and the endpoint matches the headline
 * aggregate exactly.
 *
 * numerator/denominator arrays are RAW per-hour values (not cumulative).
 * Result divides per-hour cumulated num by cumulated denom, with 0
 * fallback when denom = 0 (hours before any activity).
 */
function buildHourlyRatioSeries(
  currentNum: number[],
  currentDenom: number[],
  priorNum: number[][],
  priorDenom: number[][],
  nowIdx: number | undefined,
  percentScale = false
): SeriesShape {
  const cur = ratioFromCumulated(cumulative(currentNum), cumulative(currentDenom), percentScale);

  let comparison: number[] | null = null;
  if (priorNum.length > 0 && priorNum.length === priorDenom.length) {
    // Average prior-day numerators and denominators per hour, then ratio.
    // Averaging the ratios directly would over-weight low-volume hours
    // (a 5% day and a 95% day average to 50%, not the true mean).
    const numAvg = averageHourly(priorNum);
    const denomAvg = averageHourly(priorDenom);
    if (numAvg && denomAvg) {
      comparison = ratioFromCumulated(cumulative(numAvg), cumulative(denomAvg), percentScale);
    }
  }

  if (nowIdx !== undefined) {
    for (let h = nowIdx + 1; h < 24; h++) cur[h] = cur[nowIdx];
  }

  return {
    kind: "hourly",
    labels: HOUR_LABELS,
    current: cur,
    comparison,
    nowIndex: nowIdx,
  };
}

function ratioFromCumulated(
  cumNum: number[],
  cumDenom: number[],
  percent: boolean
): number[] {
  const out: number[] = [];
  for (let i = 0; i < cumNum.length; i++) {
    const d = cumDenom[i];
    const r = d > 0 ? cumNum[i] / d : 0;
    out.push(Number((percent ? r * 100 : r).toFixed(2)));
  }
  return out;
}

/**
 * Build the SeriesShape for a single metric in DAILY or WEEKLY mode.
 * Caller passes the per-day current + comparison value arrays plus the
 * matching date list (oldest first). Weekly kind triggers bucketization.
 */
function buildRangeSeries(
  kind: Exclude<SeriesKind, "hourly">,
  dates: string[],
  current: number[],
  comparison: number[] | null,
  agg: "sum" | "mean"
): SeriesShape {
  if (kind === "daily") {
    return {
      kind: "daily",
      labels: dates,
      current: current.map((v) => Number(v.toFixed(2))),
      comparison: comparison ? comparison.map((v) => Number(v.toFixed(2))) : null,
    };
  }

  // weekly bucketization
  const curBuckets = weeklyBucketize(dates, current, agg);
  let cmpBuckets: number[] | null = null;
  if (comparison) {
    // Comparison uses the same week-ending convention but anchored on its
    // own to-date — we just bucket it the same way and trust the chart to
    // align by INDEX (week-of-window), not by calendar week.
    const cmpDates = dates.map((_, i) => `cmp-${i}`); // synthetic labels, never shown
    cmpBuckets = weeklyBucketize(cmpDates, comparison, agg).values;
  }

  return {
    kind: "weekly",
    labels: curBuckets.labels,
    current: curBuckets.values,
    comparison: cmpBuckets,
    partial: curBuckets.partial,
  };
}

/**
 * Build channelMix composition — same math as before. Returns a snapshot,
 * no series counterpart (composition tile renders as a stacked bar).
 */
function buildChannelMix(
  shopifyRevenue: number,
  metaRevenue: number,
  googleAdsRevenue: number
): TopStripResponse["crossPlatform"]["channelMix"] {
  const total = shopifyRevenue > 0 ? shopifyRevenue : 1;
  const mixedRev = Math.max(0, metaRevenue + googleAdsRevenue - shopifyRevenue);
  const metaUnique = Math.max(0, metaRevenue - mixedRev);
  const googleUnique = Math.max(0, googleAdsRevenue - mixedRev);
  const otherRev = Math.max(0, shopifyRevenue - metaUnique - googleUnique - mixedRev);

  const pct = (rev: number) => Math.round((rev / total) * 100);
  const pcts = {
    meta: pct(metaUnique),
    googleAds: pct(googleUnique),
    mixed: pct(mixedRev),
    other: pct(otherRev),
  };
  const sum = pcts.meta + pcts.googleAds + pcts.mixed + pcts.other;
  if (sum !== 100 && shopifyRevenue > 0) {
    const drift = 100 - sum;
    const largestKey = (Object.keys(pcts) as (keyof typeof pcts)[]).reduce((a, b) =>
      pcts[a] >= pcts[b] ? a : b
    );
    pcts[largestKey] += drift;
  }

  return {
    meta: { revenue: metaUnique, pct: pcts.meta },
    googleAds: { revenue: googleUnique, pct: pcts.googleAds },
    mixed: { revenue: mixedRev, pct: pcts.mixed },
    other: { revenue: otherRev, pct: pcts.other },
    shopifyRevenue,
  };
}

// ============================================================
// Hourly mode (preset = today / yesterday)
// ============================================================

/**
 * "Hourly mode" = a single day in view, charts show 0-24h cumulative.
 *
 * Date set:
 *   target = window.from (== window.to in today / yesterday presets)
 *   priors = 4 same-weekdays before target (7, 14, 21, 28 days back)
 *
 * Headline numbers use the same matched-hour pacing as before. Charts use
 * the new hourly fetchers and feed buildHourlySumSeries / RatioSeries.
 */
async function handleHourly(
  window: DateWindow,
  now: Date,
  anomalyCount: number
): Promise<TopStripResponse> {
  const targetDate = window.from;
  const priorDates = [7, 14, 21, 28].map((n) => shiftDate(targetDate, n));
  const allDates = [targetDate, ...priorDates];

  // Daily fetches still drive the headline TempoMetric arithmetic — same
  // formulas as the previous implementation, no regression.
  const [
    { byDate: metaDaily, latestFetched: metaDailyFresh },
    shopifyDaily,
    googleAdsDaily,
    shopifyHourlyByKey,
    { byKey: metaHourlyByKey, latestFetched: metaHourlyFresh },
  ] = await Promise.all([
    fetchMetaByDate(allDates),
    fetchShopifyByDate(allDates),
    fetchGoogleAdsByDateAllMarkets(allDates),
    fetchShopifyHourlyByDates(allDates),
    fetchMetaHourlyByDates(allDates),
  ]);

  const hoursElapsed = window.preset === "today" ? sofiaHoursElapsed(now) : 24;
  const nowIdx =
    window.preset === "today" ? nowIndexForToday(true) : undefined;

  // -- Daily snapshots for headline numbers ----------------------
  const shoToday = shopifyDaily.get(targetDate) ?? { revenue: 0, orders: 0 };
  const metaToday = metaDaily.get(targetDate) ?? { spend: 0, revenue: 0, purchases: 0 };
  const gaToday = googleAdsDaily.get(targetDate);
  const safeGaToday = gaToday ?? { spend: 0, revenue: 0, purchases: 0 };

  const shoPriors = priorDates
    .map((d) => shopifyDaily.get(d))
    .filter((x): x is ShopifyDaily => !!x);
  const metaPriors = priorDates
    .map((d) => metaDaily.get(d))
    .filter((x): x is MetaDaily => !!x);
  const gaPriors = priorDates
    .map((d) => googleAdsDaily.get(d))
    .filter((x): x is GaDaily => !!x);

  // Headline TempoMetrics
  const businessRevenue = buildTodayTempo(shoToday.revenue, shoPriors, "revenue", hoursElapsed);
  const businessOrders = buildTodayTempo(shoToday.orders, shoPriors, "orders", hoursElapsed);
  const aov = {
    value: businessOrders.value > 0
      ? Number((businessRevenue.value / businessOrders.value).toFixed(2))
      : 0,
  };

  const metaSpend = buildTodayTempo(metaToday.spend, metaPriors, "spend", hoursElapsed);
  const metaRevenue = buildTodayTempo(metaToday.revenue, metaPriors, "revenue", hoursElapsed);
  const roas = {
    value: metaSpend.value > 0
      ? Math.min(99.99, Number((metaRevenue.value / metaSpend.value).toFixed(2)))
      : 0,
  };
  const attributionPct = businessRevenue.value > 0
    ? Math.min(100, Math.round((metaRevenue.value / businessRevenue.value) * 100))
    : null;

  let googleAdsSection: TopStripResponse["googleAds"] = null;
  if (gaToday || gaPriors.length > 0) {
    const gaSpend = buildTodayTempo(safeGaToday.spend, gaPriors, "spend", hoursElapsed);
    const gaPurchases = buildTodayTempo(safeGaToday.purchases, gaPriors, "purchases", hoursElapsed);
    const gaRoas = {
      value: safeGaToday.spend > 0
        ? Math.min(99.99, Number((safeGaToday.revenue / safeGaToday.spend).toFixed(2)))
        : 0,
    };
    googleAdsSection = { spend: gaSpend, roas: gaRoas, purchases: gaPurchases };
  }

  // Cross-platform headlines — keep includesGoogle behaviour: CAC and
  // netAfterAds use total_spend (Meta + GA) even in hourly mode, because
  // those are the truthful end-of-day figures. The charts intentionally
  // only show Shopify − Meta (no hourly GA source) — the gap between
  // chart endpoint and headline equals today's GA spend, which is small
  // and surfaced via subText on the UI side.
  const totalSpendToday = metaToday.spend + safeGaToday.spend;
  const cacToday = shoToday.orders > 0 ? totalSpendToday / shoToday.orders : 0;
  const cacPriors = priorDates
    .map((d) => {
      const sho = shopifyDaily.get(d);
      const m = metaDaily.get(d);
      const g = googleAdsDaily.get(d);
      if (!sho || sho.orders === 0) return null;
      return { cac: ((m?.spend ?? 0) + (g?.spend ?? 0)) / sho.orders };
    })
    .filter((x): x is { cac: number } => !!x);
  const cacTempo = buildTodayTempo(cacToday, cacPriors, "cac", hoursElapsed);

  const netToday = shoToday.revenue - totalSpendToday;
  const netPriors = priorDates
    .map((d) => {
      const sho = shopifyDaily.get(d);
      const m = metaDaily.get(d);
      const g = googleAdsDaily.get(d);
      if (!sho && !m && !g) return null;
      return { net: (sho?.revenue ?? 0) - (m?.spend ?? 0) - (g?.spend ?? 0) };
    })
    .filter((x): x is { net: number } => !!x);
  const netTempo = buildTodayTempo(netToday, netPriors, "net", hoursElapsed);

  const channelMix = buildChannelMix(
    shoToday.revenue,
    metaToday.revenue,
    safeGaToday.revenue
  );

  // -- Hourly arrays for chart series ----------------------------
  const shoHourly = buildHourlyArrayMap(shopifyHourlyByKey, allDates, ["revenue", "orders"]);
  const metaHourly = buildHourlyArrayMap(metaHourlyByKey, allDates, [
    "spend",
    "revenue",
    "purchases",
  ]);

  const shoToday24 = shoHourly.get(targetDate) ?? { revenue: zero24(), orders: zero24() };
  const metaToday24 = metaHourly.get(targetDate) ?? {
    spend: zero24(), revenue: zero24(), purchases: zero24(),
  };

  const shoPriors24 = priorDates
    .map((d) => shoHourly.get(d))
    .filter((x): x is Record<string, number[]> => !!x);
  const metaPriors24 = priorDates
    .map((d) => metaHourly.get(d))
    .filter((x): x is Record<string, number[]> => !!x);

  // Sum-style series
  const businessRevenueSeries = buildHourlySumSeries(
    shoToday24.revenue,
    shoPriors24.map((p) => p.revenue),
    nowIdx
  );
  const businessOrdersSeries = buildHourlySumSeries(
    shoToday24.orders,
    shoPriors24.map((p) => p.orders),
    nowIdx
  );
  const metaSpendSeries = buildHourlySumSeries(
    metaToday24.spend,
    metaPriors24.map((p) => p.spend),
    nowIdx
  );

  // Ratio series — AOV, ROAS, attribution. Each is derived from cumulated
  // pairs so the chart endpoint exactly equals the headline aggregate.
  const aovSeries = buildHourlyRatioSeries(
    shoToday24.revenue, shoToday24.orders,
    shoPriors24.map((p) => p.revenue), shoPriors24.map((p) => p.orders),
    nowIdx
  );
  const roasSeries = buildHourlyRatioSeries(
    metaToday24.revenue, metaToday24.spend,
    metaPriors24.map((p) => p.revenue), metaPriors24.map((p) => p.spend),
    nowIdx
  );
  const attributionSeries = buildHourlyRatioSeries(
    metaToday24.revenue, shoToday24.revenue,
    metaPriors24.map((p) => p.revenue), shoPriors24.map((p) => p.revenue),
    nowIdx,
    true  // percent scale
  );

  // CAC + netAfterAds — Shopify − Meta only at hourly resolution (no
  // GA hourly source). See the headline comment above.
  const cacNumHourly = metaToday24.spend.slice();          // numerator = Meta spend
  const cacDenomHourly = shoToday24.orders.slice();        // denominator = orders
  const cacNumPriors = metaPriors24.map((p) => p.spend);
  const cacDenomPriors = shoPriors24.map((p) => p.orders);
  const cacSeries = buildHourlyRatioSeries(
    cacNumHourly, cacDenomHourly, cacNumPriors, cacDenomPriors, nowIdx
  );

  // netAfterAds — per-hour Shopify revenue minus Meta spend, cumulated.
  // Use sum series (additive), not ratio. We build a synthetic raw array.
  const netRawHourly: number[] = shoToday24.revenue.map(
    (r, h) => r - metaToday24.spend[h]
  );
  const netRawPriors: number[][] = priorDates
    .map((d) => {
      const sho = shoHourly.get(d);
      const m = metaHourly.get(d);
      if (!sho || !m) return null;
      return sho.revenue.map((r, h) => r - m.spend[h]);
    })
    .filter((x): x is number[] => x !== null);
  const netSeries = buildHourlySumSeries(netRawHourly, netRawPriors, nowIdx);

  const freshAsOf = pickFreshest(metaHourlyFresh, metaDailyFresh) ?? now.toISOString();

  return {
    mode: "today",
    window: {
      from: window.from, to: window.to, preset: window.preset, days: window.days,
    },
    business: { revenue: businessRevenue, orders: businessOrders, aov },
    ads: {
      spend: metaSpend,
      roas,
      attribution: {
        pct: attributionPct,
        metaRevenue: metaRevenue.value,
        shopifyRevenue: businessRevenue.value,
      },
    },
    googleAds: googleAdsSection,
    crossPlatform: {
      cac: cacTempo,
      netAfterAds: netTempo,
      channelMix,
    },
    series: {
      business: {
        revenue: businessRevenueSeries,
        orders: businessOrdersSeries,
        aov: aovSeries,
      },
      ads: {
        spend: metaSpendSeries,
        roas: roasSeries,
        attribution: attributionSeries,
      },
      // No Google Ads hourly source — section's chart slot is null. UI
      // continues to render the section header + headline numbers from
      // the daily TempoMetric above, just without a chart on each tile.
      googleAds: null,
      crossPlatform: {
        cac: cacSeries,
        netAfterAds: netSeries,
      },
    },
    anomalyCount,
    freshAsOf,
  };
}

const zero24 = (): number[] => new Array(24).fill(0);

function pickFreshest(...candidates: (string | null)[]): string | null {
  let best: string | null = null;
  for (const c of candidates) {
    if (c && (!best || c > best)) best = c;
  }
  return best;
}

// ============================================================
// Range mode (preset = 7d / 30d / 90d / custom / yesterday-fallback)
// ============================================================

async function handleRange(
  window: DateWindow,
  kind: Exclude<SeriesKind, "hourly">,
  now: Date,
  anomalyCount: number
): Promise<TopStripResponse> {
  const windowDates = expandRange(window.from, window.to);
  const comparisonDates = expandRange(window.compFrom, window.compTo);
  const datesToFetch = Array.from(new Set([...windowDates, ...comparisonDates]));

  const [
    { byDate: metaByDate, latestFetched },
    shopifyByDate,
    googleAdsByDate,
  ] = await Promise.all([
    fetchMetaByDate(datesToFetch),
    fetchShopifyByDate(datesToFetch),
    fetchGoogleAdsByDateAllMarkets(datesToFetch),
  ]);

  // -- Aggregate snapshots (current vs prior period) ---------
  const metaCurrent = sumMeta(metaByDate, windowDates);
  const metaPrev = sumMeta(metaByDate, comparisonDates);
  const shoCurrent = sumShopify(shopifyByDate, windowDates);
  const shoPrev = sumShopify(shopifyByDate, comparisonDates);
  const gaCurrent = sumGoogleAds(googleAdsByDate, windowDates);
  const gaPrev = sumGoogleAds(googleAdsByDate, comparisonDates);

  const metaSpend = buildRangeTempo(metaCurrent.spend, metaPrev.spend);
  const roas = {
    value: metaCurrent.spend > 0
      ? Math.min(99.99, Number((metaCurrent.revenue / metaCurrent.spend).toFixed(2)))
      : 0,
  };
  const businessRevenue = buildRangeTempo(shoCurrent.revenue, shoPrev.revenue);
  const businessOrders = buildRangeTempo(shoCurrent.orders, shoPrev.orders);
  const aov = {
    value: shoCurrent.orders > 0
      ? Number((shoCurrent.revenue / shoCurrent.orders).toFixed(2))
      : 0,
  };
  const attributionPct = shoCurrent.revenue > 0
    ? Math.min(100, Math.round((metaCurrent.revenue / shoCurrent.revenue) * 100))
    : null;

  let googleAdsSection: TopStripResponse["googleAds"] = null;
  if (gaCurrent.spend > 0 || gaPrev.spend > 0) {
    const gaSpend = buildRangeTempo(gaCurrent.spend, gaPrev.spend);
    const gaPurchases = buildRangeTempo(gaCurrent.purchases, gaPrev.purchases);
    const gaRoas = {
      value: gaCurrent.spend > 0
        ? Math.min(99.99, Number((gaCurrent.revenue / gaCurrent.spend).toFixed(2)))
        : 0,
    };
    googleAdsSection = { spend: gaSpend, roas: gaRoas, purchases: gaPurchases };
  }

  const totalSpendCurrent = metaCurrent.spend + gaCurrent.spend;
  const totalSpendPrev = metaPrev.spend + gaPrev.spend;
  const cacCurrent = shoCurrent.orders > 0 ? totalSpendCurrent / shoCurrent.orders : 0;
  const cacPrev = shoPrev.orders > 0 ? totalSpendPrev / shoPrev.orders : 0;
  const netCurrent = shoCurrent.revenue - totalSpendCurrent;
  const netPrev = shoPrev.revenue - totalSpendPrev;
  const channelMix = buildChannelMix(shoCurrent.revenue, metaCurrent.revenue, gaCurrent.revenue);

  // -- Per-day arrays for series (current + comparison) ------
  const shoCurDaily = windowDates.map((d) => shopifyByDate.get(d) ?? { revenue: 0, orders: 0 });
  const shoCmpDaily = comparisonDates.map((d) => shopifyByDate.get(d) ?? { revenue: 0, orders: 0 });
  const metaCurDaily = windowDates.map((d) => metaByDate.get(d) ?? { spend: 0, revenue: 0, purchases: 0 });
  const metaCmpDaily = comparisonDates.map((d) => metaByDate.get(d) ?? { spend: 0, revenue: 0, purchases: 0 });
  const gaCurDaily = windowDates.map((d) => googleAdsByDate.get(d) ?? { spend: 0, revenue: 0, purchases: 0 });
  const gaCmpDaily = comparisonDates.map((d) => googleAdsByDate.get(d) ?? { spend: 0, revenue: 0, purchases: 0 });

  const revenueSeries = buildRangeSeries(kind, windowDates,
    shoCurDaily.map((r) => r.revenue), shoCmpDaily.map((r) => r.revenue), "sum");
  const ordersSeries = buildRangeSeries(kind, windowDates,
    shoCurDaily.map((r) => r.orders), shoCmpDaily.map((r) => r.orders), "sum");
  const aovSeries = buildRangeSeries(kind, windowDates,
    shoCurDaily.map((r) => (r.orders > 0 ? r.revenue / r.orders : 0)),
    shoCmpDaily.map((r) => (r.orders > 0 ? r.revenue / r.orders : 0)),
    "mean");

  const spendSeries = buildRangeSeries(kind, windowDates,
    metaCurDaily.map((r) => r.spend), metaCmpDaily.map((r) => r.spend), "sum");
  const roasSeriesShape = buildRangeSeries(kind, windowDates,
    metaCurDaily.map((r) => (r.spend > 0 ? r.revenue / r.spend : 0)),
    metaCmpDaily.map((r) => (r.spend > 0 ? r.revenue / r.spend : 0)),
    "mean");
  const attributionSeries = buildRangeSeries(kind, windowDates,
    windowDates.map((d) => {
      const sho = shopifyByDate.get(d);
      const m = metaByDate.get(d);
      return sho && sho.revenue > 0 ? ((m?.revenue ?? 0) / sho.revenue) * 100 : 0;
    }),
    comparisonDates.map((d) => {
      const sho = shopifyByDate.get(d);
      const m = metaByDate.get(d);
      return sho && sho.revenue > 0 ? ((m?.revenue ?? 0) / sho.revenue) * 100 : 0;
    }),
    "mean");

  let googleAdsSeriesShape: TopStripResponse["series"]["googleAds"] = null;
  if (googleAdsSection) {
    googleAdsSeriesShape = {
      spend: buildRangeSeries(kind, windowDates,
        gaCurDaily.map((r) => r.spend), gaCmpDaily.map((r) => r.spend), "sum"),
      roas: buildRangeSeries(kind, windowDates,
        gaCurDaily.map((r) => (r.spend > 0 ? r.revenue / r.spend : 0)),
        gaCmpDaily.map((r) => (r.spend > 0 ? r.revenue / r.spend : 0)),
        "mean"),
      purchases: buildRangeSeries(kind, windowDates,
        gaCurDaily.map((r) => r.purchases), gaCmpDaily.map((r) => r.purchases), "sum"),
    };
  }

  const cacSeries = buildRangeSeries(kind, windowDates,
    windowDates.map((d, i) => {
      const sho = shoCurDaily[i];
      const m = metaCurDaily[i];
      const g = gaCurDaily[i];
      return sho.orders > 0 ? ((m.spend + g.spend) / sho.orders) : 0;
    }),
    comparisonDates.map((d, i) => {
      const sho = shoCmpDaily[i];
      const m = metaCmpDaily[i];
      const g = gaCmpDaily[i];
      return sho.orders > 0 ? ((m.spend + g.spend) / sho.orders) : 0;
    }),
    "mean");
  const netSeries = buildRangeSeries(kind, windowDates,
    windowDates.map((d, i) => {
      const sho = shoCurDaily[i];
      const m = metaCurDaily[i];
      const g = gaCurDaily[i];
      return sho.revenue - m.spend - g.spend;
    }),
    comparisonDates.map((d, i) => {
      const sho = shoCmpDaily[i];
      const m = metaCmpDaily[i];
      const g = gaCmpDaily[i];
      return sho.revenue - m.spend - g.spend;
    }),
    "sum");

  return {
    mode: "range",
    window: {
      from: window.from, to: window.to, preset: window.preset, days: window.days,
    },
    business: { revenue: businessRevenue, orders: businessOrders, aov },
    ads: {
      spend: metaSpend,
      roas,
      attribution: {
        pct: attributionPct,
        metaRevenue: metaCurrent.revenue,
        shopifyRevenue: shoCurrent.revenue,
      },
    },
    googleAds: googleAdsSection,
    crossPlatform: {
      cac: buildRangeTempo(cacCurrent, cacPrev),
      netAfterAds: buildRangeTempo(netCurrent, netPrev),
      channelMix,
    },
    series: {
      business: { revenue: revenueSeries, orders: ordersSeries, aov: aovSeries },
      ads: { spend: spendSeries, roas: roasSeriesShape, attribution: attributionSeries },
      googleAds: googleAdsSeriesShape,
      crossPlatform: { cac: cacSeries, netAfterAds: netSeries },
    },
    anomalyCount,
    freshAsOf: latestFetched ?? now.toISOString(),
  };
}

// ============================================================
// Route
// ============================================================

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const now = new Date();
    const window: DateWindow = resolveDateWindow(req.nextUrl.searchParams);
    const kind = pickSeriesKind(window.preset, window.days);

    // Anomaly count: pending red/amber briefs for today — always reflects
    // "right now" regardless of window selection.
    const { count: anomalyRaw } = await supabaseAdmin
      .from("agent_briefs")
      .select("*", { count: "exact", head: true })
      .eq("for_date", sofiaDate(now))
      .in("severity", ["red", "amber"])
      .eq("status", "pending");
    const anomalyCount = anomalyRaw ?? 0;

    const response: TopStripResponse =
      kind === "hourly"
        ? await handleHourly(window, now, anomalyCount)
        : await handleRange(window, kind, now, anomalyCount);

    return NextResponse.json(response, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/dashboard/home/top-strip failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
