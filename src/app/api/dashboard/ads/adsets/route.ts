import { NextRequest, NextResponse } from "next/server";
import { getMetaAdSetInsights, fetchAdSetsMeta, actionVal } from "@/lib/meta";
import type { MetaAdSetInsightRow } from "@/lib/meta";
import { requireAuth } from "@/lib/api-auth";

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

function parseAdSetRow(r: MetaAdSetInsightRow) {
  const spend = parseFloat(r.spend);
  const clicks = parseInt(r.clicks);
  const purchases = actionVal(r.actions, "omni_purchase");
  const revenue = actionVal(r.action_values, "omni_purchase");

  return {
    id: r.adset_id || "",
    name: r.adset_name || "Unknown",
    campaignName: r.campaign_name || "",
    campaignId: r.campaign_id || "",
    spend,
    revenue,
    roas: spend > 0 ? revenue / spend : 0,
    purchases,
    cpa: purchases > 0 ? spend / purchases : 0,
    impressions: parseInt(r.impressions),
    clicks,
    cpc: parseFloat(r.cpc || "0"),
    cpm: parseFloat(r.cpm || "0"),
    ctr: parseFloat(r.ctr || "0"),
    frequency: parseFloat(r.frequency || "0"),
    reach: parseInt(r.reach || "0"),
    addToCart: actionVal(r.actions, "omni_add_to_cart"),
    landingPageViews: actionVal(r.actions, "landing_page_view"),
    initiateCheckout: actionVal(r.actions, "omni_initiated_checkout"),
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Meta Ads not configured" }, { status: 200 });
  }

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset") || "7d";
  const datePreset = PRESET_MAP[preset] || "last_7d";

  try {
    const [insightRows, adSetsMeta] = await Promise.all([
      getMetaAdSetInsights(datePreset),
      fetchAdSetsMeta(),
    ]);

    const metaMap = new Map(adSetsMeta.map((m) => [m.id, m]));
    const parsed = insightRows.map(parseAdSetRow);

    const adsets = parsed.map((adset) => {
      const meta = metaMap.get(adset.id);
      const dailyBudget = meta?.daily_budget ? parseFloat(meta.daily_budget) / 100 : null; // Meta returns cents
      const lifetimeBudget = meta?.lifetime_budget ? parseFloat(meta.lifetime_budget) / 100 : null;

      return {
        ...adset,
        status: meta?.effective_status || "UNKNOWN",
        dailyBudget,
        lifetimeBudget,
        budget: dailyBudget ? `€${dailyBudget.toFixed(2)}/day` : lifetimeBudget ? `€${lifetimeBudget.toFixed(2)} lifetime` : "—",
        optimizationGoal: meta?.optimization_goal || null,
        createdTime: meta?.created_time || null,
        startTime: meta?.start_time || null,
      };
    }).sort((a, b) => b.spend - a.spend);

    return NextResponse.json(
      { adsets },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (error) {
    console.error("Meta Ad Sets API error:", error);
    return NextResponse.json({ error: "Meta API fetch failed" }, { status: 500 });
  }
}
