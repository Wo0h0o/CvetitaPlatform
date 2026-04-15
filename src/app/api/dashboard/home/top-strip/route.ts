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

interface TopStripResponse {
  revenue: TempoMetric;
  spend: TempoMetric;
  orders: TempoMetric;
  roas: { value: number };
  anomalyCount: number;
  freshAsOf: string;
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
    const { data, error } = await supabaseAdmin
      .from("meta_insights_by_store")
      .select("date, spend, revenue, purchases, fetched_at")
      .eq("level", "account")
      .in("date", [todayIso, ...comparisonDates]);

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

    const revenue = tempoMetric("revenue");
    const spend = tempoMetric("spend");
    const orders = tempoMetric("purchases");
    // Cap displayed ROAS at 99.99x — an early-day row with €1 spend and
    // €500 revenue would otherwise render "500.00x" and swamp the tile.
    const roas = {
      value:
        spend.value > 0
          ? Math.min(99.99, Number((revenue.value / spend.value).toFixed(2)))
          : 0,
    };

    const response: TopStripResponse = {
      revenue,
      spend,
      orders,
      roas,
      anomalyCount: 0, // W4: wire into agent_briefs / anomaly detector
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
