import { supabaseAdmin } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/encryption";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { logger } from "@/lib/logger";
import type {
  StoreRow,
  StoreCredentialRow,
  StoreConfig,
  ShopifyCredentials,
} from "@/types/store";

const DEFAULT_API_VERSION = "2024-10";
const SHOPIFY_TIMEOUT = 15_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 20;

// ============================================================
// In-memory cache with TTL
// ============================================================

interface CacheEntry {
  config: StoreConfig;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(storeId: string): StoreConfig | null {
  const entry = cache.get(storeId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(storeId);
    return null;
  }
  return entry.config;
}

function setCache(storeId: string, config: StoreConfig): void {
  // Evict oldest entry if at capacity
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(storeId)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(storeId, { config, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Clear cached config for a store (e.g., after credential update).
 */
export function invalidateStoreConfig(storeId: string): void {
  cache.delete(storeId);
}

// ============================================================
// Main loader
// ============================================================

/**
 * Loads and decrypts a store's Shopify configuration.
 * Results are cached in-memory for 5 minutes.
 */
export async function loadStoreConfig(
  storeId: string
): Promise<StoreConfig> {
  const cached = getCached(storeId);
  if (cached) return cached;

  // Fetch store row
  const { data: store, error: storeErr } = await supabaseAdmin
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .single<StoreRow>();

  if (storeErr || !store) {
    throw new Error(`Store not found: ${storeId}`);
  }

  if (!store.is_active) {
    throw new Error(`Store is inactive: ${storeId}`);
  }

  // Fetch credentials
  const { data: cred, error: credErr } = await supabaseAdmin
    .from("store_credentials")
    .select("*")
    .eq("store_id", storeId)
    .eq("service", "shopify")
    .single<StoreCredentialRow>();

  if (credErr || !cred) {
    throw new Error(`Shopify credentials not found for store: ${storeId}`);
  }

  if (cred.status !== "active") {
    throw new Error(
      `Shopify credentials are ${cred.status} for store: ${storeId}`
    );
  }

  // Decrypt sensitive fields (client_secret may be absent — see project_security_debt.md)
  const credentials: ShopifyCredentials = {
    store_domain: cred.credentials.store_domain,
    access_token: decrypt(cred.credentials.access_token),
    client_secret: cred.credentials.client_secret
      ? decrypt(cred.credentials.client_secret)
      : null,
    api_version: cred.credentials.api_version || DEFAULT_API_VERSION,
  };

  const config: StoreConfig = {
    store,
    credentials,
    schemaName: `store_${store.market_code}`,
  };

  setCache(storeId, config);

  logger.info("Store config loaded", {
    storeId,
    domain: credentials.store_domain,
    schema: config.schemaName,
  });

  return config;
}

// ============================================================
// Pre-configured Shopify fetch
// ============================================================

/**
 * Returns a fetch function pre-configured with the store's domain and auth token.
 * Usage: `const shopify = buildShopifyFetch(config); const res = await shopify('/products.json');`
 */
export function buildShopifyFetch(
  config: StoreConfig
): (path: string, options?: RequestInit) => Promise<Response> {
  const { store_domain, access_token, api_version } = config.credentials;
  const baseUrl = `https://${store_domain}/admin/api/${api_version}`;

  return (path: string, options: RequestInit = {}) => {
    const url = `${baseUrl}${path}`;
    return fetchWithTimeout(
      url,
      {
        ...options,
        headers: {
          "X-Shopify-Access-Token": access_token,
          "Content-Type": "application/json",
          ...options.headers,
        },
      },
      SHOPIFY_TIMEOUT
    );
  };
}

// ============================================================
// Pagination helper (reusable for sync + backfill)
// ============================================================

/**
 * Extracts the next page URL from Shopify's Link header.
 * Returns null if there are no more pages.
 */
export function getNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}
