/**
 * Meta Ads Scoring Algorithm v2 — Bayesian shrinkage, data gates,
 * 4 diagnostic scores + composite.
 *
 * Extracted from /api/dashboard/ads/individual so it can also be
 * used by the ads-intel agent (which calls Meta directly instead
 * of making self-referential HTTP requests).
 */

import { actionVal } from "@/lib/meta";
import type { MetaAdInsightRow } from "@/lib/meta";

// ---- Configuration ----

const WEIGHTS = { hook: 0.15, engage: 0.15, convert: 0.45, freshness: 0.25 };

const DATA_GATES = { minConversions: 5, minImpressions: 2000, minSpend: 20 };

const PRIOR_STRENGTH = 15;

const CONFIDENCE_THRESHOLD = 30;

const CTR_BENCHMARKS = {
  video: { good: 1.0, avg: 0.5 },
  static: { good: 1.5, avg: 0.8 },
};

const FUNNEL_BENCHMARKS = {
  lpToAtc: { good: 8, avg: 4 },
  atcToCheckout: { good: 60, avg: 40 },
  checkoutToPurchase: { good: 70, avg: 50 },
};

// ---- Interfaces ----

export interface ParsedAd {
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

export interface DiagnosticScores {
  hook: number;
  engage: number | null;
  convert: number | null;
  freshness: number;
}

export interface ScoringResult {
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

function benchmarkScore(value: number, good: number, avg: number): number {
  if (value >= good) {
    const excess = Math.min((value - good) / good, 1);
    return 70 + excess * 30;
  }
  if (value >= avg) {
    return 40 + ((value - avg) / (good - avg)) * 30;
  }
  if (value > 0) {
    return 10 + (value / avg) * 30;
  }
  return 5;
}

function shrinkRoas(observedRoas: number, meanRoas: number, conversions: number): number {
  const B = conversions / (conversions + PRIOR_STRENGTH);
  return B * observedRoas + (1 - B) * meanRoas;
}

function computeHookScore(ad: ParsedAd, isVideo: boolean): number {
  const benchmarks = isVideo ? CTR_BENCHMARKS.video : CTR_BENCHMARKS.static;
  return benchmarkScore(ad.ctr, benchmarks.good, benchmarks.avg);
}

function computeEngageScore(ad: ParsedAd): number | null {
  if (ad.landingPageViews < 5) return null;
  const scores: number[] = [];
  if (ad.landingPageViews > 0) {
    scores.push(benchmarkScore((ad.addToCart / ad.landingPageViews) * 100, FUNNEL_BENCHMARKS.lpToAtc.good, FUNNEL_BENCHMARKS.lpToAtc.avg));
  }
  if (ad.addToCart > 0) {
    scores.push(benchmarkScore((ad.initiateCheckout / ad.addToCart) * 100, FUNNEL_BENCHMARKS.atcToCheckout.good, FUNNEL_BENCHMARKS.atcToCheckout.avg));
  }
  if (ad.initiateCheckout > 0) {
    scores.push(benchmarkScore((ad.purchases / ad.initiateCheckout) * 100, FUNNEL_BENCHMARKS.checkoutToPurchase.good, FUNNEL_BENCHMARKS.checkoutToPurchase.avg));
  }
  if (scores.length === 0) return null;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

function computeConvertScore(
  ad: ParsedAd,
  meanRoas: number,
  meanCpa: number
): { score: number | null; shrunkRoas: number | null } {
  if (ad.purchases < DATA_GATES.minConversions) {
    return { score: null, shrunkRoas: null };
  }
  const sRoas = shrinkRoas(ad.roas, meanRoas, ad.purchases);
  let roasScore: number;
  if (sRoas >= 3) roasScore = 80 + Math.min((sRoas - 3) * 5, 20);
  else if (sRoas >= 2) roasScore = 65 + (sRoas - 2) * 15;
  else if (sRoas >= 1) roasScore = 40 + (sRoas - 1) * 25;
  else roasScore = sRoas * 40;

  let cpaScore = 50;
  if (meanCpa > 0 && ad.cpa > 0) {
    const ratio = ad.cpa / meanCpa;
    if (ratio <= 0.5) cpaScore = 90;
    else if (ratio <= 0.8) cpaScore = 70 + ((0.8 - ratio) / 0.3) * 20;
    else if (ratio <= 1.2) cpaScore = 50 + ((1.2 - ratio) / 0.4) * 20;
    else if (ratio <= 2.0) cpaScore = 20 + ((2.0 - ratio) / 0.8) * 30;
    else cpaScore = Math.max(5, 20 - (ratio - 2) * 10);
  }
  const score = roasScore * 0.65 + cpaScore * 0.35;
  return { score: Math.round(Math.max(0, Math.min(100, score))), shrunkRoas: Math.round(sRoas * 100) / 100 };
}

function computeFreshnessScore(ad: ParsedAd): number {
  const exposureUnits = ad.impressions / 1000;
  const decayFactor = Math.pow(exposureUnits + 1, -0.43);
  let score = decayFactor * 100;
  if (ad.frequency > 3.0) {
    const penalty = Math.max(0, 1 - (ad.frequency - 3) * 0.15);
    score *= penalty;
  }
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function scoreAd(
  ad: ParsedAd,
  isVideo: boolean,
  accountMeans: { roas: number; cpa: number }
): ScoringResult {
  const conversions = ad.purchases;
  const confidence = Math.min(1.0, conversions / CONFIDENCE_THRESHOLD);
  const gatesPassed = conversions >= DATA_GATES.minConversions
    && ad.impressions >= DATA_GATES.minImpressions
    && ad.spend >= DATA_GATES.minSpend;

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

  if (!gatesPassed) {
    return {
      score: null,
      status: "gathering_data",
      confidence: Math.round(confidence * 100) / 100,
      diagnostics,
      scoreBreakdown: { hook: diagnostics.hook, engage: diagnostics.engage ?? 50, convert: diagnostics.convert ?? 50, freshness: diagnostics.freshness },
      meta: { shrunkRoas, dataGate: "below_minimum", conversions, isVideo },
    };
  }

  const rawComposite =
    hookScore * WEIGHTS.hook +
    (engageScore ?? 50) * WEIGHTS.engage +
    (convertScore ?? 50) * WEIGHTS.convert +
    freshnessScore * WEIGHTS.freshness;

  const smoothed = confidence * rawComposite + (1 - confidence) * 50;
  const finalScore = Math.round(Math.max(0, Math.min(100, smoothed)));

  return {
    score: finalScore,
    status: "scored",
    confidence: Math.round(confidence * 100) / 100,
    diagnostics,
    scoreBreakdown: { hook: Math.round(hookScore), engage: Math.round(engageScore ?? 50), convert: Math.round(convertScore ?? 50), freshness: Math.round(freshnessScore) },
    meta: { shrunkRoas, dataGate: "passed", conversions, isVideo },
  };
}

export function computeAccountMeans(ads: ParsedAd[]): { roas: number; cpa: number; ctr: number; cvr: number; frequency: number } {
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

export function parseAdRow(r: MetaAdInsightRow): ParsedAd {
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
