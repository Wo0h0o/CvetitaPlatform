import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { sofiaDate, sofiaHoursElapsed, shiftDate } from "@/lib/sofia-date";

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
 * Revenue / orders surface two values: the real Shopify total (primary,
 * what actually happened on the store) and the Meta-attributed slice
 * (secondary, what Meta claims credit for). The gap is the organic /
 * email / direct / non-Meta-paid contribution.
 */
interface DualSourceMetric {
  /** Shopify totals — primary truth. Drives vsTypical + projected. */
  shopify: TempoMetric;
  /** Meta-attributed absolute value. No tempo math — kept as a sub-figure. */
  metaValue: number;
}

interface TopStripResponse {
  revenue: DualSourceMetric;
  orders: DualSourceMetric;
  /** Spend is Meta-only by definition — Shopify has no ad-spend concept. */
  spend: TempoMetric;
  /** ROAS = Meta revenue / Meta spend. Mixing Shopify revenue with Meta
   *  spend would be misleading (not all Shopify revenue is ad-attributable). */
  roas: { value: number };
  anomalyCount: number;
  freshAsOf: string;
}

// Shopify schemas — one per market. Hard-coded for now; matches the three
// active stores. If a 4th market opens we'll resolve via stores table.
const SHOPIFY_SCHEMAS = ["store_bg", "store_gr", "store_ro"] as const;

interface DailyAggRow {
  order_date: string;
  total_revenue: number | string | null;
  total_orders: number | string | null;
}

/**
 * Fetch daily aggregates across all three Shopify schemas, summed by date.
 * Used for both today and the prior same-weekdays — daily_aggregates is
 * continuously refreshed (~minute-level lag against raw orders), which is
 * acceptable for the 60s-refresh dashboard.
 */
async function fetchShopifyByDate(
  dates: string[]
): Promise<Map<string, { revenue: number; orders: number }>> {
  const perSchema = await Promise.all(
    SHOPIFY_SCHEMAS.map(async (schema) => {
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
    const priors = comparisonDates.map((d) => byDate.get(d)).filter((x): x is NonNullable<typeof x> => !!x);

    const typical = (field: "spend" | "revenue" | "purchases"): number => {
      if (priors.length === 0) return 0;
      const sum = priors.reduce((acc, p) => acc + p[field], 0);
      return sum / priors.length;
    };

    // If it's too early in the Sofia day (< 3h) or we have no prior data,
    // skip the tempo/projected math — too noisy to be useful. 3h (not 1h)
    // because at hoursElapsed≈1 the denominator matchedSoFar is ~4% of typ,
    // so a single late-attribution prior row can push vsTypical into the
    // thousands of percent.
    const tooEarly = hoursElapsed < 3 || priors.length === 0;

    const tempoMetric = (field: "spend" | "revenue" | "purchases"): TempoMetric => {
      const value = today[field];
      if (tooEarly) return { value, vsTypical: null, projected: null };
      const typ = typical(field);
      if (typ === 0) return { value, vsTypical: null, projected: null };
      const matchedSoFar = typ * (hoursElapsed / 24);
      const vsTypicalRaw = Math.round(((value - matchedSoFar) / matchedSoFar) * 100);
      // Belt-and-suspenders against extreme values: clamp the display so a
      // freak row can't render "+12,450%" in the UI.
      const vsTypical = Math.max(-999, Math.min(999, vsTypicalRaw));
      const projected = Math.round(value / (hoursElapsed / 24));
      return { value, vsTypical, projected };
    };

    // Meta tempo metrics (revenue & orders kept for the secondary "от Meta"
    // sub-figure; spend & roas stay Meta-only as primary).
    const metaRevenue = tempoMetric("revenue");
    const metaSpend = tempoMetric("spend");
    const metaOrders = tempoMetric("purchases");
    // ROAS = Meta revenue / Meta spend. Cap at 99.99x — an early-day row
    // with €1 spend and €500 revenue would otherwise render "500.00x".
    const roas = {
      value:
        metaSpend.value > 0
          ? Math.min(99.99, Number((metaRevenue.value / metaSpend.value).toFixed(2)))
          : 0,
    };

    // Shopify tempo metrics — same matched-hour math, but against the
    // (real) Shopify priors. Sums daily_aggregates per store + date.
    const shopifyToday = shopifyByDate.get(todayIso) ?? { revenue: 0, orders: 0 };
    const shopifyPriors = comparisonDates
      .map((d) => shopifyByDate.get(d))
      .filter((x): x is NonNullable<typeof x> => !!x);
    const tooEarlyShopify = hoursElapsed < 3 || shopifyPriors.length === 0;
    const shopifyTempo = (
      field: "revenue" | "orders"
    ): TempoMetric => {
      const value = shopifyToday[field];
      if (tooEarlyShopify) return { value, vsTypical: null, projected: null };
      const sum = shopifyPriors.reduce((acc, p) => acc + p[field], 0);
      const typ = sum / shopifyPriors.length;
      if (typ === 0) return { value, vsTypical: null, projected: null };
      const matchedSoFar = typ * (hoursElapsed / 24);
      const vsTypicalRaw = Math.round(((value - matchedSoFar) / matchedSoFar) * 100);
      const vsTypical = Math.max(-999, Math.min(999, vsTypicalRaw));
      const projected = Math.round(value / (hoursElapsed / 24));
      return { value, vsTypical, projected };
    };

    const response: TopStripResponse = {
      revenue: {
        shopify: shopifyTempo("revenue"),
        metaValue: metaRevenue.value,
      },
      orders: {
        shopify: shopifyTempo("orders"),
        metaValue: metaOrders.value,
      },
      spend: metaSpend,
      roas,
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
