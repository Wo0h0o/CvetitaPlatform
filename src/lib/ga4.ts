import { fetchWithTimeout } from "./fetch-utils";
import { logger } from "./logger";

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || "348042832";

// OAuth credentials for token refresh
const CLIENT_ID = process.env.GA4_CLIENT_ID!;
const CLIENT_SECRET = process.env.GA4_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GA4_REFRESH_TOKEN!;

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }

  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  }, 10_000);

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.access_token;
}

interface GA4ReportRow {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}

async function runReport(
  metrics: string[],
  startDate: string,
  endDate: string
): Promise<GA4ReportRow[]> {
  const token = await getAccessToken();

  const res = await fetchWithTimeout(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        metrics: metrics.map((name) => ({ name })),
      }),
    },
    15_000
  );

  if (!res.ok) {
    throw new Error(`GA4 API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.rows || [];
}

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
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return { sessions: { value: 0, change: 0 }, conversionRate: { value: 0, change: 0 } };
  }

  try {
    const today = todayStr();
    const yesterday = daysAgoStr(1);

    const [todayRows, yesterdayRows] = await Promise.all([
      runReport(["sessions", "ecommercePurchases", "totalRevenue"], today, today),
      runReport(["sessions", "ecommercePurchases", "totalRevenue"], yesterday, yesterday),
    ]);

    const parse = (rows: GA4ReportRow[]) => {
      if (!rows.length || !rows[0].metricValues) return { sessions: 0, purchases: 0 };
      return {
        sessions: parseInt(rows[0].metricValues[0]?.value || "0"),
        purchases: parseInt(rows[0].metricValues[1]?.value || "0"),
      };
    };

    const todayData = parse(todayRows);
    const yesterdayData = parse(yesterdayRows);

    const todayCR = todayData.sessions > 0
      ? (todayData.purchases / todayData.sessions) * 100
      : 0;
    const yesterdayCR = yesterdayData.sessions > 0
      ? (yesterdayData.purchases / yesterdayData.sessions) * 100
      : 0;

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
