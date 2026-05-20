import { logger } from "./logger";
import { runReport, isGA4Configured } from "./ga4";

/**
 * Fetch Google Ads metrics from GA4 for a set of dates, returned keyed by
 * ISO date. We query the whole min..max range in one call (cheap) and
 * filter to the requested dates client-side.
 *
 * Two GA4 quirks baked in:
 *   - advertiserAdCost is session-scoped — requires sessionGoogleAdsCampaignName
 *     as a second dimension (see memory: reference_ga4_session_scoped_metrics).
 *     We aggregate by date in code; (not set) campaign rows excluded because
 *     they represent organic/direct revenue with no Google Ads attribution
 *     and inflate ROAS if included (we observed 12x vs real 3.8x once).
 *   - GA4's `date` dim returns "YYYYMMDD"; we normalise to ISO "YYYY-MM-DD"
 *     so callers can index the map with the same date strings they use for
 *     Meta and Shopify.
 *
 * Returns an empty map on any failure — callers should treat this as "no
 * Google Ads data for this period", not as a hard error. Logs the error for
 * ops visibility. Used by both /api/dashboard/home/top-strip (aggregate
 * across all markets) and /api/dashboard/home/stores (per-store, BG only
 * for now since we only have one GA4 property bound).
 */
export async function fetchGoogleAdsByDate(
  dates: string[]
): Promise<Map<string, { spend: number; revenue: number; purchases: number }>> {
  const byDate = new Map<string, { spend: number; revenue: number; purchases: number }>();
  if (!isGA4Configured() || dates.length === 0) return byDate;

  const sorted = [...dates].sort();
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];
  const dateSet = new Set(dates);

  try {
    const rows = await runReport({
      metrics: ["advertiserAdCost", "ecommercePurchases", "totalRevenue"],
      dimensions: ["date", "sessionGoogleAdsCampaignName"],
      startDate: minDate,
      endDate: maxDate,
      // Time-series order so the row stream is monotonic by date. Doesn't
      // affect aggregation correctness; helps debugging.
      orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
      limit: 5000,
    });

    for (const r of rows) {
      const yyyymmdd = r.dimensionValues?.[0]?.value || "";
      const campaign = r.dimensionValues?.[1]?.value || "";
      if (yyyymmdd.length !== 8) continue;
      // Same (not set) filter as /api/dashboard/google-ads route.
      if (campaign === "(not set)" || campaign === "") continue;

      const iso = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
      if (!dateSet.has(iso)) continue;

      const spend = parseFloat(r.metricValues?.[0]?.value || "0");
      const purchases = parseInt(r.metricValues?.[1]?.value || "0");
      const revenue = parseFloat(r.metricValues?.[2]?.value || "0");

      const bucket = byDate.get(iso) ?? { spend: 0, revenue: 0, purchases: 0 };
      bucket.spend += spend;
      bucket.revenue += revenue;
      bucket.purchases += purchases;
      byDate.set(iso, bucket);
    }
  } catch (err) {
    logger.error("fetchGoogleAdsByDate failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Fall through with empty map — callers treat as "no data".
  }

  return byDate;
}

/** Sum across a subset of dates from a byDate map. */
export function sumGoogleAds(
  byDate: Map<string, { spend: number; revenue: number; purchases: number }>,
  dates: string[]
): { spend: number; revenue: number; purchases: number } {
  const out = { spend: 0, revenue: 0, purchases: 0 };
  for (const d of dates) {
    const row = byDate.get(d);
    if (!row) continue;
    out.spend += row.spend;
    out.revenue += row.revenue;
    out.purchases += row.purchases;
  }
  return out;
}
