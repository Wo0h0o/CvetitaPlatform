import { fetchWithTimeout } from "./fetch-utils";
import { logger } from "./logger";

/**
 * GA4 Data API client.
 *
 * Single source of truth for OAuth refresh + runReport across every
 * dashboard route. Previously each route file shipped its own copy of the
 * OAuth/runReport boilerplate, with subtly different signatures — making
 * cross-route improvements impossible and causing 3 independent token
 * refreshes on cold start.
 *
 * GA4 gotchas worth remembering (see memory: `reference_ga4_session_scoped_metrics`):
 *   - `advertiserAdCost`, `advertiserAdClicks`, `advertiserAdImpressions`
 *     are session-scoped and need a session dimension (e.g.
 *     `sessionGoogleAdsCampaignName`). Querying them with `date` alone
 *     returns HTTP 400 INVALID_ARGUMENT.
 *   - Default orderBy is the first metric desc. For time-series you usually
 *     want orderBy on the date dimension ascending — pass it explicitly.
 */

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || "348042832";
const CLIENT_ID = process.env.GA4_CLIENT_ID;
const CLIENT_SECRET = process.env.GA4_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GA4_REFRESH_TOKEN;

let cachedToken: { access_token: string; expires_at: number } | null = null;

export interface GA4Row {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}

export interface GA4OrderBy {
  metric?: { metricName: string };
  dimension?: { dimensionName: string };
  desc?: boolean;
}

export interface GA4DimensionFilter {
  filter?: {
    fieldName: string;
    inListFilter?: { values: string[] };
    stringFilter?: { matchType?: "EXACT" | "CONTAINS"; value: string };
  };
  // Other filter expressions (andGroup, orGroup, notExpression) can be added
  // as we need them — passing through unknown keys via index signature.
  [key: string]: unknown;
}

export interface RunReportOptions {
  metrics: string[];
  dimensions?: string[];
  startDate: string;
  endDate: string;
  limit?: number;
  /** Defaults to first metric desc. Override for time-series (date asc). */
  orderBys?: GA4OrderBy[];
  /** GA4 dimensionFilter object — passed through verbatim. */
  dimensionFilter?: GA4DimensionFilter;
}

export function isGA4Configured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

async function getAccessToken(): Promise<string> {
  // 60s buffer prevents in-flight requests from racing against expiry. On
  // serverless cold start this is the only place a refresh ever runs — every
  // subsequent route call within the same lambda reuses the cached token.
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }

  const res = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        refresh_token: REFRESH_TOKEN!,
        grant_type: "refresh_token",
      }),
    },
    10_000
  );

  if (!res.ok) {
    throw new Error(`GA4 token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.access_token;
}

export async function runReport(opts: RunReportOptions): Promise<GA4Row[]> {
  const token = await getAccessToken();

  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: opts.startDate, endDate: opts.endDate }],
    metrics: opts.metrics.map((name) => ({ name })),
  };
  if (opts.dimensions?.length) {
    body.dimensions = opts.dimensions.map((name) => ({ name }));
  }
  if (opts.orderBys?.length) {
    body.orderBys = opts.orderBys;
  } else {
    // Sensible default — first metric desc. Callers that need time-series
    // order pass orderBys explicitly.
    body.orderBys = [{ metric: { metricName: opts.metrics[0] }, desc: true }];
  }
  if (opts.limit) body.limit = opts.limit;
  if (opts.dimensionFilter) body.dimensionFilter = opts.dimensionFilter;

  const res = await fetchWithTimeout(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    15_000
  );

  if (!res.ok) {
    throw new Error(`GA4 runReport ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.rows || [];
}

/* ------------------------------------------------------------------ */
/* Home-dashboard convenience helper. Used by /api/dashboard/kpis.    */
/* ------------------------------------------------------------------ */

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}
function daysAgoStr(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}
function calcChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export async function getGA4KPIs() {
  if (!isGA4Configured()) {
    return { sessions: { value: 0, change: 0 }, conversionRate: { value: 0, change: 0 } };
  }

  try {
    const today = todayStr();
    const yesterday = daysAgoStr(1);

    const [todayRows, yesterdayRows] = await Promise.all([
      runReport({ metrics: ["sessions", "ecommercePurchases", "totalRevenue"], startDate: today, endDate: today }),
      runReport({ metrics: ["sessions", "ecommercePurchases", "totalRevenue"], startDate: yesterday, endDate: yesterday }),
    ]);

    const parse = (rows: GA4Row[]) => {
      if (!rows.length || !rows[0].metricValues) return { sessions: 0, purchases: 0 };
      return {
        sessions: parseInt(rows[0].metricValues[0]?.value || "0"),
        purchases: parseInt(rows[0].metricValues[1]?.value || "0"),
      };
    };

    const todayData = parse(todayRows);
    const yesterdayData = parse(yesterdayRows);

    const todayCR = todayData.sessions > 0 ? (todayData.purchases / todayData.sessions) * 100 : 0;
    const yesterdayCR = yesterdayData.sessions > 0 ? (yesterdayData.purchases / yesterdayData.sessions) * 100 : 0;

    return {
      sessions: {
        value: todayData.sessions,
        change: calcChange(todayData.sessions, yesterdayData.sessions),
      },
      conversionRate: {
        value: Math.round(todayCR * 100) / 100,
        change: Math.round((todayCR - yesterdayCR) * 100) / 100,
      },
    };
  } catch (error) {
    logger.error("GA4 error", { service: "ga4", error: String(error) });
    return { sessions: { value: 0, change: 0 }, conversionRate: { value: 0, change: 0 } };
  }
}
