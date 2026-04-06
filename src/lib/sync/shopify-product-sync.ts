import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildShopifyFetch,
  getNextPageUrl,
} from "@/lib/store-config-loader";
import { withRetry } from "@/lib/fetch-utils";
import { logger } from "@/lib/logger";
import type {
  StoreConfig,
  NormalizedProduct,
  ProductVariant,
  ProductImage,
} from "@/types/store";
import type { SyncProgressTracker } from "./sync-progress";

const PAGE_DELAY_MS = 500;

interface ShopifyProductRaw {
  id: number;
  title: string;
  handle: string;
  vendor: string;
  product_type: string;
  status: string;
  tags: string;
  variants: {
    id: number;
    sku: string;
    price: string;
    inventory_quantity: number;
    title: string;
  }[];
  images: {
    id: number;
    src: string;
    alt: string | null;
  }[];
  created_at: string;
  updated_at: string;
}

/**
 * Syncs the full active product catalog from Shopify into the per-store products table.
 * Uses upsert on shopify_product_id, so re-running is safe.
 *
 * Returns the total number of products synced.
 */
export async function syncProducts(
  config: StoreConfig,
  tracker: SyncProgressTracker
): Promise<number> {
  const shopify = buildShopifyFetch(config);
  const schema = config.schemaName;

  let url: string | null = "/products.json?limit=250&status=active";
  let page = 0;
  let totalSynced = 0;
  let rateLimitRetries = 0;
  const MAX_RATE_LIMIT_RETRIES = 10;
  const syncedIds: number[] = [];

  await tracker.start();

  while (url) {
    const res = await withRetry(() => shopify(url!), {
      retries: 3,
      baseDelay: 2000,
      shouldRetry: (err) => {
        if (err instanceof Error && err.message.includes("timed out"))
          return true;
        if (err instanceof Error && err.message.includes("429")) return true;
        return false;
      },
    });

    if (!res.ok) {
      if (res.status === 429) {
        if (++rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
          throw new Error("Too many rate-limit retries (429) during product sync");
        }
        const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
        await sleep(retryAfter * 1000);
        continue;
      }
      throw new Error(`Shopify products API returned ${res.status}`);
    }
    rateLimitRetries = 0;

    const data = await res.json();
    const products: ShopifyProductRaw[] = data.products || [];

    if (products.length > 0) {
      const rows = products.map(normalizeProduct);

      const { error } = await supabaseAdmin
        .schema(schema)
        .from("products")
        .upsert(
          rows.map((p) => ({
            ...p,
            synced_at: new Date().toISOString(),
          })),
          { onConflict: "shopify_product_id" }
        );

      if (error) {
        logger.error("Product batch upsert failed", {
          storeId: config.store.id,
          page,
          error: error.message,
        });
      } else {
        totalSynced += products.length;
        syncedIds.push(...products.map((p) => p.id));
      }
    }

    page++;
    await tracker.updatePage(page, totalSynced);

    // Follow pagination
    const linkHeader = res.headers.get("link");
    const nextUrl = getNextPageUrl(linkHeader);

    if (nextUrl) {
      const parsed = new URL(nextUrl);
      url =
        parsed.pathname.replace(
          `/admin/api/${config.credentials.api_version}`,
          ""
        ) + parsed.search;
      await sleep(PAGE_DELAY_MS);
    } else {
      url = null;
    }
  }

  // Mark products not in this sync as archived (handles Shopify deletions)
  if (syncedIds.length > 0) {
    // Supabase .filter() with "not.in" syntax for array exclusion
    await supabaseAdmin
      .schema(schema)
      .from("products")
      .update({ status: "archived", synced_at: new Date().toISOString() })
      .eq("status", "active")
      .filter(
        "shopify_product_id",
        "not.in",
        `(${syncedIds.join(",")})`
      );
  }

  await tracker.complete(totalSynced);

  logger.info("Product catalog sync complete", {
    storeId: config.store.id,
    totalSynced,
    pages: page,
  });

  return totalSynced;
}

// ============================================================
// Helpers
// ============================================================

function normalizeProduct(product: ShopifyProductRaw): NormalizedProduct {
  const variants: ProductVariant[] = (product.variants || []).map((v) => ({
    id: v.id,
    sku: v.sku || null,
    price: parseFloat(v.price) || 0,
    inventory_quantity: v.inventory_quantity || 0,
    title: v.title,
  }));

  const images: ProductImage[] = (product.images || []).map((img) => ({
    id: img.id,
    src: img.src,
    alt: img.alt || null,
  }));

  const tags = product.tags
    ? product.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  return {
    shopify_product_id: product.id,
    title: product.title,
    handle: product.handle,
    vendor: product.vendor || null,
    product_type: product.product_type || null,
    status: product.status || "active",
    tags,
    variants,
    images,
    shopify_created_at: product.created_at,
    shopify_updated_at: product.updated_at,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
