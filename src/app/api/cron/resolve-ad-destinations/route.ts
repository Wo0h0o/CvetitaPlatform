import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { getMetaClient } from "@/lib/meta";
import { loadStoreConfig } from "@/lib/store-config-loader";

export const maxDuration = 60;

/**
 * GET /api/cron/resolve-ad-destinations
 *
 * Two-phase job:
 *   1. Discover new Meta ads in meta_insights_daily that aren't in
 *      ad_destinations yet, then batch-fetch their destination URLs from
 *      the Meta Graph API and persist.
 *   2. For each NEW (unique) destination_path that isn't in
 *      destination_products yet, fetch the Shopify content (page body or
 *      product info) and ask Haiku to map it to product handles.
 *
 * Idempotent. Caps per-run work at MAX_DESTINATIONS_TO_RESOLVE +
 * MAX_PRODUCTS_TO_INFER to stay under the 60s serverless budget; full
 * historical backfill takes a few cron cycles.
 *
 * Schedule: daily at 04:00 Sofia. Backfill done in 1-3 runs.
 */

const META_BASE = "https://graph.facebook.com/v21.0";
const SHOPIFY_API_VERSION = "2024-10";
const MAX_DESTINATIONS_TO_RESOLVE = 200; // ads per run
const MAX_PRODUCTS_TO_INFER = 30;        // LLM inferences per run
const META_BATCH_SIZE = 50;
const META_LOOKBACK_DAYS = 30;            // discover ads active in this window
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// ============================================================
// Types
// ============================================================

interface IntegrationAccountRow {
  id: string;
  external_id: string;
  organization_id: string;
}

interface CreativeFetchResponse {
  [adId: string]: {
    id: string;
    name?: string;
    creative?: {
      object_story_spec?: {
        link_data?: { link?: string; call_to_action?: { value?: { link?: string } } };
        video_data?: { call_to_action?: { value?: { link?: string } } };
      };
      asset_feed_spec?: {
        link_urls?: Array<{ website_url?: string }>;
      };
      effective_object_story_id?: string;
    };
  };
}

interface ParsedDestination {
  destination_url: string | null;
  destination_path: string | null;
  destination_type: "product" | "page" | "collection" | "home" | "external" | "unknown";
  destination_handle: string | null;
}

interface ShopifyProduct {
  handle: string;
  title: string;
}

// ============================================================
// URL parsing
// ============================================================

function parseDestination(rawUrl: string | null, storeDomains: Set<string>): ParsedDestination {
  if (!rawUrl) {
    return {
      destination_url: null,
      destination_path: null,
      destination_type: "unknown",
      destination_handle: null,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      destination_url: rawUrl,
      destination_path: null,
      destination_type: "unknown",
      destination_handle: null,
    };
  }

  // External host (not one of our Shopify stores or their primary domains).
  if (![...storeDomains].some((d) => parsed.hostname.endsWith(d.replace(/^https?:\/\//, "")))) {
    return {
      destination_url: rawUrl,
      destination_path: parsed.pathname,
      destination_type: "external",
      destination_handle: null,
    };
  }

  const path = parsed.pathname.replace(/\/$/, "");
  const productMatch = path.match(/^\/products\/([^/?#]+)/);
  if (productMatch) {
    return {
      destination_url: rawUrl,
      destination_path: `/products/${productMatch[1]}`,
      destination_type: "product",
      destination_handle: productMatch[1],
    };
  }
  const pageMatch = path.match(/^\/pages\/([^/?#]+)/);
  if (pageMatch) {
    return {
      destination_url: rawUrl,
      destination_path: `/pages/${pageMatch[1]}`,
      destination_type: "page",
      destination_handle: pageMatch[1],
    };
  }
  const collectionMatch = path.match(/^\/collections\/([^/?#]+)/);
  if (collectionMatch) {
    return {
      destination_url: rawUrl,
      destination_path: `/collections/${collectionMatch[1]}`,
      destination_type: "collection",
      destination_handle: collectionMatch[1],
    };
  }
  if (path === "" || path === "/") {
    return {
      destination_url: rawUrl,
      destination_path: "/",
      destination_type: "home",
      destination_handle: null,
    };
  }
  return {
    destination_url: rawUrl,
    destination_path: path,
    destination_type: "unknown",
    destination_handle: null,
  };
}

function extractLinkFromCreative(
  creative: CreativeFetchResponse[string]["creative"] | undefined
): string | null {
  if (!creative) return null;
  return (
    creative.object_story_spec?.link_data?.link ??
    creative.object_story_spec?.link_data?.call_to_action?.value?.link ??
    creative.object_story_spec?.video_data?.call_to_action?.value?.link ??
    creative.asset_feed_spec?.link_urls?.[0]?.website_url ??
    null
  );
}

// ============================================================
// Discovery — find ads in meta_insights_daily missing from ad_destinations
// ============================================================

async function discoverNewAds(account: IntegrationAccountRow, sinceDate: string): Promise<string[]> {
  // Pull distinct ad_ids active in window for this account
  const { data: insights } = await supabaseAdmin
    .from("meta_insights_daily")
    .select("object_id")
    .eq("integration_account_id", account.id)
    .eq("level", "ad")
    .gte("date", sinceDate)
    .limit(2000);

  const seen = new Set<string>();
  for (const r of (insights ?? []) as Array<{ object_id: string }>) seen.add(r.object_id);
  if (seen.size === 0) return [];

  const { data: existing } = await supabaseAdmin
    .from("ad_destinations")
    .select("ad_id")
    .eq("integration_account_id", account.id)
    .in("ad_id", [...seen]);
  const knownSet = new Set<string>((existing ?? []).map((r) => r.ad_id as string));

  return [...seen].filter((id) => !knownSet.has(id));
}

// ============================================================
// Meta API — batch fetch destinations
// ============================================================

async function fetchDestinations(
  adIds: string[],
  token: string
): Promise<Map<string, { url: string | null; name: string | null; error: string | null }>> {
  const out = new Map<string, { url: string | null; name: string | null; error: string | null }>();
  for (let i = 0; i < adIds.length; i += META_BATCH_SIZE) {
    const batch = adIds.slice(i, i + META_BATCH_SIZE);
    const url = new URL(`${META_BASE}/`);
    url.searchParams.set("ids", batch.join(","));
    url.searchParams.set(
      "fields",
      "id,name,creative{object_story_spec,asset_feed_spec,effective_object_story_id}"
    );
    url.searchParams.set("access_token", token);

    try {
      const res = await fetchWithTimeout(url.toString(), {}, 20_000);
      if (!res.ok) {
        const errText = await res.text();
        for (const id of batch) out.set(id, { url: null, name: null, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` });
        continue;
      }
      const json = (await res.json()) as CreativeFetchResponse;
      for (const id of batch) {
        const row = json[id];
        const link = extractLinkFromCreative(row?.creative);
        out.set(id, { url: link, name: row?.name ?? null, error: row ? null : "ad not returned" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const id of batch) out.set(id, { url: null, name: null, error: msg });
    }
  }
  return out;
}

// ============================================================
// LLM product inference
// ============================================================

async function fetchShopifyPageBody(
  storeDomain: string,
  accessToken: string,
  handle: string
): Promise<{ title: string; body_html: string } | null> {
  const url = `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/pages.json?handle=${encodeURIComponent(handle)}`;
  try {
    const res = await fetchWithTimeout(url, { headers: { "X-Shopify-Access-Token": accessToken } }, 15_000);
    if (!res.ok) return null;
    const json = (await res.json()) as { pages: Array<{ title: string; body_html: string }> };
    return json.pages?.[0] ?? null;
  } catch {
    return null;
  }
}

function stripHtml(html: string, maxChars: number): string {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
}

interface InferenceResult {
  product_handles: string[];
  confidence: number;
  reasoning: string;
}

async function inferProductsFromPage(
  pageTitle: string,
  pageBody: string,
  catalog: ShopifyProduct[],
  claudeKey: string
): Promise<InferenceResult | null> {
  // Compact catalog: just handle + title, max 100 products.
  const catalogText = catalog
    .slice(0, 100)
    .map((p) => `${p.handle} — ${p.title}`)
    .join("\n");

  const body = {
    model: HAIKU_MODEL,
    max_tokens: 512,
    system:
      "You map a Cvetita Herbal advertorial page to the Shopify product handle(s) it sells. " +
      "Pick the 1-3 product handles MOST LIKELY to be the page's hero offer. " +
      "Reply with a JSON tool call ONLY.",
    tools: [
      {
        name: "map_page_to_products",
        description: "Return the product handles this advertorial sells, ordered by primary first.",
        input_schema: {
          type: "object",
          properties: {
            product_handles: {
              type: "array",
              items: { type: "string" },
              description: "Shopify product handles from the catalog. 1-3 entries.",
            },
            confidence: {
              type: "number",
              description: "Self-rated confidence 0..1. Use <0.7 if the page is ambiguous.",
            },
            reasoning: {
              type: "string",
              description: "One sentence why these handles, citing evidence from title/body.",
            },
          },
          required: ["product_handles", "confidence", "reasoning"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "map_page_to_products" },
    messages: [
      {
        role: "user",
        content:
          `Advertorial:\nTitle: ${pageTitle}\nBody (excerpt): ${pageBody}\n\n` +
          `Available product handles (handle — title):\n${catalogText}\n\n` +
          `Map the page to its hero product(s).`,
      },
    ],
  };

  try {
    const res = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      },
      30_000
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      content?: Array<{ type: string; name?: string; input?: InferenceResult }>;
    };
    const toolUse = json.content?.find((c) => c.type === "tool_use" && c.name === "map_page_to_products");
    return toolUse?.input ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// Main
// ============================================================

interface PerAccountResult {
  externalId: string;
  newAdsQueued: number;
  resolved: number;
  failed: number;
}

export async function GET(req: Request) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  const claudeKey = process.env.CLAUDE_API_KEY;
  if (!claudeKey) {
    return NextResponse.json({ error: "CLAUDE_API_KEY missing" }, { status: 500 });
  }

  const startedAt = Date.now();
  const sinceDate = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - META_LOOKBACK_DAYS);
    return d.toISOString().slice(0, 10);
  })();

  // ---- Pull all active Meta accounts + their stores (via bindings) ----
  const { data: accountsRaw } = await supabaseAdmin
    .from("integration_accounts")
    .select("id, external_id, organization_id")
    .eq("service", "meta_ads")
    .eq("status", "active");

  const accounts = (accountsRaw ?? []) as IntegrationAccountRow[];

  // Map integration_account_id → primary store_id (for product catalog lookup)
  const { data: bindings } = await supabaseAdmin
    .from("store_integration_bindings")
    .select("integration_account_id, store_id, role")
    .in("integration_account_id", accounts.map((a) => a.id));

  const storeIdByAccount = new Map<string, string>();
  for (const b of (bindings ?? []) as Array<{ integration_account_id: string; store_id: string | null; role: string }>) {
    if (!b.store_id) continue;
    if (b.role === "primary" || !storeIdByAccount.has(b.integration_account_id)) {
      storeIdByAccount.set(b.integration_account_id, b.store_id);
    }
  }

  // Pull store domains once — used for URL parsing to recognise external hosts.
  const storeIds = [...new Set([...storeIdByAccount.values()])];
  const { data: storeRows } = await supabaseAdmin
    .from("stores")
    .select("id, domain")
    .in("id", storeIds);
  const storeDomains = new Set<string>(
    (storeRows ?? []).map((s) => s.domain as string).filter(Boolean)
  );
  // Also accept the custom storefront domains (cvetitaherbal.bg etc.) — best
  // effort: drop the "-herbal-XX.myshopify.com" suffix and substitute the
  // matching cvetitaherbal.<market> guess. Cheaper than another query.
  for (const d of [...storeDomains]) {
    const m = d.match(/^cvetita-herbal-([a-z]{2})\.myshopify\.com$/);
    if (m) storeDomains.add(`cvetitaherbal.${m[1]}`);
  }
  storeDomains.add("cvetitaherbal.com");
  storeDomains.add("cvetitaherbal.co.uk");
  storeDomains.add("p0xgx1-ic.myshopify.com");

  // ---- Phase 1: Discover + resolve ad destinations ----

  const perAccount: PerAccountResult[] = [];
  let totalResolvedThisRun = 0;

  for (const acc of accounts) {
    if (totalResolvedThisRun >= MAX_DESTINATIONS_TO_RESOLVE) break;

    const newIds = await discoverNewAds(acc, sinceDate);
    if (newIds.length === 0) {
      perAccount.push({ externalId: acc.external_id, newAdsQueued: 0, resolved: 0, failed: 0 });
      continue;
    }

    // Trim to remaining run budget
    const slice = newIds.slice(0, MAX_DESTINATIONS_TO_RESOLVE - totalResolvedThisRun);

    let token: string;
    try {
      const client = await getMetaClient(acc.id);
      token = client.token;
    } catch (e) {
      logger.error("resolve-ad-destinations: getMetaClient failed", {
        accountId: acc.id,
        error: e instanceof Error ? e.message : String(e),
      });
      perAccount.push({ externalId: acc.external_id, newAdsQueued: slice.length, resolved: 0, failed: slice.length });
      continue;
    }

    const lookup = await fetchDestinations(slice, token);

    let resolved = 0;
    let failed = 0;
    const rows = slice.map((adId) => {
      const r = lookup.get(adId);
      const parsed = parseDestination(r?.url ?? null, storeDomains);
      if (r?.error || !r?.url) failed++;
      else resolved++;
      return {
        integration_account_id: acc.id,
        ad_id: adId,
        ad_name: r?.name ?? null,
        destination_url: parsed.destination_url,
        destination_path: parsed.destination_path,
        destination_type: parsed.destination_type,
        destination_handle: parsed.destination_handle,
        resolved_at: r?.url ? new Date().toISOString() : null,
        resolve_error: r?.error ?? null,
      };
    });

    if (rows.length > 0) {
      const { error: upsertErr } = await supabaseAdmin
        .from("ad_destinations")
        .upsert(rows, { onConflict: "integration_account_id,ad_id" });
      if (upsertErr) {
        logger.error("resolve-ad-destinations: upsert ad_destinations failed", {
          accountId: acc.id,
          error: upsertErr.message,
        });
        failed = rows.length;
        resolved = 0;
      }
    }

    totalResolvedThisRun += resolved;
    perAccount.push({ externalId: acc.external_id, newAdsQueued: slice.length, resolved, failed });
  }

  // ---- Phase 2: LLM-infer products for new destination_paths ----

  // Get every distinct (store_id, destination_path) seen in ad_destinations
  // that doesn't yet have a destination_products row. Use the integration→store
  // mapping we built above.
  const { data: distinctDestRows } = await supabaseAdmin
    .from("ad_destinations")
    .select("integration_account_id, destination_path, destination_type, destination_handle")
    .in("destination_type", ["product", "page"])
    .not("destination_path", "is", null);

  // Build set of (store_id, destination_path) to consider
  type DestKey = string; // `${store_id}|${path}`
  const candidatesByKey = new Map<DestKey, {
    store_id: string;
    destination_path: string;
    destination_type: string;
    destination_handle: string;
  }>();
  for (const r of (distinctDestRows ?? []) as Array<{
    integration_account_id: string;
    destination_path: string;
    destination_type: string;
    destination_handle: string;
  }>) {
    const storeId = storeIdByAccount.get(r.integration_account_id);
    if (!storeId) continue;
    candidatesByKey.set(`${storeId}|${r.destination_path}`, {
      store_id: storeId,
      destination_path: r.destination_path,
      destination_type: r.destination_type,
      destination_handle: r.destination_handle,
    });
  }

  // Filter out ones already resolved.
  const candidateKeys = [...candidatesByKey.keys()];
  if (candidateKeys.length > 0) {
    const { data: existingMappings } = await supabaseAdmin
      .from("destination_products")
      .select("store_id, destination_path");
    const existingSet = new Set<string>(
      (existingMappings ?? []).map((r) => `${r.store_id}|${r.destination_path}`)
    );
    for (const k of candidateKeys) {
      if (existingSet.has(k)) candidatesByKey.delete(k);
    }
  }

  const toInfer = [...candidatesByKey.values()].slice(0, MAX_PRODUCTS_TO_INFER);

  // Pre-load Shopify catalog per store needed for inference.
  const storeIdsNeeded = [...new Set(toInfer.map((c) => c.store_id))];
  const catalogByStore = new Map<string, ShopifyProduct[]>();
  for (const storeId of storeIdsNeeded) {
    // Use the existing per-store products table — already populated by webhooks
    // and backfill. Avoids round-trips to Shopify just to enumerate names.
    const { data: storeRow } = await supabaseAdmin
      .from("stores")
      .select("market_code")
      .eq("id", storeId)
      .single();
    if (!storeRow?.market_code) continue;
    const { data: prods, error: prodErr } = await supabaseAdmin
      .schema(`store_${storeRow.market_code}` as never)
      .from("products")
      .select("handle, title")
      .eq("status", "active");
    if (prodErr) {
      logger.warn("resolve-ad-destinations: catalog fetch failed", {
        storeId,
        market: storeRow.market_code,
        error: prodErr.message,
      });
      continue;
    }
    catalogByStore.set(storeId, (prods ?? []) as ShopifyProduct[]);
  }

  let inferredCount = 0;
  let inferenceFailed = 0;

  for (const cand of toInfer) {
    const catalog = catalogByStore.get(cand.store_id);
    if (!catalog || catalog.length === 0) {
      inferenceFailed++;
      continue;
    }

    let pageTitle = "";
    let pageBody = "";

    if (cand.destination_type === "product") {
      // Direct product mapping is trivial: the handle IS the product.
      // Skip the LLM, write the row directly.
      const matched = catalog.find((p) => p.handle === cand.destination_handle);
      if (matched) {
        await supabaseAdmin.from("destination_products").upsert(
          {
            store_id: cand.store_id,
            destination_path: cand.destination_path,
            product_handles: [matched.handle],
            inference_confidence: 1.0,
            inference_reasoning: "Direct /products/<handle> URL — no inference needed.",
            inference_model: "rule-direct",
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "store_id,destination_path" }
        );
        inferredCount++;
      } else {
        // Product handle doesn't exist in our catalog (maybe deleted).
        await supabaseAdmin.from("destination_products").upsert(
          {
            store_id: cand.store_id,
            destination_path: cand.destination_path,
            product_handles: [],
            inference_confidence: 0.0,
            inference_reasoning: `Handle "${cand.destination_handle}" not in active catalog.`,
            inference_model: "rule-direct",
          },
          { onConflict: "store_id,destination_path" }
        );
        inferenceFailed++;
      }
      continue;
    }

    // Page (advertorial) — fetch body via Shopify Pages API
    try {
      const config = await loadStoreConfig(cand.store_id);
      const page = await fetchShopifyPageBody(
        config.credentials.store_domain,
        config.credentials.access_token,
        cand.destination_handle
      );
      if (!page) {
        await supabaseAdmin.from("destination_products").upsert(
          {
            store_id: cand.store_id,
            destination_path: cand.destination_path,
            product_handles: [],
            inference_confidence: 0.0,
            inference_reasoning: `Shopify page "${cand.destination_handle}" not found.`,
            inference_model: HAIKU_MODEL,
          },
          { onConflict: "store_id,destination_path" }
        );
        inferenceFailed++;
        continue;
      }
      pageTitle = page.title;
      pageBody = stripHtml(page.body_html, 4000);
    } catch (e) {
      logger.warn("resolve-ad-destinations: shopify page fetch failed", {
        storeId: cand.store_id,
        handle: cand.destination_handle,
        error: e instanceof Error ? e.message : String(e),
      });
      inferenceFailed++;
      continue;
    }

    const result = await inferProductsFromPage(pageTitle, pageBody, catalog, claudeKey);
    if (!result) {
      inferenceFailed++;
      continue;
    }

    // Sanity-filter handles against the catalog so we never store ghosts.
    const validHandles = new Set(catalog.map((p) => p.handle));
    const filtered = result.product_handles.filter((h) => validHandles.has(h));

    await supabaseAdmin.from("destination_products").upsert(
      {
        store_id: cand.store_id,
        destination_path: cand.destination_path,
        product_handles: filtered,
        inference_confidence: filtered.length === 0 ? 0.0 : result.confidence,
        inference_reasoning:
          filtered.length === 0
            ? `LLM suggested handles not in catalog: ${result.product_handles.join(", ")}. Original reasoning: ${result.reasoning}`
            : result.reasoning,
        inference_model: HAIKU_MODEL,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "store_id,destination_path" }
    );
    inferredCount++;
  }

  const durationMs = Date.now() - startedAt;
  logger.info("resolve-ad-destinations completed", {
    durationMs,
    accountsScanned: accounts.length,
    totalResolvedThisRun,
    inferredCount,
    inferenceFailed,
  });

  return NextResponse.json({
    ok: true,
    durationMs,
    accountsScanned: accounts.length,
    totalResolvedThisRun,
    inferredCount,
    inferenceFailed,
    perAccount,
  });
}
