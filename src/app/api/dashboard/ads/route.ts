import { NextRequest, NextResponse } from "next/server";
import { getMetaOverview, getMetaCampaignInsights } from "@/lib/meta";
import { requireAuth } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import {
  resolveAdsMarketFromRequest,
  aggregateOverview,
} from "@/lib/ads-market";

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
      return NextResponse.json(
        { overview, campaigns },
        { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
      );
    }

    // Market-scoped fan-out path: run per-account in parallel, tag rows with
    // their source account id so the client can drive a sub-brand filter.
    const perAccount = await Promise.all(
      ids.map(async (id) => {
        const [overview, campaigns] = await Promise.all([
          getMetaOverview(datePreset, id),
          getMetaCampaignInsights(datePreset, id),
        ]);
        const tagged = campaigns.map((c) => ({ ...c, integration_account_id: id }));
        return { overview, campaigns: tagged };
      })
    );

    const overview = aggregateOverview(perAccount.map((p) => p.overview));

    // Merge and sort fresh — don't alternate per-account order. Tiebreak by
    // id asc so deterministic pagination across requests.
    const campaigns = perAccount
      .flatMap((p) => p.campaigns)
      .sort((a, b) => {
        if (b.spend !== a.spend) return b.spend - a.spend;
        return a.id.localeCompare(b.id);
      });

    return NextResponse.json(
      { overview, campaigns },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Meta API fetch failed";
    logger.error("GET /api/dashboard/ads failed", { error: msg });
    return NextResponse.json({ error: "Meta API fetch failed" }, { status: 500 });
  }
}
