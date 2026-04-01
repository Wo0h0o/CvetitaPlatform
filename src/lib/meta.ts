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

interface RawCreativeData {
  id: string;
  name?: string;
  effective_status?: string;
  creative?: {
    thumbnail_url?: string;
    image_url?: string;
    body?: string;
    title?: string;
    video_id?: string;
    object_story_spec?: {
      video_data?: {
        video_id?: string;
        image_url?: string;
      };
    };
    asset_feed_spec?: {
      images?: { hash: string }[];
    };
  };
}

export interface ResolvedCreative {
  id: string;
  name?: string;
  effective_status?: string;
  imageUrl: string | null;
  videoUrl: string | null;
  videoId: string | null;
  body: string | null;
  title: string | null;
  isVideo: boolean;
}

export async function getMetaAdCreatives(adIds: string[]): Promise<Map<string, ResolvedCreative>> {
  const map = new Map<string, ResolvedCreative>();
  if (!adIds.length) return map;

  // Step 1: Batch fetch ad creative metadata
  const rawMap = new Map<string, RawCreativeData>();
  const chunks: string[][] = [];
  for (let i = 0; i < adIds.length; i += 50) chunks.push(adIds.slice(i, i + 50));

  for (const chunk of chunks) {
    const token = await getToken();
    const url = new URL(`${BASE}/`);
    url.searchParams.set("ids", chunk.join(","));
    url.searchParams.set("fields", "id,name,effective_status,creative{thumbnail_url,image_url,body,title,video_id,object_story_spec,asset_feed_spec}");
    url.searchParams.set("access_token", token);
    const res = await fetch(url.toString());
    if (!res.ok) continue;
    const data: Record<string, RawCreativeData> = await res.json();
    for (const [id, raw] of Object.entries(data)) rawMap.set(id, raw);
  }

  // Step 2: Collect video IDs and image hashes that need resolution
  const videoIds = new Set<string>();
  const imageHashes = new Set<string>();

  for (const raw of rawMap.values()) {
    const c = raw.creative;
    if (!c) continue;
    const vid = c.object_story_spec?.video_data?.video_id || c.video_id;
    if (vid) videoIds.add(vid);
    if (!c.image_url && c.asset_feed_spec?.images?.length) {
      imageHashes.add(c.asset_feed_spec.images[0].hash);
    }
  }

  // Step 3: Batch fetch video source URLs
  const videoSources = new Map<string, { source: string; picture: string }>();
  if (videoIds.size > 0) {
    const vidChunks: string[][] = [];
    const vidArr = [...videoIds];
    for (let i = 0; i < vidArr.length; i += 50) vidChunks.push(vidArr.slice(i, i + 50));

    for (const chunk of vidChunks) {
      const token = await getToken();
      const url = new URL(`${BASE}/`);
      url.searchParams.set("ids", chunk.join(","));
      url.searchParams.set("fields", "source,picture");
      url.searchParams.set("access_token", token);
      const res = await fetch(url.toString());
      if (!res.ok) continue;
      const data: Record<string, { source?: string; picture?: string }> = await res.json();
      for (const [vid, info] of Object.entries(data)) {
        if (info.source || info.picture) {
          videoSources.set(vid, { source: info.source || "", picture: info.picture || "" });
        }
      }
    }
  }

  // Step 4: Batch fetch image URLs by hash
  const hashUrls = new Map<string, string>();
  if (imageHashes.size > 0) {
    const token = await getToken();
    const hashArr = [...imageHashes];
    const url = new URL(`${BASE}/${getAccountId()}/adimages`);
    url.searchParams.set("hashes", JSON.stringify(hashArr));
    url.searchParams.set("fields", "url,hash");
    url.searchParams.set("access_token", token);
    const res = await fetch(url.toString());
    if (res.ok) {
      const data: { data?: { hash: string; url: string }[] } = await res.json();
      for (const img of data.data || []) hashUrls.set(img.hash, img.url);
    }
  }

  // Step 5: Resolve best image/video for each ad
  for (const [adId, raw] of rawMap) {
    const c = raw.creative;
    const vid = c?.object_story_spec?.video_data?.video_id || c?.video_id || null;
    const isVideo = !!vid;

    // Best image: image_url > video cover > hash lookup > video picture > thumbnail
    let imageUrl: string | null = c?.image_url || null;
    if (!imageUrl && c?.object_story_spec?.video_data?.image_url) {
      imageUrl = c.object_story_spec.video_data.image_url;
    }
    if (!imageUrl && c?.asset_feed_spec?.images?.length) {
      imageUrl = hashUrls.get(c.asset_feed_spec.images[0].hash) || null;
    }
    if (!imageUrl && vid && videoSources.has(vid)) {
      imageUrl = videoSources.get(vid)!.picture;
    }
    if (!imageUrl) imageUrl = c?.thumbnail_url || null;

    // Video source URL
    let videoUrl: string | null = null;
    if (vid && videoSources.has(vid)) {
      videoUrl = videoSources.get(vid)!.source || null;
    }

    map.set(adId, {
      id: raw.id,
      name: raw.name,
      effective_status: raw.effective_status,
      imageUrl,
      videoUrl,
      videoId: vid,
      body: c?.body || null,
      title: c?.title || null,
      isVideo,
    });
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
