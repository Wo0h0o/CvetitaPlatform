import { logger } from "./logger";
import { runReport, isGA4Configured } from "./ga4";
import { GA4_BOUND_MARKETS, getGA4PropertyForMarket } from "./google-ads-markets";

type DailyAds = { spend: number; revenue: number; purchases: number };

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
 * `propertyId` defaults to the env GA4_PROPERTY_ID (BG). Stores route
 * passes per-market IDs from `google-ads-markets.ts`; top-strip uses
 * `fetchGoogleAdsByDateAllMarkets` to merge across every bound market.
 *
 * Returns an empty map on any failure — callers should treat this as "no
 * Google Ads data for this period", not as a hard error. Logs the error for
 * ops visibility.
 */
export async function fetchGoogleAdsByDate(
  dates: string[],
  propertyId?: string
): Promise<Map<string, DailyAds>> {
  const byDate = new Map<string, DailyAds>();
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
      propertyId,
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
  byDate: Map<string, DailyAds>,
  dates: string[]
): DailyAds {
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

/**
 * Fan out across every market with a bound GA4 property and merge the
 * per-property byDate maps into one. Used by top-strip to aggregate the
 * global Google Ads section.
 *
 * One GA4 call per property, in parallel — fast and resilient (one failed
 * property doesn't take down the others, since fetchGoogleAdsByDate
 * swallows errors and returns an empty map).
 */
export async function fetchGoogleAdsByDateAllMarkets(
  dates: string[]
): Promise<Map<string, DailyAds>> {
  if (GA4_BOUND_MARKETS.length === 0 || dates.length === 0) {
    return new Map<string, DailyAds>();
  }

  const perMarket = await Promise.all(
    GA4_BOUND_MARKETS.map((market) => {
      const propertyId = getGA4PropertyForMarket(market);
      return propertyId
        ? fetchGoogleAdsByDate(dates, propertyId)
        : Promise.resolve(new Map<string, DailyAds>());
    })
  );

  const merged = new Map<string, DailyAds>();
  for (const m of perMarket) {
    for (const [date, val] of m) {
      const existing = merged.get(date) ?? { spend: 0, revenue: 0, purchases: 0 };
      existing.spend += val.spend;
      existing.revenue += val.revenue;
      existing.purchases += val.purchases;
      merged.set(date, existing);
    }
  }
  return merged;
}
