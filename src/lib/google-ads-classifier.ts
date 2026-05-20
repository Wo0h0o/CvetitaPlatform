/**
 * Google Ads campaign classifier — regex-based heuristics that look at the
 * campaign name and decide whether it's brand-search vs prospecting, and
 * whether it's a Demand Gen / video campaign with view-through attribution.
 *
 * Centralised here because the brand-detection regex had a subtle bug once
 * (commit 8fc92a5: a naive /brand/i matched "NonBrand" and inverted the
 * whole dashboard). Having it in ONE file means the next time the naming
 * convention shifts we fix it in one place + write a test, not in two
 * route files that drift over time.
 */

/**
 * Brand campaigns intercept users who already know the brand and inflate
 * last-click attribution. We separate them so prospecting decisions aren't
 * skewed by brand-search performance.
 *
 * Tricky bit: campaign naming uses "NonBrand" (no space) for prospecting.
 * A naive /brand/i regex would catch it as Brand and invert the dashboard.
 * Strategy: first eliminate non-brand prefixes, then check whole-word brand.
 */
export function isBrandCampaign(name: string): boolean {
  if (/non[\s-]?brand/i.test(name)) return false;
  return /\bbrand\b/i.test(name);
}

/**
 * Demand Gen / video campaigns are view-through-heavy; last-click ROAS
 * undersells them. Flag so the UI can render a tooltip explaining the
 * attribution caveat instead of users panicking at 0x ROAS.
 */
export function isVideoCampaign(name: string): boolean {
  return /demand\s*gen|\bvideo\b/i.test(name);
}
