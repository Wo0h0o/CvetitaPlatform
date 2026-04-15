import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

// ============================================================
// Types
// ============================================================

export type BindingRole = "primary" | "secondary" | "legacy";

export interface MarketBinding {
  integrationAccountId: string;
  role: BindingRole;
  displayName: string;
}

export interface ResolvedMarket {
  storeId: string;
  marketCode: string;
  storeName: string;
  /** The one "default read" account for single-account callers. */
  primaryIntegrationAccountId: string;
  /** All active bindings (primary + secondary + legacy) — used for blended reads. */
  allIntegrationAccountIds: string[];
  bindings: MarketBinding[];
}

// ============================================================
// In-memory cache (60s TTL)
// ============================================================
//
// Shared by the home-page API routes and the /ads/[market] drill-downs.
// Re-querying per request costs 2 round trips (stores + bindings) — cache
// prevents the burst when a dashboard page loads 3-5 parallel SWR requests.
// Module-level scope means it persists for the lifetime of a serverless
// instance; that is acceptable because bindings change rarely.

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  result: ResolvedMarket;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Drop cached results. Call after seeding or binding changes. */
export function invalidateMarketResolverCache(marketCode?: string): void {
  if (marketCode) {
    cache.delete(marketCode.toLowerCase());
  } else {
    cache.clear();
  }
}

// ============================================================
// Resolver
// ============================================================

type BindingRow = {
  role: string;
  integration_accounts: {
    id: string;
    service: string;
    status: string;
    display_name: string;
  } | null;
};

/**
 * Resolve a market code (e.g. 'bg') to its store + active Meta integration
 * accounts. Returns the primary integration_account_id (for single-account
 * paths) and the full list across primary/secondary/legacy for blended reads.
 *
 * Filters:
 *   - integration_accounts.service = 'meta_ads'
 *   - integration_accounts.status  != 'disabled'
 *
 * Throws if no active store or no primary meta_ads binding for the market.
 */
export async function resolveMarket(marketCode: string): Promise<ResolvedMarket> {
  const key = marketCode.toLowerCase();

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const { data: store, error: storeErr } = await supabaseAdmin
    .from("stores")
    .select("id, name, market_code")
    .eq("market_code", key)
    .eq("is_active", true)
    .maybeSingle();

  if (storeErr) {
    logger.error("resolveMarket: store lookup failed", {
      marketCode: key,
      error: storeErr.message,
    });
    throw new Error(`Failed to resolve market '${key}'`);
  }
  if (!store) {
    throw new Error(`No active store for market_code='${key}'`);
  }

  const { data: rows, error: bindErr } = await supabaseAdmin
    .from("store_integration_bindings")
    .select("role, integration_accounts!inner(id, service, status, display_name)")
    .eq("store_id", store.id);

  if (bindErr) {
    logger.error("resolveMarket: bindings query failed", {
      marketCode: key,
      error: bindErr.message,
    });
    throw new Error(`Failed to resolve bindings for '${key}'`);
  }

  const bindings: MarketBinding[] = [];
  let primaryId = "";

  for (const row of (rows ?? []) as unknown as BindingRow[]) {
    const ia = row.integration_accounts;
    if (!ia) continue;
    if (ia.service !== "meta_ads") continue;
    if (ia.status === "disabled") continue;

    const role = (row.role as BindingRole) ?? "primary";
    bindings.push({
      integrationAccountId: ia.id,
      role,
      displayName: ia.display_name,
    });
    if (role === "primary" && !primaryId) {
      primaryId = ia.id;
    }
  }

  if (!primaryId) {
    throw new Error(`No primary meta_ads binding for market '${key}'`);
  }

  const result: ResolvedMarket = {
    storeId: store.id,
    marketCode: store.market_code,
    storeName: store.name,
    primaryIntegrationAccountId: primaryId,
    allIntegrationAccountIds: bindings.map((b) => b.integrationAccountId),
    bindings,
  };

  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

// ============================================================
// Convenience: resolve all three home-page markets in parallel
// ============================================================

export const HOME_MARKET_CODES = ["bg", "gr", "ro"] as const;
export type HomeMarketCode = (typeof HOME_MARKET_CODES)[number];

/**
 * Resolve every market used on the Owner Home page. Uses Promise.allSettled
 * and returns only the markets that resolved successfully — a single unseeded
 * market (e.g. RO without a primary binding in a fresh environment) should
 * degrade to "2 cards" rather than blank the entire home page. Failed
 * resolutions are logged at warn level so the ops team can investigate
 * without taking users down.
 *
 * Entries preserve the HOME_MARKET_CODES order; callers that need the
 * original code for a missing market should compare what they receive
 * against HOME_MARKET_CODES.
 */
export async function resolveAllHomeMarkets(): Promise<ResolvedMarket[]> {
  const results = await Promise.allSettled(
    HOME_MARKET_CODES.map((code) => resolveMarket(code))
  );
  const resolved: ResolvedMarket[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      resolved.push(r.value);
    } else {
      logger.warn("resolveAllHomeMarkets: skipping unresolved market", {
        code: HOME_MARKET_CODES[i],
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }
  return resolved;
}
