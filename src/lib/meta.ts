const API_VERSION = "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

function getAccountId() { return process.env.META_AD_ACCOUNT_ID || ""; }

// --- Auto-refresh token (keeps it alive indefinitely) ---
let cachedToken: { token: string; refreshedAt: number } | null = null;
const REFRESH_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days

async function getToken(): Promise<string> {
  const envToken = process.env.META_ACCESS_TOKEN || "";
  if (!envToken) return "";

  // Use cached token if refreshed recently (warm instance)
  if (cachedToken && Date.now() - cachedToken.refreshedAt < REFRESH_INTERVAL) {
    return cachedToken.token;
  }

  // Try to refresh for a new 60-day token
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (appId && appSecret) {
    try {
      const currentToken = cachedToken?.token || envToken;
      const res = await fetch(
        `https://graph.facebook.com/${API_VERSION}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: currentToken,
        })
      );
      if (res.ok) {
        const data: { access_token?: string } = await res.json();
        if (data.access_token) {
          cachedToken = { token: data.access_token, refreshedAt: Date.now() };
          return cachedToken.token;
        }
      }
    } catch {
      // Refresh failed — fall through to existing token
    }
  }

  return cachedToken?.token || envToken;
}

// Expose for cron endpoint
export async function refreshToken(): Promise<{ token: string; expiresIn: number } | null> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const currentToken = cachedToken?.token || process.env.META_ACCESS_TOKEN || "";

  if (!appId || !appSecret || !currentToken) return null;

  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/oauth/access_token?` +
    new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: currentToken,
    })
  );

  if (!res.ok) return null;
  const data: { access_token?: string; expires_in?: number } = await res.json();
  if (!data.access_token) return null;

  cachedToken = { token: data.access_token, refreshedAt: Date.now() };
  return { token: data.access_token, expiresIn: data.expires_in || 0 };
}

interface MetaAction {
  action_type: string;
  value: string;
}

interface MetaInsightRow {
  spend: string;
  impressions: string;
  clicks: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
  campaign_name?: string;
  campaign_id?: string;
  date_start: string;
  date_stop: string;
}

interface MetaCampaign {
  id: string;
  name: string;
  effective_status: string;
  objective: string;
}

export function actionVal(actions: MetaAction[] | undefined, type: string): number {
  if (!actions) return 0;
  const a = actions.find((x) => x.action_type === type);
  return a ? parseFloat(a.value) : 0;
}

async function metaFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = await getToken();
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    console.error("Meta API error:", res.status, body);
    throw new Error(`Meta API: ${res.status}`);
  }
  return res.json();
}

async function fetchInsights(params: Record<string, string>): Promise<MetaInsightRow[]> {
  const data = await metaFetch<{ data: MetaInsightRow[] }>(
    `${getAccountId()}/insights`,
    params
  );
  return data.data || [];
}

async function fetchCampaigns(): Promise<MetaCampaign[]> {
  const all: MetaCampaign[] = [];
  const token = await getToken();
  let url: string | null = `${BASE}/${getAccountId()}/campaigns?` +
    new URLSearchParams({
      fields: "name,effective_status,objective",
      limit: "100",
      access_token: token,
    }).toString();

  while (url) {
    const res: Response = await fetch(url);
    if (!res.ok) break;
    const data: { data?: MetaCampaign[]; paging?: { next?: string } } = await res.json();
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return all;
}

export async function getMetaOverview(datePreset: string = "last_7d") {
  const rows = await fetchInsights({
    fields: "spend,impressions,clicks,cpc,cpm,ctr,actions,action_values",
    date_preset: datePreset,
  });

  if (!rows.length) {
    return {
      spend: 0, revenue: 0, roas: 0, purchases: 0,
      impressions: 0, clicks: 0, cpc: 0, cpm: 0, ctr: 0,
      addToCart: 0, initiateCheckout: 0, landingPageViews: 0, linkClicks: 0,
      period: { start: "", end: "" },
    };
  }

  const r = rows[0];
  const spend = parseFloat(r.spend);
  const revenue = actionVal(r.action_values, "omni_purchase");
  const purchases = actionVal(r.actions, "omni_purchase");

  return {
    spend,
    revenue,
    roas: spend > 0 ? revenue / spend : 0,
    purchases,
    cpa: purchases > 0 ? spend / purchases : 0,
    impressions: parseInt(r.impressions),
    clicks: parseInt(r.clicks),
    cpc: parseFloat(r.cpc || "0"),
    cpm: parseFloat(r.cpm || "0"),
    ctr: parseFloat(r.ctr || "0"),
    addToCart: actionVal(r.actions, "omni_add_to_cart"),
    initiateCheckout: actionVal(r.actions, "omni_initiated_checkout"),
    landingPageViews: actionVal(r.actions, "landing_page_view"),
    linkClicks: actionVal(r.actions, "link_click"),
    period: { start: r.date_start, end: r.date_stop },
  };
}

export async function getMetaCampaignInsights(datePreset: string = "last_7d") {
  const [insightRows, campaigns] = await Promise.all([
    fetchInsights({
      fields: "campaign_name,campaign_id,spend,impressions,clicks,cpc,ctr,actions,action_values",
      date_preset: datePreset,
      level: "campaign",
      limit: "50",
    }),
    fetchCampaigns(),
  ]);

  const statusMap = new Map(campaigns.map((c) => [c.id, c.effective_status]));

  return insightRows.map((r) => {
    const spend = parseFloat(r.spend);
    const revenue = actionVal(r.action_values, "omni_purchase");
    const purchases = actionVal(r.actions, "omni_purchase");
    return {
      name: r.campaign_name || "Unknown",
      id: r.campaign_id || "",
      status: statusMap.get(r.campaign_id || "") || "UNKNOWN",
      spend,
      revenue,
      roas: spend > 0 ? revenue / spend : 0,
      purchases,
      impressions: parseInt(r.impressions),
      clicks: parseInt(r.clicks),
      cpc: parseFloat(r.cpc || "0"),
      ctr: parseFloat(r.ctr || "0"),
      addToCart: actionVal(r.actions, "omni_add_to_cart"),
    };
  }).sort((a, b) => b.spend - a.spend);
}

// ---- Ad-level insights ----

export interface MetaAdInsightRow extends MetaInsightRow {
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  frequency?: string;
  reach?: string;
}

export async function getMetaAdInsights(datePreset: string = "last_7d"): Promise<MetaAdInsightRow[]> {
  const data = await metaFetch<{ data: MetaAdInsightRow[] }>(
    `${getAccountId()}/insights`,
    {
      fields: "ad_id,ad_name,campaign_name,campaign_id,adset_name,spend,impressions,clicks,cpc,cpm,ctr,reach,frequency,actions,action_values",
      date_preset: datePreset,
      level: "ad",
      limit: "100",
    }
  );
  return data.data || [];
}

// ---- Ad creatives (batch) ----

export interface MetaAdCreative {
  id: string;
  name?: string;
  effective_status?: string;
  creative?: {
    thumbnail_url?: string;
    image_url?: string;
    body?: string;
    title?: string;
  };
}

export async function getMetaAdCreatives(adIds: string[]): Promise<Map<string, MetaAdCreative>> {
  const map = new Map<string, MetaAdCreative>();
  if (!adIds.length) return map;

  // Meta batch endpoint supports up to 50 IDs per request
  const chunks: string[][] = [];
  for (let i = 0; i < adIds.length; i += 50) {
    chunks.push(adIds.slice(i, i + 50));
  }

  for (const chunk of chunks) {
    const token = await getToken();
    const url = new URL(`${BASE}/`);
    url.searchParams.set("ids", chunk.join(","));
    url.searchParams.set("fields", "id,name,effective_status,creative{thumbnail_url,image_url,body,title}");
    url.searchParams.set("access_token", token);

    const res = await fetch(url.toString());
    if (!res.ok) continue;
    const data: Record<string, MetaAdCreative> = await res.json();
    for (const [id, creative] of Object.entries(data)) {
      map.set(id, creative);
    }
  }

  return map;
}

// ---- Ad management ----

export async function updateMetaAdStatus(adId: string, status: "ACTIVE" | "PAUSED"): Promise<boolean> {
  const token = await getToken();
  const res = await fetch(`${BASE}/${adId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status, access_token: token }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Meta status update error:", res.status, body);
    return false;
  }
  return true;
}
