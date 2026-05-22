import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveAdsMarketFromRequest } from "@/lib/ads-market";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sofiaDate } from "@/lib/sofia-date";
import { logger } from "@/lib/logger";

/**
 * GET /api/dashboard/ads/trend?market=&preset=
 *
 * Daily spend + ROAS series for the spend×ROAS combo chart on /ads.
 * Source: meta_insights_daily (the nightly Postgres rollup) — zero new
 * Graph API calls. A missing day is simply absent from the series rather
 * than zero-filled (no row ≠ "spent €0 that day").
 */

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "s-maxage=300, stale-while-revalidate=120",
};

// preset → trailing days to chart. today/yesterday still chart 14 days so
// the operator gets rhythm context, not a one-bar chart.
const PRESET_DAYS: Record<string, number> = {
  today: 14, yesterday: 14, "7d": 7, "14d": 14, "30d": 30, "90d": 90,
};

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  let ids: string[] | null;
  try {
    ({ ids } = await resolveAdsMarketFromRequest(request));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid market";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  if (!ids || ids.length === 0) {
    return NextResponse.json({ trend: [] }, { headers: CACHE_HEADERS });
  }

  const preset = request.nextUrl.searchParams.get("preset") || "7d";
  const days = PRESET_DAYS[preset] ?? 14;
  const until = sofiaDate();
  const since = addDaysIso(until, -(days - 1));

  const { data, error } = await supabaseAdmin
    .from("meta_insights_daily")
    .select("date, spend, revenue")
    .eq("level", "account")
    .in("integration_account_id", ids)
    .gte("date", since)
    .lte("date", until)
    .order("date", { ascending: true });

  if (error) {
    logger.error("ads trend fetch failed", { error: error.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // Sum across the market's accounts, one point per Sofia-local date.
  const byDate = new Map<string, { spend: number; revenue: number }>();
  for (const r of data ?? []) {
    const d = r.date as string;
    const e = byDate.get(d) ?? { spend: 0, revenue: 0 };
    e.spend += num(r.spend);
    e.revenue += num(r.revenue);
    byDate.set(d, e);
  }

  const trend = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      date,
      spend: Math.round(v.spend * 100) / 100,
      roas: v.spend > 0 ? Math.round((v.revenue / v.spend) * 100) / 100 : 0,
    }));

  return NextResponse.json({ trend }, { headers: CACHE_HEADERS });
}
