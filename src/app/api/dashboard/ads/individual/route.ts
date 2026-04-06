import { NextRequest, NextResponse } from "next/server";
import { getMetaAdInsights, getMetaAdCreatives } from "@/lib/meta";
import { requireAuth } from "@/lib/api-auth";
import { parseAdRow, scoreAd, computeAccountMeans } from "@/lib/meta-scoring";

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
  const statusFilter = searchParams.get("status") || undefined;

  try {
    // Step 1: Fetch ad-level insights
    const rows = await getMetaAdInsights(datePreset, statusFilter);
    const parsed = rows.map(parseAdRow);

    // Step 2: Compute account means for Bayesian shrinkage
    const means = computeAccountMeans(parsed);

    // Step 3: Fetch creatives (for isVideo detection + thumbnails)
    const adIds = parsed.map((a) => a.id).filter(Boolean);
    const creatives = await getMetaAdCreatives(adIds);

    // Step 4: Score each ad with v2 algorithm
    const ads = parsed.map((ad) => {
      const creative = creatives.get(ad.id);
      const isVideo = creative?.isVideo || false;
      const scoring = scoreAd(ad, isVideo, { roas: means.roas, cpa: means.cpa });

      return {
        ...ad,
        status: creative?.effective_status || "UNKNOWN",
        thumbnail: creative?.imageUrl || null,
        videoUrl: creative?.videoUrl || null,
        isVideo,
        creativeTitle: creative?.title || null,
        creativeBody: creative?.body || null,
        score: scoring.score ?? 0,
        scoringStatus: scoring.status,
        confidence: scoring.confidence,
        diagnostics: scoring.diagnostics,
        scoreBreakdown: scoring.scoreBreakdown,
        scoreMeta: scoring.meta,
      };
    }).sort((a, b) => {
      if (a.scoringStatus !== b.scoringStatus) {
        return a.scoringStatus === "scored" ? -1 : 1;
      }
      return (b.score ?? 0) - (a.score ?? 0);
    });

    return NextResponse.json(
      {
        ads,
        accountAverages: {
          roas: Math.round(means.roas * 100) / 100,
          cpa: Math.round(means.cpa * 100) / 100,
          ctr: Math.round(means.ctr * 100) / 100,
          cvr: Math.round(means.cvr * 100) / 100,
          frequency: Math.round(means.frequency * 100) / 100,
        },
      },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (error) {
    console.error("Meta Ads individual API error:", error);
    return NextResponse.json({ error: "Meta API fetch failed" });
  }
}
