import { NextResponse } from "next/server";

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || "348042832";
const CLIENT_ID = process.env.GA4_CLIENT_ID;
const CLIENT_SECRET = process.env.GA4_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GA4_REFRESH_TOKEN;

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
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
  limit?: number
): Promise<GA4Row[]> {
  const token = await getAccessToken();
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate, endDate }],
    metrics: metrics.map((name) => ({ name })),
    dimensions: dimensions.map((name) => ({ name })),
    orderBys: [{ metric: { metricName: metrics[0] }, desc: true }],
  };
  if (limit) body.limit = limit;

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`GA4: ${res.status}`);
  const data = await res.json();
  return data.rows || [];
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

export async function GET() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return NextResponse.json({ error: "GA4 not configured" }, { status: 200 });
  }

  try {
    const start = daysAgoStr(30);
    const end = daysAgoStr(0);

    const [channelRows, pageRows, deviceRows, overviewRows] = await Promise.all([
      runReport(["sessions", "totalUsers", "engagementRate"], ["sessionDefaultChannelGroup"], start, end, 8),
      runReport(["sessions", "engagementRate", "keyEvents"], ["pagePath"], start, end, 10),
      runReport(["sessions", "totalUsers"], ["deviceCategory"], start, end),
      runReport(["sessions", "totalUsers", "engagementRate", "keyEvents", "ecommercePurchases"], [], start, end),
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

    const ov = overviewRows[0]?.metricValues || [];
    const overview = {
      sessions: parseInt(ov[0]?.value || "0"),
      users: parseInt(ov[1]?.value || "0"),
      engagementRate: parseFloat(ov[2]?.value || "0"),
      conversions: parseInt(ov[3]?.value || "0"),
      purchases: parseInt(ov[4]?.value || "0"),
    };

    return NextResponse.json(
      { period: "30 дни", overview, channels, topPages, devices },
      { headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=300" } }
    );
  } catch (error) {
    console.error("Traffic API error:", error);
    return NextResponse.json({ error: "GA4 fetch failed" });
  }
}
