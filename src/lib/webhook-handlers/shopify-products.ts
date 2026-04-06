import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type {
  WebhookEvent,
  StoreConfig,
  NormalizedProduct,
  ProductVariant,
  ProductImage,
} from "@/types/store";

// ============================================================
// Shopify product webhook payload types (partial)
// ============================================================

interface ShopifyVariant {
  id: number;
  sku: string;
  price: string;
  inventory_quantity: number;
  title: string;
}

interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
}

interface ShopifyProductPayload {
  id: number;
  title: string;
  handle: string;
  vendor: string;
  product_type: string;
  status: string;
  tags: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  created_at: string;
  updated_at: string;
}

/**
 * Processes product webhooks: products/create, products/update.
 * Upserts into the per-store products table (latest state wins).
 */
export async function handleProductWebhook(
  event: WebhookEvent,
  config: StoreConfig
): Promise<void> {
  const raw = event.payload;
  if (!raw || typeof raw !== "object" || !("id" in raw) || !("title" in raw)) {
    throw new Error(`Invalid product payload: missing required fields (id, title)`);
  }
  const payload = raw as ShopifyProductPayload;

  const normalized: NormalizedProduct = {
    shopify_product_id: payload.id,
    title: payload.title,
    handle: payload.handle,
    vendor: payload.vendor || null,
    product_type: payload.product_type || null,
    status: payload.status || "active",
    tags: parseTags(payload.tags),
    variants: normalizeVariants(payload.variants || []),
    images: normalizeImages(payload.images || []),
    shopify_created_at: payload.created_at,
    shopify_updated_at: payload.updated_at,
  };

  // Build the DB row — Supabase handles JSONB serialization automatically
  const row = {
    ...normalized,
    synced_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .schema(config.schemaName)
    .from("products")
    .upsert(row, { onConflict: "shopify_product_id" });

  if (error) {
    throw new Error(`Product upsert failed: ${error.message}`);
  }

  logger.info("Product webhook processed", {
    storeId: event.storeId,
    productId: payload.id,
    title: payload.title,
    topic: event.topic,
  });
}

// ============================================================
// Helpers
// ============================================================

function parseTags(tags: string): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeVariants(variants: ShopifyVariant[]): ProductVariant[] {
  return variants.map((v) => ({
    id: v.id,
    sku: v.sku || null,
    price: parseFloat(v.price) || 0,
    inventory_quantity: v.inventory_quantity || 0,
    title: v.title,
  }));
}

function normalizeImages(images: ShopifyImage[]): ProductImage[] {
  return images.map((img) => ({
    id: img.id,
    src: img.src,
    alt: img.alt || null,
  }));
}
