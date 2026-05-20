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
import { resolveAllHomeMarkets } from "@/lib/store-market-resolver";
import { EARLY_DAY_THRESHOLD_HOURS } from "@/components/dashboard/store-state";
import { fetchGoogleAdsByDateAllMarkets, sumGoogleAds } from "@/lib/google-ads-by-date";

// ============================================================
// Types
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
   *   - preset=today: matched-hour portion of average across last 4 same
   *     weekdays.
   *   - preset≠today: equal-length immediately-preceding period.
   * null when the baseline is unavailable (too early in the day, no prior
   * data, or denominator = 0). Clamped to ±999.
   */
  vsTypical: number | null;
  /**
   * Linear extrapolation to end-of-day. Only meaningful for preset=today;
   * always null for other presets.
   */
  projected: number | null;
}

/**
 * Top-strip splits into two internally-composable sections:
 *
 *   business — what happened on the store (Shopify truth)
 *   ads      — what the paid channels did (Meta attribution)
 *
 * Each section's numbers add up among themselves. The bridge is
 * `ads.attribution.pct`: what % of business revenue Meta attribution
 * claims, making the organic/email/direct gap explicit.
 */
interface TopStripResponse {
  /**
   * "today" → pacing tiles (vsTypical vs same-weekday baseline, projected
   * end-of-day). "range" → aggregate over window, vsTypical vs previous
   * equal-length period, projected always null.
   */
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
    /** Average order value = revenue/orders over the window. 0 when no orders. */
    aov: { value: number };
  };
  ads: {
    spend: TempoMetric;
    /** ROAS = meta-revenue / meta-spend over the window. */
    roas: { value: number };
    attribution: {
      /** 0-100 (or null when business revenue is 0). */
      pct: number | null;
      metaRevenue: number;
      shopifyRevenue: number;
    };
  };
  /**
   * Google Ads — pulled directly from GA4 Data API (no Supabase mirror yet,
   * one runReport call per request). Null when GA4 is not configured or the
   * query failed — UI hides the section rather than rendering zeros.
   *
   * Caveat: GA4 ad data has 4-24h freshness latency, so "today" numbers
   * are usually incomplete until late afternoon Sofia time. The vsTypical
   * baseline still works (same latency applies to the prior weekdays).
   */
  googleAds: {
    spend: TempoMetric;
    /** ROAS = google-revenue / google-spend over the window. */
    roas: { value: number };
    purchases: TempoMetric;
  } | null;
  /**
   * Cross-platform composites — the platform's superpower. Nothing here is
   * derivable from a single source; every number combines Shopify + Meta
   * + Google Ads. This is what no individual dashboard can show.
   *
   *   cac          = (meta_spend + google_spend) / shopify_orders
   *   netAfterAds  = shopify_revenue − meta_spend − google_spend
   *   channelMix   = how Shopify revenue splits across attribution sources
   *
   * `cac` and `netAfterAds` follow the same TempoMetric pacing logic as
   * source-pure tiles. `channelMix` is a composition snapshot — no delta.
   */
  crossPlatform: {
    cac: TempoMetric;
    netAfterAds: TempoMetric;
    channelMix: {
      meta: { revenue: number; pct: number };
      googleAds: { revenue: number; pct: number };
      /** Shopify revenue minus all paid attribution — organic/email/direct. */
      other: { revenue: number; pct: number };
      shopifyRevenue: number;
    };
  };
  anomalyCount: number;
  freshAsOf: string;
}

interface DailyAggRow {
  order_date: string;
  total_revenue: number | string | null;
  total_orders: number | string | null;
}

const num = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Fetch daily aggregates across all bound Shopify schemas (`store_${marketCode}`),
 * summed by date. See migration 025 for why this goes through the public
 * `read_store_daily_aggregates` RPC instead of `.schema(...).from(...)`.
 */
async function fetchShopifyByDate(
  dates: string[]
): Promise<Map<string, { revenue: number; orders: number }>> {
  const markets = await resolveAllHomeMarkets();
  const schemas = markets.map((m) => `store_${m.marketCode}`);

  const perSchema = await Promise.all(
    schemas.map(async (schema) => {
      const { data, error } = await supabaseAdmin.rpc(
        "read_store_daily_aggregates",
        { p_schema: schema, p_dates: dates }
      );
      if (error) {
        logger.error("top-strip: shopify daily_aggregates fetch failed", {
          schema,
          error: error.message,
        });
        return [] as DailyAggRow[];
      }
      return (data ?? []) as DailyAggRow[];
    })
  );

  const byDate = new Map<string, { revenue: number; orders: number }>();
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
 * Compute matched-hour tempo metric for preset=today: today's running
 * value vs the matched portion of the prior-weekdays average. Pure
 * function so Meta and Shopify share exactly the same arithmetic + clamps.
 */
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

/**
 * Range-mode tempo: compare aggregate over [from..to] vs equal-length
 * immediately-preceding window. Projected is always null — no pacing
 * logic outside of today.
 */
function buildRangeTempo(current: number, previous: number): TempoMetric {
  if (previous === 0) {
    return { value: current, vsTypical: null, projected: null };
  }
  const raw = Math.round(((current - previous) / previous) * 100);
  const vsTypical = Math.max(-999, Math.min(999, raw));
  return { value: current, vsTypical, projected: null };
}

// ============================================================
// Aggregation helpers
// ============================================================

interface MetaDayRow {
  date: string;
  spend: number | string | null;
  revenue: number | string | null;
  purchases: number | string | null;
  fetched_at: string | null;
}

/** Inclusive ISO date range expanded to an array. */
function expandRange(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let cursor = fromIso;
  // Safety cap — 365 days max to avoid runaway queries.
  let guard = 0;
  while (cursor <= toIso && guard < 366) {
    out.push(cursor);
    cursor = shiftDate(cursor, -1);
    guard++;
  }
  return out;
}

function sumMeta(
  byDate: Map<string, { spend: number; revenue: number; purchases: number }>,
  dates: string[]
): { spend: number; revenue: number; purchases: number } {
  const out = { spend: 0, revenue: 0, purchases: 0 };
  for (const d of dates) {
    const row = byDate.get(d);
    if (!row) continue;
    out.spend += row.spend;
    out.revenue += row.revenue;
    out.purchases += row.purchases;
  }
  return out;
}

function sumShopify(
  byDate: Map<string, { revenue: number; orders: number }>,
  dates: string[]
): { revenue: number; orders: number } {
  const out = { revenue: 0, orders: 0 };
  for (const d of dates) {
    const row = byDate.get(d);
    if (!row) continue;
    out.revenue += row.revenue;
    out.orders += row.orders;
  }
  return out;
}

/**
 * Build the channelMix composition snapshot — what % of Shopify revenue
 * each paid source claimed (Meta, Google), with the remainder bucketed as
 * "other" (organic / email / direct / referral / partial attribution).
 *
 * "Other" is clamped to 0+ because Meta + Google attribution can briefly
 * exceed Shopify revenue at the edges (Meta credits a purchase before the
 * matching Shopify webhook lands) — we'd rather hide the over-attribution
 * here than render a negative slice. The attribution tile in the Meta
 * section is where the operator sees that warning.
 */
function buildChannelMix(
  shopifyRevenue: number,
  metaRevenue: number,
  googleAdsRevenue: number
): TopStripResponse["crossPlatform"]["channelMix"] {
  const otherRaw = shopifyRevenue - metaRevenue - googleAdsRevenue;
  const other = Math.max(0, otherRaw);
  const total = shopifyRevenue > 0 ? shopifyRevenue : 1;
  return {
    meta: { revenue: metaRevenue, pct: Math.round((metaRevenue / total) * 100) },
    googleAds: { revenue: googleAdsRevenue, pct: Math.round((googleAdsRevenue / total) * 100) },
    other: { revenue: other, pct: Math.round((other / total) * 100) },
    shopifyRevenue,
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

    // ----- Date set we need from the DB depends on mode --------------
    // today  → today + 4 same-weekdays prior (existing pacing logic)
    // range  → [from..to] + [compFrom..compTo] (equal-length prior period)
    let datesToFetch: string[];
    let windowDates: string[];
    let comparisonDates: string[];
    let todayPriors: string[] = [];

    if (window.isToday) {
      const todayIso = window.from; // == sofiaDate(now)
      todayPriors = [7, 14, 21, 28].map((n) => shiftDate(todayIso, n));
      windowDates = [todayIso];
      comparisonDates = todayPriors;
      datesToFetch = [todayIso, ...todayPriors];
    } else {
      windowDates = expandRange(window.from, window.to);
      comparisonDates = expandRange(window.compFrom, window.compTo);
      datesToFetch = [...windowDates, ...comparisonDates];
    }

    // Anomaly count: pending red/amber briefs for today — independent of
    // window selection; the alert pill always reflects "right now".
    const todayIsoForAnomaly = sofiaDate(now);

    const [{ data, error }, { count: anomalyRaw }, shopifyByDate, googleAdsByDate] =
      await Promise.all([
        supabaseAdmin
          .from("meta_insights_by_store")
          .select("date, spend, revenue, purchases, fetched_at")
          .eq("level", "account")
          .in("date", datesToFetch),
        supabaseAdmin
          .from("agent_briefs")
          .select("*", { count: "exact", head: true })
          .eq("for_date", todayIsoForAnomaly)
          .in("severity", ["red", "amber"])
          .eq("status", "pending"),
        fetchShopifyByDate(datesToFetch),
        fetchGoogleAdsByDateAllMarkets(datesToFetch),
      ]);

    if (error) {
      logger.error("top-strip query failed", { error: error.message });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    const rows = (data ?? []) as MetaDayRow[];

    // Sum Meta rows across stores for each unique date.
    const metaByDate = new Map<
      string,
      { spend: number; revenue: number; purchases: number }
    >();
    let latestFetched: string | null = null;
    for (const r of rows) {
      const bucket =
        metaByDate.get(r.date) ??
        (() => {
          const fresh = { spend: 0, revenue: 0, purchases: 0 };
          metaByDate.set(r.date, fresh);
          return fresh;
        })();
      bucket.spend += num(r.spend);
      bucket.revenue += num(r.revenue);
      bucket.purchases += num(r.purchases);
      if (r.fetched_at && (!latestFetched || r.fetched_at > latestFetched)) {
        latestFetched = r.fetched_at;
      }
    }

    let response: TopStripResponse;

    if (window.isToday) {
      // === Today mode — keep pacing pipeline ===========================
      const todayIso = window.from;
      const hoursElapsed = sofiaHoursElapsed(now);

      const today = metaByDate.get(todayIso) ?? {
        spend: 0,
        revenue: 0,
        purchases: 0,
      };
      const priors = todayPriors
        .map((d) => metaByDate.get(d))
        .filter((x): x is NonNullable<typeof x> => !!x);

      const metaRevenue = buildTodayTempo(today.revenue, priors, "revenue", hoursElapsed);
      const metaSpend = buildTodayTempo(today.spend, priors, "spend", hoursElapsed);
      const roas = {
        value:
          metaSpend.value > 0
            ? Math.min(99.99, Number((metaRevenue.value / metaSpend.value).toFixed(2)))
            : 0,
      };

      const shopifyToday = shopifyByDate.get(todayIso) ?? { revenue: 0, orders: 0 };
      const shopifyPriors = todayPriors
        .map((d) => shopifyByDate.get(d))
        .filter((x): x is NonNullable<typeof x> => !!x);

      const businessRevenue = buildTodayTempo(
        shopifyToday.revenue,
        shopifyPriors,
        "revenue",
        hoursElapsed
      );
      const businessOrders = buildTodayTempo(
        shopifyToday.orders,
        shopifyPriors,
        "orders",
        hoursElapsed
      );
      const aov = {
        value:
          businessOrders.value > 0
            ? Number((businessRevenue.value / businessOrders.value).toFixed(2))
            : 0,
      };

      const attributionPct =
        businessRevenue.value > 0
          ? Math.min(100, Math.round((metaRevenue.value / businessRevenue.value) * 100))
          : null;

      // Google Ads — same matched-hour pacing pipeline, but render null
      // if GA4 returned nothing (not configured / fetch failed). UI hides
      // the section entirely in that case rather than showing zeros.
      const gaToday = googleAdsByDate.get(todayIso);
      const gaPriors = todayPriors
        .map((d) => googleAdsByDate.get(d))
        .filter((x): x is NonNullable<typeof x> => !!x);

      const safeGaToday = gaToday ?? { spend: 0, revenue: 0, purchases: 0 };
      let googleAdsSection: TopStripResponse["googleAds"] = null;
      if (gaToday || gaPriors.length > 0) {
        const gaSpend = buildTodayTempo(safeGaToday.spend, gaPriors, "spend", hoursElapsed);
        const gaPurchases = buildTodayTempo(safeGaToday.purchases, gaPriors, "purchases", hoursElapsed);
        const gaRoas = {
          value:
            safeGaToday.spend > 0
              ? Math.min(99.99, Number((safeGaToday.revenue / safeGaToday.spend).toFixed(2)))
              : 0,
        };
        googleAdsSection = { spend: gaSpend, roas: gaRoas, purchases: gaPurchases };
      }

      // Cross-platform composites. We build per-day blended figures for the
      // matched-hour pacing arithmetic, then run them through the same
      // buildTodayTempo helper. CAC = total_spend / orders (per day),
      // netAfterAds = shopify_revenue − total_spend.
      const totalSpendToday = today.spend + safeGaToday.spend;
      const totalSpendPriors = todayPriors.map((d) => {
        const m = metaByDate.get(d);
        const g = googleAdsByDate.get(d);
        return { totalSpend: (m?.spend ?? 0) + (g?.spend ?? 0) };
      });
      // Pacing CAC needs the per-day CAC values, not aggregate spend.
      const cacToday = shopifyToday.orders > 0 ? totalSpendToday / shopifyToday.orders : 0;
      const cacPriors = todayPriors
        .map((d) => {
          const sho = shopifyByDate.get(d);
          const m = metaByDate.get(d);
          const g = googleAdsByDate.get(d);
          if (!sho || sho.orders === 0) return null;
          return { cac: ((m?.spend ?? 0) + (g?.spend ?? 0)) / sho.orders };
        })
        .filter((x): x is { cac: number } => !!x);
      const cacTempo = buildTodayTempo(cacToday, cacPriors, "cac", hoursElapsed);

      const netToday = shopifyToday.revenue - totalSpendToday;
      const netPriors = todayPriors
        .map((d) => {
          const sho = shopifyByDate.get(d);
          const m = metaByDate.get(d);
          const g = googleAdsByDate.get(d);
          if (!sho && !m && !g) return null;
          return { net: (sho?.revenue ?? 0) - (m?.spend ?? 0) - (g?.spend ?? 0) };
        })
        .filter((x): x is { net: number } => !!x);
      const netTempo = buildTodayTempo(netToday, netPriors, "net", hoursElapsed);

      const channelMix = buildChannelMix(
        shopifyToday.revenue,
        today.revenue,
        safeGaToday.revenue
      );

      // Unused suppression — we computed totalSpendPriors above for completeness
      // but the per-day CAC/net priors above already encode the same data.
      void totalSpendPriors;

      response = {
        mode: "today",
        window: {
          from: window.from,
          to: window.to,
          preset: window.preset,
          days: window.days,
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
        anomalyCount: anomalyRaw ?? 0,
        freshAsOf: latestFetched ?? now.toISOString(),
      };
    } else {
      // === Range mode — aggregate over window + compare to prior period
      const metaCurrent = sumMeta(metaByDate, windowDates);
      const metaPrev = sumMeta(metaByDate, comparisonDates);
      const shopifyCurrent = sumShopify(shopifyByDate, windowDates);
      const shopifyPrev = sumShopify(shopifyByDate, comparisonDates);

      const metaSpend = buildRangeTempo(metaCurrent.spend, metaPrev.spend);
      // metaRevenue isn't shown as its own tile (ROAS and attribution
      // both encode it); but we still need the sum for attribution.
      const roas = {
        value:
          metaCurrent.spend > 0
            ? Math.min(99.99, Number((metaCurrent.revenue / metaCurrent.spend).toFixed(2)))
            : 0,
      };

      const businessRevenue = buildRangeTempo(shopifyCurrent.revenue, shopifyPrev.revenue);
      const businessOrders = buildRangeTempo(shopifyCurrent.orders, shopifyPrev.orders);
      const aov = {
        value:
          shopifyCurrent.orders > 0
            ? Number((shopifyCurrent.revenue / shopifyCurrent.orders).toFixed(2))
            : 0,
      };

      const attributionPct =
        shopifyCurrent.revenue > 0
          ? Math.min(100, Math.round((metaCurrent.revenue / shopifyCurrent.revenue) * 100))
          : null;

      // Google Ads range mode — sum + compare to prior equal-length period.
      // Null when no GA4 data found in either window (UI hides the section).
      const gaCurrent = sumGoogleAds(googleAdsByDate, windowDates);
      const gaPrev = sumGoogleAds(googleAdsByDate, comparisonDates);
      let googleAdsSection: TopStripResponse["googleAds"] = null;
      if (gaCurrent.spend > 0 || gaPrev.spend > 0) {
        const gaSpend = buildRangeTempo(gaCurrent.spend, gaPrev.spend);
        const gaPurchases = buildRangeTempo(gaCurrent.purchases, gaPrev.purchases);
        const gaRoas = {
          value:
            gaCurrent.spend > 0
              ? Math.min(99.99, Number((gaCurrent.revenue / gaCurrent.spend).toFixed(2)))
              : 0,
        };
        googleAdsSection = { spend: gaSpend, roas: gaRoas, purchases: gaPurchases };
      }

      // Cross-platform composites for range mode. CAC is aggregate spend
      // divided by aggregate orders over the window; netAfterAds is
      // aggregate revenue minus aggregate spend. Comparison vs prior
      // equal-length period using the same arithmetic.
      const totalSpendCurrent = metaCurrent.spend + gaCurrent.spend;
      const totalSpendPrev = metaPrev.spend + gaPrev.spend;
      const cacCurrent = shopifyCurrent.orders > 0 ? totalSpendCurrent / shopifyCurrent.orders : 0;
      const cacPrev = shopifyPrev.orders > 0 ? totalSpendPrev / shopifyPrev.orders : 0;
      const netCurrent = shopifyCurrent.revenue - totalSpendCurrent;
      const netPrev = shopifyPrev.revenue - totalSpendPrev;
      const channelMix = buildChannelMix(
        shopifyCurrent.revenue,
        metaCurrent.revenue,
        gaCurrent.revenue
      );

      response = {
        mode: "range",
        window: {
          from: window.from,
          to: window.to,
          preset: window.preset,
          days: window.days,
        },
        business: { revenue: businessRevenue, orders: businessOrders, aov },
        ads: {
          spend: metaSpend,
          roas,
          attribution: {
            pct: attributionPct,
            metaRevenue: metaCurrent.revenue,
            shopifyRevenue: shopifyCurrent.revenue,
          },
        },
        googleAds: googleAdsSection,
        crossPlatform: {
          cac: buildRangeTempo(cacCurrent, cacPrev),
          netAfterAds: buildRangeTempo(netCurrent, netPrev),
          channelMix,
        },
        anomalyCount: anomalyRaw ?? 0,
        freshAsOf: latestFetched ?? now.toISOString(),
      };
    }

    return NextResponse.json(response, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/dashboard/home/top-strip failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
