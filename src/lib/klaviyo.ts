const KLAVIYO_CLIENT_ID = process.env.KLAVIYO_CLIENT_ID!;
const KLAVIYO_CLIENT_SECRET = process.env.KLAVIYO_CLIENT_SECRET!;
const KLAVIYO_REFRESH_TOKEN = process.env.KLAVIYO_REFRESH_TOKEN!;
const API_REVISION = "2024-10-15";

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }

  const res = await fetch("https://a.klaviyo.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: KLAVIYO_REFRESH_TOKEN,
      client_id: KLAVIYO_CLIENT_ID,
      client_secret: KLAVIYO_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    throw new Error(`Klaviyo token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return cachedToken.access_token;
}

async function klaviyoGet(path: string): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const res = await fetch(`https://a.klaviyo.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      revision: API_REVISION,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Klaviyo API error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

interface MetricAggregateRequest {
  metric_id: string;
  measurements: string[];
  interval: string;
  filter: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _queryMetricAggregate(body: MetricAggregateRequest) {
  const token = await getAccessToken();
  const res = await fetch("https://a.klaviyo.com/api/metric-aggregates/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      revision: API_REVISION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      data: {
        type: "metric-aggregate",
        attributes: {
          metric_id: body.metric_id,
          measurements: body.measurements,
          interval: body.interval,
          filter: [body.filter],
          page_size: 500,
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Klaviyo aggregate error: ${res.status} ${text}`);
  }

  return res.json();
}

export async function getKlaviyoMetrics() {
  if (!KLAVIYO_CLIENT_ID || !KLAVIYO_CLIENT_SECRET || !KLAVIYO_REFRESH_TOKEN) {
    return null;
  }

  try {
    // Get metrics list to find IDs
    const metricsRes = await klaviyoGet("/api/metrics/?filter=equals(name,'Received Email')") as {
      data?: { id: string; attributes: { name: string } }[];
    };

    // Get flows
    const flowsRes = await klaviyoGet("/api/flows/?page[size]=50") as {
      data?: { id: string; attributes: { name: string; status: string; trigger_type: string } }[];
    };

    // Get campaigns (recent)
    const campaignsRes = await klaviyoGet("/api/campaigns/?filter=equals(messages.channel,'email')&sort=-send_time&page[size]=10") as {
      data?: {
        id: string;
        attributes: {
          name: string;
          status: string;
          send_time: string;
          audiences?: { included?: { id: string }[] };
        };
      }[];
    };

    // Get lists for subscriber count
    const listsRes = await klaviyoGet("/api/lists/?page[size]=50") as {
      data?: { id: string; attributes: { name: string; profile_count?: number } }[];
    };

    const totalSubscribers = listsRes.data?.reduce(
      (sum, l) => sum + (l.attributes.profile_count || 0),
      0
    ) || 0;

    const activeFlows = flowsRes.data?.filter((f) => f.attributes.status === "live").length || 0;
    const totalFlows = flowsRes.data?.length || 0;

    const recentCampaigns = campaignsRes.data?.slice(0, 5).map((c) => ({
      name: c.attributes.name,
      status: c.attributes.status,
      sendTime: c.attributes.send_time,
    })) || [];

    const metrics = metricsRes.data?.map((m) => ({
      id: m.id,
      name: m.attributes.name,
    })) || [];

    return {
      totalSubscribers,
      activeFlows,
      totalFlows,
      recentCampaigns,
      metricsCount: metrics.length,
    };
  } catch (error) {
    console.error("Klaviyo error:", error);
    return null;
  }
}
