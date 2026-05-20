/**
 * Per-market GA4 property bindings for Google Ads data.
 *
 * Each Cvetita storefront has (or eventually will have) its own GA4 property.
 * Our refresh token currently has access to two:
 *
 *   bg → cvetitaherbal.com            (348042832)
 *   gr → cvetitaherbal.com/el-gr      (529025692)
 *
 * Other markets (RO/DE/IT/UK/SK) either don't have a GA4 property yet, or
 * theirs isn't bound to our OAuth token. They surface as "GA4 не свързан"
 * in the UI; adding one is a single-line change here.
 *
 * Discovery: `scripts/probe-ga4-multi-market.mjs` lists everything our token
 * can reach via the Analytics Admin API. Run it whenever a new market is
 * provisioned to find its property ID.
 */
export const MARKET_GA4_PROPERTIES: Record<string, string> = {
  bg: "348042832",
  gr: "529025692",
};

/** Property ID for a market, or null if no binding exists. */
export function getGA4PropertyForMarket(marketCode: string): string | null {
  return MARKET_GA4_PROPERTIES[marketCode] ?? null;
}

/**
 * All market codes with a bound GA4 property. Top-strip iterates this to
 * aggregate Google Ads across every bound market into the global section.
 */
export const GA4_BOUND_MARKETS: readonly string[] = Object.keys(MARKET_GA4_PROPERTIES);
