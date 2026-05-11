import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { sofiaDate, sofiaHoursElapsed, shiftDate } from "@/lib/sofia-date";
import { resolveAllHomeMarkets } from "@/lib/store-market-resolver";
import { EARLY_DAY_THRESHOLD_HOURS } from "@/components/dashboard/store-state";

// ============================================================
// Types
// ============================================================

interface TempoMetric {
  /** Running total so far today across all three stores. */
  value: number;
  /**
   * Percentage delta vs matched-hour portion of a typical weekday average.
   * 0 means on pace; +20 means 20% ahead of pace. null when too early in
   * the day to project reliably (< 3h of Sofia time elapsed). Clamped to
   * ±999 to avoid runaway values when a stray full-day prior row skews the
   * denominator in the early hours.
   */
  vsTypical: number | null;
  /** Linear extrapolation of today's value to end-of-day. null when too early. */
  projected: number | null;
}

/**
 * Top-strip splits into two internally-composable sections:
 *
 *   business — what happened on the store (Shopify truth)
 *   ads      — what the paid channels did (Meta attribution)
 *
 * Each section's numbers add up among themselves: Ads ROAS = ads.spend
 * × ROAS → meta-revenue ⊆ ads.attribution.metaRevenue, all from Meta.
 * Business revenue / orders / AOV all come from Shopify daily_aggregates.
 *
 * The bridge between them is `ads.attribution.pct` — what % of business
 * revenue Meta attribution claims credit for. This makes the
 * organic/email/direct gap explicit instead of hidden inside a mixed tile.
 */
interface TopStripResponse {
  business: {
    revenue: TempoMetric;
    orders: TempoMetric;
    /** Average order value today = revenue/orders. 0 if no orders yet. */
    aov: { value: number };
  };
  ads: {
    /** Meta ad-spend across all bound accounts. Shopify has no spend concept. */
    spend: TempoMetric;
    /** ROAS = meta-revenue / meta-spend. Composes within the ads section. */
    roas: { value: number };
    /** Bridge to business section: what % of Shopify revenue Meta claims. */
    attribution: {
      /** 0-100 (or null if business revenue is 0). */
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

/**
 * Fetch daily aggregates across all bound Shopify schemas (`store_${marketCode}`),
 * summed by date. Schemas are resolved dynamically via the market resolver
 * (cached, 60s TTL) so opening a 4th market never needs a code edit here.
 *
 * Used for today and the 4 prior same-weekdays — daily_aggregates is
 * continuously refreshed (~minute-level lag against raw orders), acceptable
 * for the 60s-refresh dashboard.
 */
async function fetchShopifyByDate(
  dates: string[]
): Promise<Map<string, { revenue: number; orders: number }>> {
  const markets = await resolveAllHomeMarkets();
  const schemas = markets.map((m) => `store_${m.marketCode}`);

  const perSchema = await Promise.all(
    schemas.map(async (schema) => {
      const { data, error } = await supabaseAdmin
        .schema(schema)
        .from("daily_aggregates")
        .select("order_date, total_revenue, total_orders")
        .in("order_date", dates);
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
      bucket.revenue += Number(r.total_revenue ?? 0);
      bucket.orders += Number(r.total_orders ?? 0);
      byDate.set(r.order_date, bucket);
    }
  }
  return byDate;
}

/**
 * Compute matched-hour tempo metric: today's running value vs the matched
 * portion of the prior-weekdays average. Pure function so Meta and Shopify
 * share exactly the same arithmetic + clamps.
 *
 * Returns nulls (no signal) when:
 *   - It's too early in the Sofia day (< EARLY_DAY_THRESHOLD_HOURS elapsed).
 *     The threshold is shared with StoresTable so server + client agree on
 *     when a number is trustworthy.
 *   - No prior data at all.
 *   - Prior average is 0 (no comparable activity).
 */
function buildTempoMetric<F extends string>(
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
  // Belt-and-suspenders against extreme values: clamp the display so a
  // freak row can't render "+12,450%" in the UI.
  const vsTypical = Math.max(-999, Math.min(999, vsTypicalRaw));
  const projected = Math.round(todayValue / (hoursElapsed / 24));
  return { value: todayValue, vsTypical, projected };
}

// ============================================================
// Route
// ============================================================

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const now = new Date();
    const todayIso = sofiaDate(now);
    const hoursElapsed = sofiaHoursElapsed(now);

    // Previous 4 same-weekdays (7, 14, 21, 28 days ago in Sofia).
    const comparisonDates = [7, 14, 21, 28].map((n) => shiftDate(todayIso, n));

    // Single query covering today + all 4 comparison days, across all stores,
    // at account level (one row per store-day per account — the view already
    // blends all bindings per store). We aggregate across stores in JS.
    //
    // Anomaly count: pending red/amber briefs for today — drives the alert
    // pill in KpiStrip. Runs in parallel with the insights query.
    //
    // Shopify daily totals fetched in parallel — same date set so we can
    // compute vsTypical / projected against Shopify-actual instead of
    // Meta-attributed (the latter misses ~30% of activity per audit).
    const [{ data, error }, { count: anomalyRaw }, shopifyByDate] = await Promise.all([
      supabaseAdmin
        .from("meta_insights_by_store")
        .select("date, spend, revenue, purchases, fetched_at")
        .eq("level", "account")
        .in("date", [todayIso, ...comparisonDates]),
      supabaseAdmin
        .from("agent_briefs")
        .select("*", { count: "exact", head: true })
        .eq("for_date", todayIso)
        .in("severity", ["red", "amber"])
        .eq("status", "pending"),
      fetchShopifyByDate([todayIso, ...comparisonDates]),
    ]);

    if (error) {
      logger.error("top-strip query failed", { error: error.message });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    type Row = {
      date: string;
      spend: number | string | null;
      revenue: number | string | null;
      purchases: number | string | null;
      fetched_at: string | null;
    };
    const rows = (data ?? []) as Row[];
    const num = (v: number | string | null | undefined): number =>
      v == null ? 0 : typeof v === "string" ? Number(v) : v;

    // Sum across stores for each unique date.
    const byDate = new Map<string, { spend: number; revenue: number; purchases: number }>();
    let latestFetched: string | null = null;
    for (const r of rows) {
      const bucket =
        byDate.get(r.date) ??
        (() => {
          const fresh = { spend: 0, revenue: 0, purchases: 0 };
          byDate.set(r.date, fresh);
          return fresh;
        })();
      bucket.spend += num(r.spend);
      bucket.revenue += num(r.revenue);
      bucket.purchases += num(r.purchases);
      if (r.fetched_at && (!latestFetched || r.fetched_at > latestFetched)) {
        latestFetched = r.fetched_at;
      }
    }

    const today = byDate.get(todayIso) ?? { spend: 0, revenue: 0, purchases: 0 };
    const priors = comparisonDates
      .map((d) => byDate.get(d))
      .filter((x): x is NonNullable<typeof x> => !!x);

    // === Ads block (Meta) ============================================
    const metaRevenue = buildTempoMetric(today.revenue, priors, "revenue", hoursElapsed);
    const metaSpend = buildTempoMetric(today.spend, priors, "spend", hoursElapsed);
    // ROAS = Meta revenue / Meta spend. Cap at 99.99x — an early-day row
    // with €1 spend and €500 revenue would otherwise render "500.00x".
    const roas = {
      value:
        metaSpend.value > 0
          ? Math.min(99.99, Number((metaRevenue.value / metaSpend.value).toFixed(2)))
          : 0,
    };

    // === Business block (Shopify) ====================================
    const shopifyToday = shopifyByDate.get(todayIso) ?? { revenue: 0, orders: 0 };
    const shopifyPriors = comparisonDates
      .map((d) => shopifyByDate.get(d))
      .filter((x): x is NonNullable<typeof x> => !!x);

    const businessRevenue = buildTempoMetric(
      shopifyToday.revenue,
      shopifyPriors,
      "revenue",
      hoursElapsed
    );
    const businessOrders = buildTempoMetric(
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

    // === Attribution bridge ==========================================
    // What % of Shopify revenue is Meta-attributed? Bounded [0, 100] —
    // can briefly exceed 100 due to attribution timing (Meta credits a
    // purchase before Shopify webhook lands); clamp to keep the UI sane.
    const attributionPct =
      businessRevenue.value > 0
        ? Math.min(100, Math.round((metaRevenue.value / businessRevenue.value) * 100))
        : null;

    const response: TopStripResponse = {
      business: {
        revenue: businessRevenue,
        orders: businessOrders,
        aov,
      },
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

    return NextResponse.json(response, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/dashboard/home/top-strip failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
