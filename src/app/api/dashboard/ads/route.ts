import { NextResponse } from "next/server";
import { getMetaOverview, getMetaCampaignInsights } from "@/lib/meta";

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

export async function GET(request: Request) {
  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Meta Ads not configured" }, { status: 200 });
  }

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset") || "7d";
  const datePreset = PRESET_MAP[preset] || "last_7d";

  try {
    const [overview, campaigns] = await Promise.all([
      getMetaOverview(datePreset),
      getMetaCampaignInsights(datePreset),
    ]);

    return NextResponse.json(
      { overview, campaigns },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (error) {
    console.error("Meta Ads API error:", error);
    return NextResponse.json({ error: "Meta API fetch failed" });
  }
}
