import type { NextRequest } from "next/server";
import {
  resolveMarket,
  type MarketBinding,
} from "@/lib/store-market-resolver";

// ============================================================
// Helper: parse `?market=` from an /api/dashboard/ads/* request
// ============================================================

export interface AdsMarketResolution {
  /**
   * Integration account IDs to fan out across, or `null` when the request
   * did not supply `?market=`. When `null`, callers should preserve their
   * pre-multi-store behavior and call Meta lib functions without an account
   * id (env fallback) — this is what keeps `/ads/campaigns` and
   * `/ads/adsets` legacy sub-routes working until they're migrated.
   */
  ids: string[] | null;
  /** Bindings for the resolved market, or `null` when `ids` is `null`. */
  bindings: MarketBinding[] | null;
  /** Market code lowercased, or `null` when not provided. */
  marketCode: string | null;
}

/**
 * Resolve a `?market=` search param from an API request into fan-out targets.
 *
 * Returns `{ ids: null }` when `?market=` is absent so callers can fall back
 * to env-default behavior without changing their shape.
 *
 * Throws (via `resolveMarket`) if the market code is provided but invalid —
 * callers should catch and return 400.
 */
export async function resolveAdsMarketFromRequest(
  req: NextRequest
): Promise<AdsMarketResolution> {
  const market = req.nextUrl.searchParams.get("market");
  if (!market) {
    return { ids: null, bindings: null, marketCode: null };
  }
  const resolved = await resolveMarket(market);
  return {
    ids: resolved.allIntegrationAccountIds,
    bindings: resolved.bindings,
    marketCode: resolved.marketCode,
  };
}

// ============================================================
// Helper: aggregate /ads overview across N accounts
// ============================================================

type Overview = {
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  cpa?: number;
  impressions: number;
  clicks: number;
  cpc: number;
  cpm: number;
  ctr: number;
  addToCart: number;
  initiateCheckout: number;
  landingPageViews: number;
  linkClicks: number;
  period: { start: string; end: string };
};

/**
 * Sum additive fields across per-account overview responses, recompute
 * derived ratios from the sums. Returns a single blended Overview.
 *
 * Derived metrics (roas, cpa, cpc, cpm, ctr) cannot be averaged — they must
 * be recomputed from the summed numerators/denominators. A weighted average
 * of per-account ratios would be nearly right but not exact when spend or
 * impressions are uneven across accounts.
 */
export function aggregateOverview(parts: Overview[]): Overview {
  if (parts.length === 0) {
    return {
      spend: 0, revenue: 0, roas: 0, purchases: 0, cpa: 0,
      impressions: 0, clicks: 0, cpc: 0, cpm: 0, ctr: 0,
      addToCart: 0, initiateCheckout: 0, landingPageViews: 0, linkClicks: 0,
      period: { start: "", end: "" },
    };
  }
  if (parts.length === 1) return parts[0];

  const sum = (fn: (p: Overview) => number) =>
    parts.reduce((acc, p) => acc + fn(p), 0);

  const spend = sum((p) => p.spend);
  const revenue = sum((p) => p.revenue);
  const purchases = sum((p) => p.purchases);
  const impressions = sum((p) => p.impressions);
  const clicks = sum((p) => p.clicks);

  // Period: accounts should be on the same preset window, so take from the
  // first account with a populated period (some accounts may return empty
  // periods when they have no data in the range).
  const period = parts.find((p) => p.period.start && p.period.end)?.period ??
    parts[0].period;

  return {
    spend,
    revenue,
    roas: spend > 0 ? revenue / spend : 0,
    purchases,
    cpa: purchases > 0 ? spend / purchases : 0,
    impressions,
    clicks,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    addToCart: sum((p) => p.addToCart),
    initiateCheckout: sum((p) => p.initiateCheckout),
    landingPageViews: sum((p) => p.landingPageViews),
    linkClicks: sum((p) => p.linkClicks),
    period,
  };
}
