import { NextRequest, NextResponse } from "next/server";
import { getMetaAdInsights, getMetaAdCreatives, actionVal } from "@/lib/meta";
import type { MetaAdInsightRow } from "@/lib/meta";
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

// ============================================================
// Scoring Algorithm v2 — Bayesian shrinkage, data gates,
// 4 diagnostic scores + composite
// ============================================================

// ---- Configuration ----

const WEIGHTS = { hook: 0.15, engage: 0.15, convert: 0.45, freshness: 0.25 };

// Minimum thresholds before scoring (below = "Gathering Data")
const DATA_GATES = { minConversions: 5, minImpressions: 2000, minSpend: 20 };

// Bayesian shrinkage: how many conversions worth of prior belief
const PRIOR_STRENGTH = 15;

// Full confidence at 30 conversions
const CONFIDENCE_THRESHOLD = 30;

// Type-specific CTR benchmarks (percent)
const CTR_BENCHMARKS = {
  video: { good: 1.0, avg: 0.5 },
  static: { good: 1.5, avg: 0.8 },
};

// Funnel step benchmarks (percent)
const FUNNEL_BENCHMARKS = {
  lpToAtc: { good: 8, avg: 4 },       // LP views → Add to Cart
  atcToCheckout: { good: 60, avg: 40 }, // ATC → Checkout
  checkoutToPurchase: { good: 70, avg: 50 }, // Checkout → Purchase
};

// ---- Interfaces ----

interface ParsedAd {
  id: string;
  name: string;
  campaignName: string;
  campaignId: string;
  adsetName: string;
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  cpa: number;
  impressions: number;
  clicks: number;
  cpc: number;
  cpm: number;
  ctr: number;
  cvr: number;
  frequency: number;
  reach: number;
  addToCart: number;
  landingPageViews: number;
  initiateCheckout: number;
}

interface DiagnosticScores {
  hook: number;
  engage: number | null;
  convert: number | null;
  freshness: number;
}

interface ScoringResult {
  score: number | null;
  status: "scored" | "gathering_data";
  confidence: number;
  diagnostics: DiagnosticScores;
  scoreBreakdown: { hook: number; engage: number; convert: number; freshness: number };
  meta: {
    shrunkRoas: number | null;
    dataGate: "passed" | "below_minimum";
    conversions: number;
    isVideo: boolean;
  };
}

// ---- Scoring Functions ----

/** Map a value to 0-100 based on type-specific benchmarks */
function benchmarkScore(value: number, good: number, avg: number): number {
  if (value >= good) {
    // Scale 70-100 for values at or above "good"
    const excess = Math.min((value - good) / good, 1);
    return 70 + excess * 30;
  }
  if (value >= avg) {
    // Scale 40-70 between avg and good
    return 40 + ((value - avg) / (good - avg)) * 30;
  }
  if (value > 0) {
    // Scale 10-40 below avg
    return 10 + (value / avg) * 30;
  }
  return 5;
}

/** Bayesian shrinkage: pull observed ROAS toward account mean */
function shrinkRoas(observedRoas: number, meanRoas: number, conversions: number): number {
  const B = conversions / (conversions + PRIOR_STRENGTH);
  return B * observedRoas + (1 - B) * meanRoas;
}

/** Hook Score: how well does the ad capture attention? */
function computeHookScore(ad: ParsedAd, isVideo: boolean): number {
  const benchmarks = isVideo ? CTR_BENCHMARKS.video : CTR_BENCHMARKS.static;
  return benchmarkScore(ad.ctr, benchmarks.good, benchmarks.avg);
}

/** Engage Score: funnel health (LP → ATC → Checkout → Purchase) */
function computeEngageScore(ad: ParsedAd): number | null {
  // Need landing page views to calculate funnel
  if (ad.landingPageViews < 5) return null;

  const scores: number[] = [];

  // LP → ATC
  if (ad.landingPageViews > 0) {
    const lpToAtcRate = (ad.addToCart / ad.landingPageViews) * 100;
    scores.push(benchmarkScore(lpToAtcRate, FUNNEL_BENCHMARKS.lpToAtc.good, FUNNEL_BENCHMARKS.lpToAtc.avg));
  }

  // ATC → Checkout
  if (ad.addToCart > 0) {
    const atcToCheckout = (ad.initiateCheckout / ad.addToCart) * 100;
    scores.push(benchmarkScore(atcToCheckout, FUNNEL_BENCHMARKS.atcToCheckout.good, FUNNEL_BENCHMARKS.atcToCheckout.avg));
  }

  // Checkout → Purchase
  if (ad.initiateCheckout > 0) {
    const checkoutToPurchase = (ad.purchases / ad.initiateCheckout) * 100;
    scores.push(benchmarkScore(checkoutToPurchase, FUNNEL_BENCHMARKS.checkoutToPurchase.good, FUNNEL_BENCHMARKS.checkoutToPurchase.avg));
  }

  if (scores.length === 0) return null;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

/** Convert Score: Bayesian-shrunk ROAS + CPA efficiency */
function computeConvertScore(
  ad: ParsedAd,
  meanRoas: number,
  meanCpa: number
): { score: number | null; shrunkRoas: number | null } {
  if (ad.purchases < DATA_GATES.minConversions) {
    return { score: null, shrunkRoas: null };
  }

  const sRoas = shrinkRoas(ad.roas, meanRoas, ad.purchases);

  // ROAS score: 0 → 0, 1 → 40, 2 → 65, 3+ → 80+
  let roasScore: number;
  if (sRoas >= 3) roasScore = 80 + Math.min((sRoas - 3) * 5, 20);
  else if (sRoas >= 2) roasScore = 65 + (sRoas - 2) * 15;
  else if (sRoas >= 1) roasScore = 40 + (sRoas - 1) * 25;
  else roasScore = sRoas * 40;

  // CPA efficiency: ratio to account mean (lower is better)
  let cpaScore = 50;
  if (meanCpa > 0 && ad.cpa > 0) {
    const ratio = ad.cpa / meanCpa;
    if (ratio <= 0.5) cpaScore = 90;
    else if (ratio <= 0.8) cpaScore = 70 + ((0.8 - ratio) / 0.3) * 20;
    else if (ratio <= 1.2) cpaScore = 50 + ((1.2 - ratio) / 0.4) * 20;
    else if (ratio <= 2.0) cpaScore = 20 + ((2.0 - ratio) / 0.8) * 30;
    else cpaScore = Math.max(5, 20 - (ratio - 2) * 10);
  }

  // Weighted: 65% ROAS, 35% CPA efficiency
  const score = roasScore * 0.65 + cpaScore * 0.35;

  return { score: Math.round(Math.max(0, Math.min(100, score))), shrunkRoas: Math.round(sRoas * 100) / 100 };
}

/** Freshness Score: impression-based decay + frequency penalty */
function computeFreshnessScore(ad: ParsedAd): number {
  // Meta's research: click likelihood = (N+1)^(-0.43)
  // We use impressions/1000 as proxy for repeated exposure
  const exposureUnits = ad.impressions / 1000;
  const decayFactor = Math.pow(exposureUnits + 1, -0.43);
  let score = decayFactor * 100;

  // Frequency penalty: kicks in above 3.0
  if (ad.frequency > 3.0) {
    const penalty = Math.max(0, 1 - (ad.frequency - 3) * 0.15);
    score *= penalty;
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Main scoring function */
function scoreAd(
  ad: ParsedAd,
  isVideo: boolean,
  accountMeans: { roas: number; cpa: number }
): ScoringResult {
  const conversions = ad.purchases;
  const confidence = Math.min(1.0, conversions / CONFIDENCE_THRESHOLD);

  // Data gate check
  const gatesPassed = conversions >= DATA_GATES.minConversions
    && ad.impressions >= DATA_GATES.minImpressions
    && ad.spend >= DATA_GATES.minSpend;

  // Layer 1: Diagnostic scores
  const hookScore = computeHookScore(ad, isVideo);
  const engageScore = computeEngageScore(ad);
  const { score: convertScore, shrunkRoas } = computeConvertScore(ad, accountMeans.roas, accountMeans.cpa);
  const freshnessScore = computeFreshnessScore(ad);

  const diagnostics: DiagnosticScores = {
    hook: Math.round(hookScore),
    engage: engageScore !== null ? Math.round(engageScore) : null,
    convert: convertScore,
    freshness: freshnessScore,
  };

  // Layer 2: Composite score (only if data gates passed)
  if (!gatesPassed) {
    return {
      score: null,
      status: "gathering_data",
      confidence: Math.round(confidence * 100) / 100,
      diagnostics,
      scoreBreakdown: {
        hook: diagnostics.hook,
        engage: diagnostics.engage ?? 50,
        convert: diagnostics.convert ?? 50,
        freshness: diagnostics.freshness,
      },
      meta: { shrunkRoas, dataGate: "below_minimum", conversions, isVideo },
    };
  }

  // Composite: weighted sum with confidence smoothing
  const rawHook = hookScore;
  const rawEngage = engageScore ?? 50; // default to neutral if no funnel data
  const rawConvert = convertScore ?? 50;
  const rawFreshness = freshnessScore;

  const rawComposite =
    rawHook * WEIGHTS.hook +
    rawEngage * WEIGHTS.engage +
    rawConvert * WEIGHTS.convert +
    rawFreshness * WEIGHTS.freshness;

  // Confidence smoothing: pull toward 50 with low data
  const smoothed = confidence * rawComposite + (1 - confidence) * 50;
  const finalScore = Math.round(Math.max(0, Math.min(100, smoothed)));

  return {
    score: finalScore,
    status: "scored",
    confidence: Math.round(confidence * 100) / 100,
    diagnostics,
    scoreBreakdown: {
      hook: Math.round(rawHook),
      engage: Math.round(rawEngage),
      convert: Math.round(rawConvert),
      freshness: Math.round(rawFreshness),
    },
    meta: { shrunkRoas, dataGate: "passed", conversions, isVideo },
  };
}

// ---- Account-level means (for Bayesian shrinkage) ----

function computeAccountMeans(ads: ParsedAd[]): { roas: number; cpa: number; ctr: number; cvr: number; frequency: number } {
  const withConversions = ads.filter((a) => a.purchases > 0);
  const mean = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  return {
    roas: mean(withConversions.map((a) => a.roas).filter(isFinite)),
    cpa: mean(withConversions.map((a) => a.cpa).filter(isFinite)),
    ctr: mean(ads.map((a) => a.ctr).filter(isFinite)),
    cvr: mean(withConversions.map((a) => a.cvr).filter(isFinite)),
    frequency: mean(ads.map((a) => a.frequency).filter(isFinite)),
  };
}

// ---- Route Handler ----

function parseAdRow(r: MetaAdInsightRow): ParsedAd {
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

    // Step 4: Score each ad with new v2 algorithm
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
        // v2 scoring
        score: scoring.score ?? 0, // 0 for gathering_data (UI sorts by score)
        scoringStatus: scoring.status,
        confidence: scoring.confidence,
        diagnostics: scoring.diagnostics,
        scoreBreakdown: scoring.scoreBreakdown,
        scoreMeta: scoring.meta,
      };
    }).sort((a, b) => {
      // Scored ads first, then gathering_data; within each group sort by score desc
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
