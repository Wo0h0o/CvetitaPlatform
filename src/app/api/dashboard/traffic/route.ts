import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/api-auth";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { getDateRange, type DatePreset } from "@/lib/dates";

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
  limit?: number,
  /** Optional GA4 dimensionFilter — passed through verbatim. */
  dimensionFilter?: Record<string, unknown>
): Promise<GA4Row[]> {
  const token = await getAccessToken();
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate, endDate }],
    metrics: metrics.map((name) => ({ name })),
    dimensions: dimensions.map((name) => ({ name })),
    orderBys: [{ metric: { metricName: metrics[0] }, desc: true }],
  };
  if (limit) body.limit = limit;
  if (dimensionFilter) body.dimensionFilter = dimensionFilter;

  const res = await fetchWithTimeout(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    15_000
  );
  if (!res.ok) throw new Error(`GA4: ${res.status}`);
  const data = await res.json();
  return data.rows || [];
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
    const start = range.from;
    const end = range.to;

    // Same 5 metrics on the previous equal-length period — used by the UI
    // to render the design-contract delta (§4). dates.ts already produces
    // compFrom/compTo; we just consume them. Kept as a separate runReport
    // (not multi-dateRange) because the response shape stays simpler and
    // agent-context.ts can keep reading `overview.sessions` as a number.
    const overviewMetrics = ["sessions", "totalUsers", "engagementRate", "keyEvents", "ecommercePurchases"];
    // Standard GA4 e-commerce event names — the dataLayer on cvetitaherbal.com
    // sends these via Shopify's GA4 integration. If a store doesn't track them,
    // the UI renders an empty state explaining what's missing.
    const FUNNEL_EVENTS = ["view_item", "add_to_cart", "begin_checkout", "purchase"];
    const funnelFilter = {
      filter: { fieldName: "eventName", inListFilter: { values: FUNNEL_EVENTS } },
    };

    // Google Ads campaign metrics — flow through GA4 when property is linked
    // to a Google Ads account. probe-google-ads-via-ga4.mjs confirmed these
    // dimensions/metrics are populated for property 348042832 (2026-05-20).
    // If no link / no spend, all metrics return 0 and UI renders an empty
    // state pointing the user to GA4 → Product Links → Google Ads.
    const adsDims = ["sessionGoogleAdsCampaignName"];
    const adsMetrics = ["advertiserAdCost", "advertiserAdClicks", "advertiserAdImpressions", "ecommercePurchases", "totalRevenue"];

    const [
      channelRows,
      pageRows,
      deviceRows,
      overviewRows,
      prevOverviewRows,
      funnelRows,
      prevFunnelRows,
      topEventsRows,
      prevTopEventsRows,
      googleAdsRows,
      prevGoogleAdsRows,
      dailyRows,
    ] = await Promise.all([
      runReport(["sessions", "totalUsers", "engagementRate"], ["sessionDefaultChannelGroup"], start, end, 8),
      runReport(["sessions", "engagementRate", "keyEvents"], ["pagePath"], start, end, 10),
      runReport(["sessions", "totalUsers"], ["deviceCategory"], start, end),
      runReport(overviewMetrics, [], start, end),
      runReport(overviewMetrics, [], range.compFrom, range.compTo),
      runReport(["eventCount"], ["eventName"], start, end, undefined, funnelFilter),
      runReport(["eventCount"], ["eventName"], range.compFrom, range.compTo, undefined, funnelFilter),
      runReport(["eventCount", "totalUsers"], ["eventName"], start, end, 10),
      runReport(["eventCount"], ["eventName"], range.compFrom, range.compTo, 50),
      runReport(adsMetrics, adsDims, start, end, 25),
      runReport(adsMetrics, adsDims, range.compFrom, range.compTo, 25),
      // Daily time series — feeds the hero-strip sparklines. Same 5 overview
      // metrics, broken down by date so each MiniKpi can render its own trend.
      // runReport's default orderBy is the first metric desc; we sort by date
      // client-side after parsing (GA4 doesn't take dimension-only orderBys
      // when a metric orderBy is also implicit).
      runReport(overviewMetrics, ["date"], start, end),
    ]);

    const channels = channelRows.map((r) => ({
      channel: r.dimensionValues?.[0]?.value || "Unknown",
      sessions: parseInt(r.metricValues?.[0]?.value || "0"),
      users: parseInt(r.metricValues?.[1]?.value || "0"),
      engagementRate: parseFloat(r.metricValues?.[2]?.value || "0"),
    }));

    const topPages = pageRows.map((r) => ({
      page: r.dimensionValues?.[0]?.value || "/",
      sessions: parseInt(r.metricValues?.[0]?.value || "0"),
      engagementRate: parseFloat(r.metricValues?.[1]?.value || "0"),
      conversions: parseInt(r.metricValues?.[2]?.value || "0"),
    }));

    const devices = deviceRows.map((r) => ({
      device: r.dimensionValues?.[0]?.value || "Unknown",
      sessions: parseInt(r.metricValues?.[0]?.value || "0"),
      users: parseInt(r.metricValues?.[1]?.value || "0"),
    }));

    const parseOverview = (rows: GA4Row[]) => {
      const v = rows[0]?.metricValues || [];
      return {
        sessions: parseInt(v[0]?.value || "0"),
        users: parseInt(v[1]?.value || "0"),
        engagementRate: parseFloat(v[2]?.value || "0"),
        conversions: parseInt(v[3]?.value || "0"),
        purchases: parseInt(v[4]?.value || "0"),
      };
    };
    const overview = parseOverview(overviewRows);
    const previousOverview = parseOverview(prevOverviewRows);

    // Funnel: collapse the filtered event rows into a {event_name: count}
    // map so the UI can render steps in a fixed display order regardless of
    // how GA4 sorted them. Missing events default to 0 (handled in UI).
    const rowsToMap = (rows: GA4Row[]): Record<string, number> => {
      const m: Record<string, number> = {};
      for (const r of rows) {
        const name = r.dimensionValues?.[0]?.value;
        if (name) m[name] = parseInt(r.metricValues?.[0]?.value || "0");
      }
      return m;
    };
    const funnel = rowsToMap(funnelRows);
    const previousFunnel = rowsToMap(prevFunnelRows);

    // Top events: list of {name, count, users} for the current period plus
    // a lookup map of previous counts so the UI can compute per-event delta
    // without a second pass. We pull top 50 previous to cover edge cases
    // where event rank shifts between periods.
    const topEvents = topEventsRows.map((r) => ({
      name: r.dimensionValues?.[0]?.value || "unknown",
      count: parseInt(r.metricValues?.[0]?.value || "0"),
      users: parseInt(r.metricValues?.[1]?.value || "0"),
    }));
    const previousTopEvents = rowsToMap(prevTopEventsRows);

    // Google Ads — per-campaign + totals. Drop rows with zero spend AND zero
    // clicks (GA4 sometimes returns (not set) rows for sessions that touched
    // a Google Ads campaign cookie but had no actual ad activity).
    const parseAdsRows = (rows: GA4Row[]) => {
      const campaigns = rows
        .map((r) => ({
          name: r.dimensionValues?.[0]?.value || "(not set)",
          spend: parseFloat(r.metricValues?.[0]?.value || "0"),
          clicks: parseInt(r.metricValues?.[1]?.value || "0"),
          impressions: parseInt(r.metricValues?.[2]?.value || "0"),
          purchases: parseInt(r.metricValues?.[3]?.value || "0"),
          revenue: parseFloat(r.metricValues?.[4]?.value || "0"),
        }))
        .filter((c) => c.spend > 0 || c.clicks > 0);
      const totals = campaigns.reduce(
        (acc, c) => ({
          spend: acc.spend + c.spend,
          clicks: acc.clicks + c.clicks,
          impressions: acc.impressions + c.impressions,
          purchases: acc.purchases + c.purchases,
          revenue: acc.revenue + c.revenue,
        }),
        { spend: 0, clicks: 0, impressions: 0, purchases: 0, revenue: 0 }
      );
      return { campaigns, totals };
    };
    const googleAds = parseAdsRows(googleAdsRows);
    const previousGoogleAds = parseAdsRows(prevGoogleAdsRows);

    // Daily time series. GA4's `date` dimension comes back as "YYYYMMDD"
    // strings; we sort asc so the sparkline reads left-to-right as time
    // moves forward. Engagement rate is a fraction in GA4 (0–1), so we
    // keep it raw — the UI presents it consistently with the hero metric.
    const dailyOverview = dailyRows
      .map((r) => ({
        date: r.dimensionValues?.[0]?.value || "",
        sessions: parseInt(r.metricValues?.[0]?.value || "0"),
        users: parseInt(r.metricValues?.[1]?.value || "0"),
        engagementRate: parseFloat(r.metricValues?.[2]?.value || "0"),
        conversions: parseInt(r.metricValues?.[3]?.value || "0"),
        purchases: parseInt(r.metricValues?.[4]?.value || "0"),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json(
      {
        period: range.label,
        compare: { from: range.compFrom, to: range.compTo, label: "пр. период" },
        overview,
        previousOverview,
        channels,
        topPages,
        devices,
        funnel,
        previousFunnel,
        topEvents,
        previousTopEvents,
        googleAds,
        previousGoogleAds,
        dailyOverview,
      },
      { headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=300" } }
    );
  } catch (error) {
    logger.error("Traffic API error", { error: String(error) });
    return NextResponse.json({ error: "GA4 fetch failed" }, { status: 500 });
  }
}
