import { NextRequest, NextResponse } from "next/server";
import { getMetaOverview, getMetaCampaignInsights } from "@/lib/meta";
import { requireAuth } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import {
  resolveAdsMarketFromRequest,
  aggregateOverview,
  buildOverviewFromPostgres,
  type Overview,
} from "@/lib/ads-market";
import { sofiaDate } from "@/lib/sofia-date";

// Cache for 60s so the edge-served numbers stay within a minute of the
// Postgres rollup backing /api/dashboard/home/stores. Previous 300s cache
// was the primary cause of the dashboard-vs-dropdown ROAS drift.
const CACHE_HEADERS = {
  "Cache-Control": "s-maxage=60, stale-while-revalidate=30",
};

const PRESET_MAP: Record<string, string> = {
  today: "today",
  yesterday: "yesterday",
  "7d": "last_7d",
  "14d": "last_14d",
  "30d": "last_30d",
  "90d": "last_90d",
  this_month: "this_month",
  last_month: "last_month",
};

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Meta Ads not configured" }, { status: 200 });
  }

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset") || "7d";
  const datePreset = PRESET_MAP[preset] || "last_7d";

  // Resolve `?market=` → list of bound account ids, or null for env-default.
  let ids: string[] | null;
  try {
    ({ ids } = await resolveAdsMarketFromRequest(request));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid market";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    // Env-default path: preserve pre-multi-store behavior for legacy callers
    // (e.g. /ads/campaigns, /ads/adsets) that haven't been migrated yet.
    if (ids === null) {
      const [overview, campaigns] = await Promise.all([
        getMetaOverview(datePreset),
        getMetaCampaignInsights(datePreset),
      ]);
      return NextResponse.json({ overview, campaigns }, { headers: CACHE_HEADERS });
    }

    // Market-scoped path.
    //
    // Campaigns always come from live Graph — the table column values (status,
    // created_time, etc.) are not all in Postgres, and stale campaign names
    // are more visible than slightly stale totals.
    //
    // Overview:
    //   - preset=today → read from Postgres (meta_insights_daily).
    //     Shares the exact source that /api/dashboard/home/stores and the
    //     TopBar switcher read, so the dashboard KPI strip and the dropdown
    //     ROAS badge can't drift apart. Intraday cron keeps this <15 min stale.
    //   - other presets → per-account live Graph + aggregate. The cron only
    //     backfills 3 days, so Postgres isn't a complete source for 7d/30d/90d.
    const perAccountCampaigns = await Promise.all(
      ids.map(async (id) => {
        const campaigns = await getMetaCampaignInsights(datePreset, id);
        return campaigns.map((c) => ({ ...c, integration_account_id: id }));
      })
    );

    let overview: Overview;
    if (preset === "today") {
      overview = await buildOverviewFromPostgres(ids, sofiaDate());
    } else {
      const perAccountOverviews = await Promise.all(
        ids.map((id) => getMetaOverview(datePreset, id))
      );
      overview = aggregateOverview(perAccountOverviews);
    }

    // Merge and sort fresh — don't alternate per-account order. Tiebreak by
    // id asc so deterministic pagination across requests.
    const campaigns = perAccountCampaigns
      .flat()
      .sort((a, b) => {
        if (b.spend !== a.spend) return b.spend - a.spend;
        return a.id.localeCompare(b.id);
      });

    return NextResponse.json({ overview, campaigns }, { headers: CACHE_HEADERS });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Meta API fetch failed";
    logger.error("GET /api/dashboard/ads failed", { error: msg });
    return NextResponse.json({ error: "Meta API fetch failed" }, { status: 500 });
  }
}
