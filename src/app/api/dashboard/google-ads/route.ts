import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/api-auth";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { getDateRange, type DatePreset } from "@/lib/dates";

// Pulls Google Ads cost/revenue via the GA4 Data API. Requires the GA4
// property to be linked to a Google Ads account (verified by the probe
// script in /scripts/probe-google-ads-via-ga4.mjs).
//
// The GA4 row keyed "(not set)" is a non-Google-Ads-attribution bucket
// (organic/direct/email purchases). It must be filtered out — otherwise
// the aggregate ROAS becomes wildly inflated (we saw 12x vs real ~3.8x).

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || "348042832";
const CLIENT_ID = process.env.GA4_CLIENT_ID;
const CLIENT_SECRET = process.env.GA4_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GA4_REFRESH_TOKEN;

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  }, 10_000);
  const data = await res.json();
  cachedToken = { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return cachedToken.access_token;
}

interface GA4Row {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}

async function runReport(
  metrics: string[],
  dimensions: string[],
  startDate: string,
  endDate: string,
  limit = 50,
  orderBys?: Record<string, unknown>[]
): Promise<GA4Row[]> {
  const token = await getAccessToken();
  const res = await fetchWithTimeout(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        metrics: metrics.map((name) => ({ name })),
        dimensions: dimensions.map((name) => ({ name })),
        orderBys: orderBys || [{ metric: { metricName: metrics[0] }, desc: true }],
        limit,
      }),
    },
    15_000
  );
  if (!res.ok) throw new Error(`GA4: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.rows || [];
}

// Brand campaigns intercept users who already know the brand and inflate
// last-click attribution. Separating them prevents non-brand prospecting
// decisions from being skewed by brand-search performance.
//
// Caveat: naming convention here is "NonBrand" (no space) for prospecting,
// which a naive /brand/i regex catches as "Brand" and inverts the entire
// dashboard. The negative lookbehind excludes any non/non-/non brand prefix
// before requiring "brand" as a whole word.
function isBrandCampaign(name: string): boolean {
  if (/non[\s-]?brand/i.test(name)) return false;
  return /\bbrand\b/i.test(name);
}

// Demand Gen / video campaigns are view-through-heavy; last-click ROAS
// undersells them. Flag so the UI can render a tooltip explaining the
// attribution caveat instead of users panicking at 0x ROAS.
function isVideoCampaign(name: string): boolean {
  return /demand\s*gen|\bvideo\b/i.test(name);
}

interface CampaignRow {
  name: string;
  spend: number;
  clicks: number;
  impressions: number;
  purchases: number;
  revenue: number;
  roas: number;
  ctr: number;
  cpa: number;
  cpc: number;
  isBrand: boolean;
  isVideo: boolean;
}

interface Bucket {
  spend: number;
  revenue: number;
  purchases: number;
  clicks: number;
  impressions: number;
}

function emptyBucket(): Bucket {
  return { spend: 0, revenue: 0, purchases: 0, clicks: 0, impressions: 0 };
}

function bucketRoas(b: Bucket): number {
  return b.spend > 0 ? b.revenue / b.spend : 0;
}

const ADS_METRICS = ["advertiserAdCost", "advertiserAdClicks", "advertiserAdImpressions", "ecommercePurchases", "totalRevenue"];

interface ProcessedPeriod {
  campaigns: CampaignRow[];
  overview: {
    spend: number;
    revenue: number;
    roas: number;
    purchases: number;
    clicks: number;
    impressions: number;
    ctr: number;
    cpa: number;
    cpc: number;
  };
  brandSplit: {
    brand: Bucket & { roas: number; sharePct: number };
    nonBrand: Bucket & { roas: number; sharePct: number };
  };
}

// Given GA4 per-campaign rows, produce the full period payload (campaigns +
// aggregates + brand split). Extracted so we can call it twice — once for
// the current range, once for the comparison range — without duplicating
// the bucket-and-attribute-filter logic.
function processCampaignRows(rows: GA4Row[]): ProcessedPeriod {
  const campaigns: CampaignRow[] = [];
  const all = emptyBucket();
  const brand = emptyBucket();
  const nonBrand = emptyBucket();

  for (const row of rows) {
    const name = row.dimensionValues?.[0]?.value || "(not set)";
    const spend = parseFloat(row.metricValues?.[0]?.value || "0");
    const clicks = parseInt(row.metricValues?.[1]?.value || "0");
    const impressions = parseInt(row.metricValues?.[2]?.value || "0");
    const purchases = parseInt(row.metricValues?.[3]?.value || "0");
    const revenue = parseFloat(row.metricValues?.[4]?.value || "0");

    // Skip the "(not set)" bucket — organic/direct revenue with no Google Ads
    // attribution. Including it inflates ROAS to nonsense (12x vs real 3.8x).
    if (name === "(not set)" || name === "") continue;
    // Skip ghost rows (existed but recorded nothing).
    if (spend === 0 && revenue === 0 && clicks === 0) continue;

    const brandFlag = isBrandCampaign(name);
    const videoFlag = isVideoCampaign(name);

    campaigns.push({
      name,
      spend,
      clicks,
      impressions,
      purchases,
      revenue,
      roas: spend > 0 ? revenue / spend : 0,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpa: purchases > 0 ? spend / purchases : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      isBrand: brandFlag,
      isVideo: videoFlag,
    });

    all.spend += spend;
    all.revenue += revenue;
    all.purchases += purchases;
    all.clicks += clicks;
    all.impressions += impressions;

    const bucket = brandFlag ? brand : nonBrand;
    bucket.spend += spend;
    bucket.revenue += revenue;
    bucket.purchases += purchases;
    bucket.clicks += clicks;
    bucket.impressions += impressions;
  }

  return {
    campaigns,
    overview: {
      spend: all.spend,
      revenue: all.revenue,
      roas: bucketRoas(all),
      purchases: all.purchases,
      clicks: all.clicks,
      impressions: all.impressions,
      ctr: all.impressions > 0 ? all.clicks / all.impressions : 0,
      cpa: all.purchases > 0 ? all.spend / all.purchases : 0,
      cpc: all.clicks > 0 ? all.spend / all.clicks : 0,
    },
    brandSplit: {
      brand: {
        ...brand,
        roas: bucketRoas(brand),
        sharePct: all.spend > 0 ? (brand.spend / all.spend) * 100 : 0,
      },
      nonBrand: {
        ...nonBrand,
        roas: bucketRoas(nonBrand),
        sharePct: all.spend > 0 ? (nonBrand.spend / all.spend) * 100 : 0,
      },
    },
  };
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return NextResponse.json({ error: "GA4 not configured" }, { status: 200 });
  }

  try {
    const preset = (req.nextUrl.searchParams.get("preset") || "30d") as DatePreset;
    const customFrom = req.nextUrl.searchParams.get("from") || undefined;
    const customTo = req.nextUrl.searchParams.get("to") || undefined;
    const range = getDateRange(preset, customFrom, customTo);

    const [currentRows, previousRows, dailyRows] = await Promise.all([
      runReport(ADS_METRICS, ["sessionGoogleAdsCampaignName"], range.from, range.to, 50),
      runReport(ADS_METRICS, ["sessionGoogleAdsCampaignName"], range.compFrom, range.compTo, 50),
      // Daily series for the chart. GA4 quirk: advertiserAd* metrics are
      // session-scoped — querying them with `date` alone returns HTTP 400
      // ("Please add sessionCampaignName to make the request compatible").
      // We add sessionGoogleAdsCampaignName as a second dimension and
      // aggregate by date in code below. limit 2000 covers 90d × ~22
      // campaigns with headroom.
      runReport(
        ADS_METRICS,
        ["date", "sessionGoogleAdsCampaignName"],
        range.from,
        range.to,
        2000,
        [{ dimension: { dimensionName: "date" }, desc: false }]
      ),
    ]);

    const current = processCampaignRows(currentRows);
    const previous = processCampaignRows(previousRows);

    // Per-campaign previous-period lookup. The table needs delta vs previous
    // per row; we key by campaign name. Campaigns that didn't exist in the
    // prior period simply won't match and the UI renders a dash.
    const previousCampaigns: Record<string, { spend: number; revenue: number; roas: number; purchases: number }> = {};
    for (const c of previous.campaigns) {
      previousCampaigns[c.name] = {
        spend: c.spend,
        revenue: c.revenue,
        roas: c.roas,
        purchases: c.purchases,
      };
    }

    // Daily aggregate. Each row is one (date, campaign) pair — we collapse
    // by date and skip the (not set) campaign bucket so the chart's ROAS
    // matches the overview ROAS exactly (same exclusion rule as
    // processCampaignRows). Sort ascending for left-to-right time flow.
    const dailyMap = new Map<string, { date: string; spend: number; clicks: number; impressions: number; purchases: number; revenue: number }>();
    for (const r of dailyRows) {
      const date = r.dimensionValues?.[0]?.value || "";
      const campaign = r.dimensionValues?.[1]?.value || "";
      if (!date) continue;
      if (campaign === "(not set)" || campaign === "") continue;
      const spend = parseFloat(r.metricValues?.[0]?.value || "0");
      const clicks = parseInt(r.metricValues?.[1]?.value || "0");
      const impressions = parseInt(r.metricValues?.[2]?.value || "0");
      const purchases = parseInt(r.metricValues?.[3]?.value || "0");
      const revenue = parseFloat(r.metricValues?.[4]?.value || "0");
      const existing = dailyMap.get(date) ?? { date, spend: 0, clicks: 0, impressions: 0, purchases: 0, revenue: 0 };
      existing.spend += spend;
      existing.clicks += clicks;
      existing.impressions += impressions;
      existing.purchases += purchases;
      existing.revenue += revenue;
      dailyMap.set(date, existing);
    }
    const dailyOverview = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json(
      {
        period: range.label,
        compare: { from: range.compFrom, to: range.compTo, label: "пр. период" },
        overview: current.overview,
        previousOverview: previous.overview,
        brandSplit: current.brandSplit,
        previousBrandSplit: previous.brandSplit,
        campaigns: current.campaigns,
        previousCampaigns,
        dailyOverview,
      },
      { headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=300" } }
    );
  } catch (error) {
    logger.error("Google Ads API error", { error: String(error) });
    return NextResponse.json({ error: "Google Ads fetch failed" }, { status: 500 });
  }
}
