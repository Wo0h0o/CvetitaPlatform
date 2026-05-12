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

    const [{ data, error }, { count: anomalyRaw }, shopifyByDate] =
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
