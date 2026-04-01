import { NextResponse } from "next/server";
import { getMetaAdInsights, getMetaAdCreatives, actionVal } from "@/lib/meta";
import type { MetaAdInsightRow } from "@/lib/meta";

const PRESET_MAP: Record<string, string> = {
  today: "today",
  yesterday: "yesterday",
  "7d": "last_7d",
  "14d": "last_14d",
  "30d": "last_30d",
  this_month: "this_month",
  last_month: "last_month",
};

// ---- Scoring Algorithm ----

const WEIGHTS = { roas: 0.35, cpa: 0.25, ctr: 0.15, cvr: 0.15, fatigue: 0.10 };

function sigmoid(z: number): number {
  return 100 / (1 + Math.exp(-z));
}

function zScore(value: number, mean: number, stddev: number): number {
  if (stddev === 0) return 0;
  return (value - mean) / stddev;
}

function computeFatigue(frequency: number): number {
  if (frequency <= 2.0) return 100;
  if (frequency <= 3.5) return 100 - ((frequency - 2.0) / 1.5) * 50;
  return Math.max(0, 50 - (frequency - 3.5) * 30);
}

// Absolute fallback when stddev=0 (1-2 ads with identical metrics)
function absoluteRoasScore(roas: number): number {
  if (roas >= 3) return 90;
  if (roas >= 2) return 70;
  if (roas >= 1) return 50;
  if (roas >= 0.5) return 30;
  return 15;
}

function absoluteCtrScore(ctr: number): number {
  if (ctr >= 3) return 90;
  if (ctr >= 2) return 75;
  if (ctr >= 1) return 55;
  if (ctr >= 0.5) return 35;
  return 15;
}

function absoluteCvrScore(cvr: number): number {
  if (cvr >= 5) return 90;
  if (cvr >= 3) return 75;
  if (cvr >= 1.5) return 55;
  if (cvr >= 0.5) return 35;
  return 15;
}

function absoluteCpaScore(cpa: number, meanCpa: number): number {
  if (meanCpa === 0) return 50;
  const ratio = cpa / meanCpa;
  if (ratio <= 0.5) return 90;
  if (ratio <= 0.8) return 70;
  if (ratio <= 1.2) return 50;
  if (ratio <= 2) return 30;
  return 15;
}

interface AdMetrics {
  roas: number;
  cpa: number;
  ctr: number;
  cvr: number;
  frequency: number;
  impressions: number;
}

interface AccountStats {
  mean: Record<string, number>;
  std: Record<string, number>;
}

function computeStats(ads: AdMetrics[]): AccountStats {
  const keys = ["roas", "cpa", "ctr", "cvr", "frequency"] as const;
  const mean: Record<string, number> = {};
  const std: Record<string, number> = {};

  for (const key of keys) {
    const values = ads.map((a) => a[key]).filter((v) => isFinite(v));
    if (!values.length) { mean[key] = 0; std[key] = 0; continue; }
    const m = values.reduce((s, v) => s + v, 0) / values.length;
    mean[key] = m;
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
    std[key] = Math.sqrt(variance);
  }

  return { mean, std };
}

function scoreAd(ad: AdMetrics, stats: AccountStats): { score: number; breakdown: Record<string, number> } {
  const { mean, std } = stats;
  const confidence = Math.min(ad.impressions / 500, 1.0);
  const useAbsolute = std.roas === 0 && std.ctr === 0;

  let roasScore: number, cpaScore: number, ctrScore: number, cvrScore: number;

  if (useAbsolute) {
    roasScore = absoluteRoasScore(ad.roas);
    cpaScore = absoluteCpaScore(ad.cpa, mean.cpa);
    ctrScore = absoluteCtrScore(ad.ctr);
    cvrScore = absoluteCvrScore(ad.cvr);
  } else {
    roasScore = sigmoid(zScore(ad.roas, mean.roas, std.roas));
    cpaScore = sigmoid(-zScore(ad.cpa, mean.cpa, std.cpa)); // inverted: lower is better
    ctrScore = sigmoid(zScore(ad.ctr, mean.ctr, std.ctr));
    cvrScore = sigmoid(zScore(ad.cvr, mean.cvr, std.cvr));
  }

  // Apply confidence smoothing (pull toward 50 with low data)
  roasScore = confidence * roasScore + (1 - confidence) * 50;
  cpaScore = confidence * cpaScore + (1 - confidence) * 50;
  ctrScore = confidence * ctrScore + (1 - confidence) * 50;
  cvrScore = confidence * cvrScore + (1 - confidence) * 50;

  const fatigueScore = computeFatigue(ad.frequency);

  const score = Math.round(
    roasScore * WEIGHTS.roas +
    cpaScore * WEIGHTS.cpa +
    ctrScore * WEIGHTS.ctr +
    cvrScore * WEIGHTS.cvr +
    fatigueScore * WEIGHTS.fatigue
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown: {
      roas: Math.round(roasScore),
      cpa: Math.round(cpaScore),
      ctr: Math.round(ctrScore),
      cvr: Math.round(cvrScore),
      fatigue: Math.round(fatigueScore),
    },
  };
}

// ---- Route Handler ----

function parseAdRow(r: MetaAdInsightRow) {
  const spend = parseFloat(r.spend);
  const clicks = parseInt(r.clicks);
  const impressions = parseInt(r.impressions);
  const purchases = actionVal(r.actions, "omni_purchase");
  const revenue = actionVal(r.action_values, "omni_purchase");

  return {
    id: r.ad_id || "",
    name: r.ad_name || "Unknown",
    campaignName: r.campaign_name || "",
    campaignId: r.campaign_id || "",
    adsetName: r.adset_name || "",
    spend,
    revenue,
    roas: spend > 0 ? revenue / spend : 0,
    purchases,
    cpa: purchases > 0 ? spend / purchases : 0,
    impressions,
    clicks,
    cpc: parseFloat(r.cpc || "0"),
    cpm: parseFloat(r.cpm || "0"),
    ctr: parseFloat(r.ctr || "0"),
    cvr: clicks > 0 ? (purchases / clicks) * 100 : 0,
    frequency: parseFloat(r.frequency || "0"),
    reach: parseInt(r.reach || "0"),
    addToCart: actionVal(r.actions, "omni_add_to_cart"),
  };
}

export async function GET(request: Request) {
  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Meta Ads not configured" }, { status: 200 });
  }

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset") || "7d";
  const datePreset = PRESET_MAP[preset] || "last_7d";

  try {
    // Step 1: Fetch ad-level insights
    const rows = await getMetaAdInsights(datePreset);
    const parsed = rows.map(parseAdRow);

    // Step 2: Compute account stats for scoring
    const adMetrics: AdMetrics[] = parsed.map((a) => ({
      roas: a.roas, cpa: a.cpa, ctr: a.ctr, cvr: a.cvr,
      frequency: a.frequency, impressions: a.impressions,
    }));
    const stats = computeStats(adMetrics);

    // Step 3: Score each ad
    const scored = parsed.map((ad) => {
      const metrics: AdMetrics = {
        roas: ad.roas, cpa: ad.cpa, ctr: ad.ctr, cvr: ad.cvr,
        frequency: ad.frequency, impressions: ad.impressions,
      };
      const { score, breakdown } = scoreAd(metrics, stats);
      return { ...ad, score, scoreBreakdown: breakdown, confidence: Math.min(ad.impressions / 500, 1.0) };
    });

    // Step 4: Fetch creatives for thumbnails
    const adIds = scored.map((a) => a.id).filter(Boolean);
    const creatives = await getMetaAdCreatives(adIds);

    // Step 5: Merge creative data + status
    const ads = scored.map((ad) => {
      const creative = creatives.get(ad.id);
      return {
        ...ad,
        status: creative?.effective_status || "UNKNOWN",
        thumbnail: creative?.imageUrl || null,
        videoUrl: creative?.videoUrl || null,
        isVideo: creative?.isVideo || false,
        creativeTitle: creative?.title || null,
        creativeBody: creative?.body || null,
      };
    }).sort((a, b) => b.score - a.score);

    return NextResponse.json(
      {
        ads,
        accountAverages: {
          roas: Math.round(stats.mean.roas * 100) / 100,
          cpa: Math.round(stats.mean.cpa * 100) / 100,
          ctr: Math.round(stats.mean.ctr * 100) / 100,
          cvr: Math.round(stats.mean.cvr * 100) / 100,
          frequency: Math.round(stats.mean.frequency * 100) / 100,
        },
      },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (error) {
    console.error("Meta Ads individual API error:", error);
    return NextResponse.json({ error: "Meta API fetch failed" });
  }
}
