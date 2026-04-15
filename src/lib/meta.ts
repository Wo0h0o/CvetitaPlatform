import { fetchWithTimeout } from "./fetch-utils";
import { logger } from "./logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/encryption";
import { parseBucHeader, type BucUsage } from "./meta-rate-limit";

const API_VERSION = "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ============================================================
// Client resolution: integration_accounts-backed, env-fallback
// ============================================================

export interface MetaClient {
  /** The 'act_...' external id used in Graph API paths. */
  accountId: string;
  /** Live access token — never log this. */
  token: string;
  /** UUID from integration_accounts (empty string if using env fallback). */
  integrationAccountId: string;
}

// In-memory cache so we don't re-query Supabase + decrypt per request.
// TTL short to keep token rotation effects visible quickly.
const CLIENT_CACHE_TTL_MS = 60_000; // 60s
interface CachedClient { client: MetaClient; expiresAt: number; }
const clientCache = new Map<string, CachedClient>();

function cacheKey(integrationAccountId?: string): string {
  return integrationAccountId || "__default__";
}

function getCachedClient(integrationAccountId?: string): MetaClient | null {
  const entry = clientCache.get(cacheKey(integrationAccountId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    clientCache.delete(cacheKey(integrationAccountId));
    return null;
  }
  return entry.client;
}

function setCachedClient(integrationAccountId: string | undefined, client: MetaClient): void {
  clientCache.set(cacheKey(integrationAccountId), {
    client,
    expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
  });
}

/** Invalidate cached client(s). Call after credential rotation. */
export function invalidateMetaClientCache(integrationAccountId?: string): void {
  if (integrationAccountId) {
    clientCache.delete(cacheKey(integrationAccountId));
  } else {
    clientCache.clear();
  }
}

/**
 * Env-only fallback client. Used when:
 *   - No integration_accounts row exists (pre-seed / local dev)
 *   - DB lookup fails for any reason
 */
function envFallbackClient(integrationAccountId = ""): MetaClient {
  return {
    accountId: process.env.META_AD_ACCOUNT_ID || "",
    token: process.env.META_ACCESS_TOKEN || "",
    integrationAccountId,
  };
}

/**
 * Resolves the default integration_account_id by matching env var META_AD_ACCOUNT_ID
 * against seeded rows. Used when callers don't pass an explicit id.
 */
async function resolveDefaultIntegrationAccountId(): Promise<string | null> {
  const externalId = process.env.META_AD_ACCOUNT_ID;
  if (!externalId) return null;

  const { data, error } = await supabaseAdmin
    .from("integration_accounts")
    .select("id")
    .eq("service", "meta_ads")
    .eq("external_id", externalId)
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.warn("Failed to resolve default integration_account_id", { error: error.message });
    return null;
  }
  return data?.id || null;
}

/**
 * Returns the Meta API client (account id + token) for a given integration_account.
 * If `integrationAccountId` is omitted, resolves to the env-var default seeded row.
 * Falls back to env vars on any DB miss — prefer liveness over strict DB-only.
 */
export async function getMetaClient(integrationAccountId?: string): Promise<MetaClient> {
  const cached = getCachedClient(integrationAccountId);
  if (cached) return cached;

  // Resolve id if caller didn't pass one
  const resolvedId = integrationAccountId ?? (await resolveDefaultIntegrationAccountId());

  if (!resolvedId) {
    // No DB row yet — pure env fallback (pre-seed state)
    const client = envFallbackClient();
    setCachedClient(integrationAccountId, client);
    return client;
  }

  const { data, error } = await supabaseAdmin
    .from("integration_accounts")
    .select("external_id, credentials, status")
    .eq("id", resolvedId)
    .eq("service", "meta_ads")
    .single();

  if (error || !data) {
    logger.warn("Meta integration_account lookup failed — using env fallback", {
      integrationAccountId: resolvedId,
      error: error?.message,
    });
    const client = envFallbackClient(resolvedId);
    setCachedClient(integrationAccountId, client);
    return client;
  }

  if (data.status !== "active") {
    logger.warn("Meta integration_account is not active", {
      integrationAccountId: resolvedId,
      status: data.status,
    });
  }

  // Decrypt stored token; fall back to env if decryption fails
  const creds = (data.credentials || {}) as { access_token?: string };
  let token = process.env.META_ACCESS_TOKEN || "";
  if (creds.access_token) {
    try {
      token = decrypt(creds.access_token);
    } catch (e) {
      logger.warn("Meta token decrypt failed — using env fallback", {
        integrationAccountId: resolvedId,
        error: (e as Error).message,
      });
    }
  }

  const client: MetaClient = {
    accountId: data.external_id,
    token,
    integrationAccountId: resolvedId,
  };
  setCachedClient(integrationAccountId, client);
  return client;
}

// ============================================================
// Token refresh (global env-var token — shared across all accounts in v1)
// ============================================================

/**
 * Exchanges the current user access token for a fresh long-lived one.
 * The caller (cron route) is responsible for persisting the new token back
 * to Vercel env vars and/or re-encrypting into integration_accounts rows.
 */
export async function refreshToken(): Promise<{ token: string; expiresIn: number } | null> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const currentToken = process.env.META_ACCESS_TOKEN || "";

  if (!appId || !appSecret || !currentToken) return null;

  const res = await fetchWithTimeout(
    `https://graph.facebook.com/${API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: currentToken,
      }),
    {},
    10_000
  );

  if (!res.ok) return null;
  const data: { access_token?: string; expires_in?: number } = await res.json();
  if (!data.access_token) return null;

  // Invalidate all cached clients so the next request pulls the fresh token
  invalidateMetaClientCache();

  return { token: data.access_token, expiresIn: data.expires_in || 0 };
}

// ============================================================
// Shared types
// ============================================================

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
  created_time?: string;
  start_time?: string;
}

export function actionVal(actions: MetaAction[] | undefined, type: string): number {
  if (!actions) return 0;
  const a = actions.find((x) => x.action_type === type);
  return a ? parseFloat(a.value) : 0;
}

// ============================================================
// Low-level Graph fetches (all take a MetaClient)
// ============================================================

async function metaFetch<T>(
  path: string,
  params: Record<string, string>,
  client: MetaClient
): Promise<T> {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("access_token", client.token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetchWithTimeout(url.toString(), {}, 15_000);
  if (!res.ok) {
    await res.text(); // drain response
    logger.error("Meta API error", {
      service: "meta",
      status: res.status,
      accountId: client.accountId,
    });
    throw new Error(`Meta API: ${res.status}`);
  }
  return res.json();
}

async function fetchInsights(
  params: Record<string, string>,
  client: MetaClient
): Promise<MetaInsightRow[]> {
  const data = await metaFetch<{ data: MetaInsightRow[] }>(
    `${client.accountId}/insights`,
    params,
    client
  );
  return data.data || [];
}

async function fetchCampaigns(client: MetaClient): Promise<MetaCampaign[]> {
  const all: MetaCampaign[] = [];
  let url: string | null =
    `${BASE}/${client.accountId}/campaigns?` +
    new URLSearchParams({
      fields: "name,effective_status,objective,created_time,start_time",
      limit: "100",
      access_token: client.token,
    }).toString();

  while (url) {
    const res: Response = await fetchWithTimeout(url, {}, 15_000);
    if (!res.ok) break;
    const data: { data?: MetaCampaign[]; paging?: { next?: string } } = await res.json();
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return all;
}

// ============================================================
// Public API — every function takes optional integrationAccountId.
// Existing callers keep working (undefined → primary account via env match).
// Home page + portfolio-intel pass explicit ids for multi-account queries.
// ============================================================

export async function getMetaOverview(
  datePreset: string = "last_7d",
  integrationAccountId?: string
) {
  const client = await getMetaClient(integrationAccountId);
  const rows = await fetchInsights(
    {
      fields: "spend,impressions,clicks,cpc,cpm,ctr,actions,action_values",
      date_preset: datePreset,
    },
    client
  );

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

export async function getMetaCampaignInsights(
  datePreset: string = "last_7d",
  integrationAccountId?: string
) {
  const client = await getMetaClient(integrationAccountId);
  const [insightRows, campaigns] = await Promise.all([
    fetchInsights(
      {
        fields: "campaign_name,campaign_id,spend,impressions,clicks,cpc,ctr,actions,action_values",
        date_preset: datePreset,
        level: "campaign",
        limit: "50",
      },
      client
    ),
    fetchCampaigns(client),
  ]);

  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  return insightRows
    .map((r) => {
      const spend = parseFloat(r.spend);
      const revenue = actionVal(r.action_values, "omni_purchase");
      const purchases = actionVal(r.actions, "omni_purchase");
      const campaign = campaignMap.get(r.campaign_id || "");
      return {
        name: r.campaign_name || "Unknown",
        id: r.campaign_id || "",
        status: campaign?.effective_status || "UNKNOWN",
        createdTime: campaign?.created_time || null,
        startTime: campaign?.start_time || null,
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
    })
    .sort((a, b) => b.spend - a.spend);
}

// ---- Ad Set level insights ----

export interface MetaAdSetInsightRow extends MetaInsightRow {
  adset_id?: string;
  adset_name?: string;
  frequency?: string;
  reach?: string;
}

interface MetaAdSetMeta {
  id: string;
  name: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  start_time?: string;
  created_time?: string;
}

export async function getMetaAdSetInsights(
  datePreset: string = "last_7d",
  integrationAccountId?: string
): Promise<MetaAdSetInsightRow[]> {
  const client = await getMetaClient(integrationAccountId);
  const all: MetaAdSetInsightRow[] = [];
  let url: string | null =
    `${BASE}/${client.accountId}/insights?` +
    new URLSearchParams({
      fields:
        "adset_id,adset_name,campaign_name,campaign_id,spend,impressions,clicks,cpc,cpm,ctr,reach,frequency,actions,action_values",
      date_preset: datePreset,
      level: "adset",
      limit: "500",
      access_token: client.token,
    }).toString();

  while (url) {
    const res: Response = await fetchWithTimeout(url, {}, 15_000);
    if (!res.ok) break;
    const data: { data?: MetaAdSetInsightRow[]; paging?: { next?: string } } = await res.json();
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return all;
}

export async function fetchAdSetsMeta(
  integrationAccountId?: string
): Promise<MetaAdSetMeta[]> {
  const client = await getMetaClient(integrationAccountId);
  const all: MetaAdSetMeta[] = [];
  let url: string | null =
    `${BASE}/${client.accountId}/adsets?` +
    new URLSearchParams({
      fields:
        "name,effective_status,daily_budget,lifetime_budget,optimization_goal,start_time,created_time",
      limit: "100",
      access_token: client.token,
    }).toString();

  while (url) {
    const res: Response = await fetchWithTimeout(url, {}, 15_000);
    if (!res.ok) break;
    const data: { data?: MetaAdSetMeta[]; paging?: { next?: string } } = await res.json();
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return all;
}

// ---- Ad-level insights ----

export interface MetaAdInsightRow extends MetaInsightRow {
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  frequency?: string;
  reach?: string;
}

export async function getMetaAdInsights(
  datePreset: string = "last_7d",
  adStatus?: string,
  integrationAccountId?: string
): Promise<MetaAdInsightRow[]> {
  const client = await getMetaClient(integrationAccountId);
  const all: MetaAdInsightRow[] = [];
  const params: Record<string, string> = {
    fields:
      "ad_id,ad_name,campaign_name,campaign_id,adset_name,spend,impressions,clicks,cpc,cpm,ctr,reach,frequency,actions,action_values",
    date_preset: datePreset,
    level: "ad",
    limit: "500",
    access_token: client.token,
  };
  if (adStatus) {
    params.filtering = JSON.stringify([
      { field: "ad.effective_status", operator: "IN", value: adStatus.split(",") },
    ]);
  }
  let url: string | null = `${BASE}/${client.accountId}/insights?` + new URLSearchParams(params).toString();

  while (url) {
    const res: Response = await fetchWithTimeout(url, {}, 15_000);
    if (!res.ok) break;
    const data: { data?: MetaAdInsightRow[]; paging?: { next?: string } } = await res.json();
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return all;
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
      videos?: { video_id: string }[];
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

export async function getMetaAdCreatives(
  adIds: string[],
  integrationAccountId?: string
): Promise<Map<string, ResolvedCreative>> {
  const map = new Map<string, ResolvedCreative>();
  if (!adIds.length) return map;

  const client = await getMetaClient(integrationAccountId);

  // Step 1: Batch fetch ad creative metadata
  const rawMap = new Map<string, RawCreativeData>();
  const chunks: string[][] = [];
  for (let i = 0; i < adIds.length; i += 50) chunks.push(adIds.slice(i, i + 50));

  for (const chunk of chunks) {
    const url = new URL(`${BASE}/`);
    url.searchParams.set("ids", chunk.join(","));
    url.searchParams.set(
      "fields",
      "id,name,effective_status,creative{thumbnail_url,image_url,body,title,video_id,object_story_spec,asset_feed_spec}"
    );
    url.searchParams.set("access_token", client.token);
    const res = await fetchWithTimeout(url.toString(), {}, 15_000);
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
    const vid =
      c.object_story_spec?.video_data?.video_id ||
      c.video_id ||
      c.asset_feed_spec?.videos?.[0]?.video_id;
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
      const url = new URL(`${BASE}/`);
      url.searchParams.set("ids", chunk.join(","));
      url.searchParams.set("fields", "source,picture");
      url.searchParams.set("access_token", client.token);
      const res = await fetchWithTimeout(url.toString(), {}, 15_000);
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
    const hashArr = [...imageHashes];
    const url = new URL(`${BASE}/${client.accountId}/adimages`);
    url.searchParams.set("hashes", JSON.stringify(hashArr));
    url.searchParams.set("fields", "url,hash");
    url.searchParams.set("access_token", client.token);
    const res = await fetchWithTimeout(url.toString(), {}, 15_000);
    if (res.ok) {
      const data: { data?: { hash: string; url: string }[] } = await res.json();
      for (const img of data.data || []) hashUrls.set(img.hash, img.url);
    }
  }

  // Step 5: Resolve best image/video for each ad
  for (const [adId, raw] of rawMap) {
    const c = raw.creative;
    const vid =
      c?.object_story_spec?.video_data?.video_id ||
      c?.video_id ||
      c?.asset_feed_spec?.videos?.[0]?.video_id ||
      null;
    const isVideo = !!vid;

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

    let videoUrl: string | null = null;
    if (vid && videoSources.has(vid)) {
      const src = videoSources.get(vid)!.source;
      videoUrl = src && src.length > 0 ? src : null;
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

// ============================================================
// Daily-increment insights for nightly sync
// ============================================================
//
// Unlike getMetaOverview / getMetaCampaignInsights (which use date_preset and
// return ONE aggregated row), these helpers use time_range + time_increment=1
// to return ONE ROW PER DAY in the window. Used by /api/cron/meta-sync to
// populate meta_insights_daily.

export interface DailyInsightRow {
  date_start: string;                 // YYYY-MM-DD
  date_stop: string;                  // YYYY-MM-DD (= date_start when time_increment=1)
  spend: string;
  impressions: string;
  clicks: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  reach?: string;
  frequency?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
  // Present at campaign/adset/ad level only:
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
}

export type InsightsLevel = "account" | "campaign" | "adset" | "ad";

const FIELDS_BY_LEVEL: Record<InsightsLevel, string> = {
  account:  "spend,impressions,clicks,cpc,cpm,ctr,reach,frequency,actions,action_values",
  campaign: "campaign_id,campaign_name,spend,impressions,clicks,cpc,cpm,ctr,reach,frequency,actions,action_values",
  adset:    "campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,cpc,cpm,ctr,reach,frequency,actions,action_values",
  ad:       "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,cpc,cpm,ctr,reach,frequency,actions,action_values",
};

export interface DailyInsightsResult {
  rows: DailyInsightRow[];
  /** Peak BUC usage seen across all paginated requests for this fetch. */
  peakUsage: BucUsage | null;
}

/**
 * Fetches daily-resolution insights for the given window.
 *   - since/until: YYYY-MM-DD (inclusive)
 *   - level: 'account' | 'campaign' | 'adset' | 'ad'
 *   - integrationAccountId: optional; defaults to primary via env match
 *
 * Parses the X-Business-Use-Case-Usage header on every paginated response and
 * returns the peak reading so the caller can decide whether to throttle.
 */
export async function fetchDailyInsights(
  level: InsightsLevel,
  since: string,
  until: string,
  integrationAccountId?: string
): Promise<DailyInsightsResult> {
  const client = await getMetaClient(integrationAccountId);

  const rows: DailyInsightRow[] = [];
  let peak: BucUsage | null = null;

  const recordUsage = (res: Response) => {
    const usageMap = parseBucHeader(res.headers.get("x-business-use-case-usage"));
    for (const u of usageMap.values()) {
      if (!peak || u.peakPct > peak.peakPct) peak = u;
    }
  };

  const params: Record<string, string> = {
    fields: FIELDS_BY_LEVEL[level],
    level,
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: "500",
    access_token: client.token,
  };

  let url: string | null =
    `${BASE}/${client.accountId}/insights?` + new URLSearchParams(params).toString();

  while (url) {
    const res: Response = await fetchWithTimeout(url, {}, 15_000);
    recordUsage(res);
    if (!res.ok) {
      const body = await res.text();
      logger.error("Meta sync fetch failed", {
        service: "meta-sync",
        status: res.status,
        accountId: client.accountId,
        level,
        body: body.slice(0, 300),
      });
      throw new Error(`Meta insights ${level} fetch failed: ${res.status}`);
    }
    const data: { data?: DailyInsightRow[]; paging?: { next?: string } } = await res.json();
    rows.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return { rows, peakUsage: peak };
}

// ---- Ad management ----

export async function updateMetaAdStatus(
  adId: string,
  status: "ACTIVE" | "PAUSED",
  integrationAccountId?: string
): Promise<boolean> {
  const client = await getMetaClient(integrationAccountId);
  const res = await fetchWithTimeout(
    `${BASE}/${adId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status, access_token: client.token }),
    },
    10_000
  );
  if (!res.ok) {
    await res.text(); // drain response
    logger.error("Meta status update error", {
      service: "meta",
      status: res.status,
      accountId: client.accountId,
    });
    return false;
  }
  return true;
}
