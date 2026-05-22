import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveAdsMarketFromRequest } from "@/lib/ads-market";
import { getMetaPlacementBreakdown } from "@/lib/meta";
import { logger } from "@/lib/logger";

/**
 * GET /api/dashboard/ads/placements?market=&preset=
 *
 * Spend split across Meta's publisher platforms (Facebook / Instagram /
 * Audience Network / Messenger) — the missing format-level decision layer
 * between the account KPIs and the individual ad cards.
 */

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "s-maxage=300, stale-while-revalidate=120",
};

const PRESET_MAP: Record<string, string> = {
  today: "today", yesterday: "yesterday",
  "7d": "last_7d", "14d": "last_14d", "30d": "last_30d", "90d": "last_90d",
  this_month: "this_month", last_month: "last_month",
};

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ placements: [] }, { status: 200 });
  }

  let ids: string[] | null;
  try {
    ({ ids } = await resolveAdsMarketFromRequest(request));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid market";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const preset = request.nextUrl.searchParams.get("preset") || "7d";
  const datePreset = PRESET_MAP[preset] || "last_7d";

  try {
    // ids null → env-default single account; else fan out across the market.
    const accounts: (string | undefined)[] =
      ids && ids.length > 0 ? ids : [undefined];
    const perAccount = await Promise.all(
      accounts.map((id) => getMetaPlacementBreakdown(datePreset, id))
    );

    const byPlatform = new Map<
      string,
      { spend: number; revenue: number; purchases: number }
    >();
    for (const rows of perAccount) {
      for (const r of rows) {
        const e = byPlatform.get(r.platform) ?? { spend: 0, revenue: 0, purchases: 0 };
        e.spend += r.spend;
        e.revenue += r.revenue;
        e.purchases += r.purchases;
        byPlatform.set(r.platform, e);
      }
    }

    const total = [...byPlatform.values()].reduce((a, e) => a + e.spend, 0);
    const placements = [...byPlatform.entries()]
      .map(([platform, e]) => ({
        platform,
        spend: e.spend,
        revenue: e.revenue,
        roas: e.spend > 0 ? e.revenue / e.spend : 0,
        purchases: e.purchases,
        share: total > 0 ? e.spend / total : 0,
      }))
      .sort((a, b) => b.spend - a.spend);

    return NextResponse.json({ placements }, { headers: CACHE_HEADERS });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Meta API fetch failed";
    logger.error("GET /api/dashboard/ads/placements failed", { error: msg });
    return NextResponse.json({ error: "Meta API fetch failed" }, { status: 500 });
  }
}
