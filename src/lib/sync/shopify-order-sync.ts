import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildShopifyFetch,
  getNextPageUrl,
} from "@/lib/store-config-loader";
import { withRetry } from "@/lib/fetch-utils";
import { logger } from "@/lib/logger";
import type {
  StoreConfig,
  NormalizedOrder,
  NormalizedLineItem,
} from "@/types/store";
import type { SyncProgressTracker } from "./sync-progress";

const PAGE_DELAY_MS = 500;

interface ShopifyOrderRaw {
  id: number;
  name: string;
  order_number: number;
  email: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  currency: string;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_discounts: string;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  line_items: {
    id: number;
    product_id: number | null;
    variant_id: number | null;
    title: string;
    quantity: number;
    price: string;
    sku: string | null;
  }[];
  refunds?: { transactions?: { amount: string }[] }[];
}

/**
 * Backfills orders from Shopify REST API into the per-store orders table.
 * Uses synthetic webhook_event_ids (`backfill_{orderId}`) for idempotency,
 * so re-running the sync is safe (upsert with ignoreDuplicates).
 *
 * Returns the total number of orders synced.
 */
export async function syncOrders(
  config: StoreConfig,
  tracker: SyncProgressTracker,
  daysBack = 90
): Promise<number> {
  const shopify = buildShopifyFetch(config);
  const schema = config.schemaName;

  const dateMin = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const dateMax = new Date().toISOString();

  const params = new URLSearchParams({
    created_at_min: dateMin,
    created_at_max: dateMax,
    status: "any",
    limit: "250",
  });

  let url: string | null = `/orders.json?${params.toString()}`;
  let page = 0;
  let totalSynced = 0;
  let rateLimitRetries = 0;
  const MAX_RATE_LIMIT_RETRIES = 10;

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
          throw new Error("Too many rate-limit retries (429) during order sync");
        }
        const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
        await sleep(retryAfter * 1000);
        continue;
      }
      throw new Error(`Shopify orders API returned ${res.status}`);
    }
    rateLimitRetries = 0;

    const data = await res.json();
    const orders: ShopifyOrderRaw[] = data.orders || [];

    if (orders.length > 0) {
      const normalized = orders.map(normalizeOrder);

      const { error } = await supabaseAdmin
        .schema(schema)
        .from("orders")
        .upsert(normalized, {
          onConflict: "webhook_event_id",
          ignoreDuplicates: true,
        });

      if (error) {
        logger.error("Order batch insert failed", {
          storeId: config.store.id,
          page,
          error: error.message,
        });
      } else {
        totalSynced += orders.length;
      }
    }

    page++;
    await tracker.updatePage(page, totalSynced);

    // Follow pagination
    const linkHeader = res.headers.get("link");
    const nextUrl = getNextPageUrl(linkHeader);

    if (nextUrl) {
      // Extract relative path from full URL
      const parsed = new URL(nextUrl);
      url = parsed.pathname.replace(
        `/admin/api/${config.credentials.api_version}`,
        ""
      ) + parsed.search;
      await sleep(PAGE_DELAY_MS);
    } else {
      url = null;
    }
  }

  await tracker.complete(totalSynced);

  logger.info("Order backfill complete", {
    storeId: config.store.id,
    totalSynced,
    pages: page,
    daysBack,
  });

  return totalSynced;
}

// ============================================================
// Helpers
// ============================================================

function normalizeOrder(order: ShopifyOrderRaw): NormalizedOrder {
  const refundTotal = (order.refunds || []).reduce((sum, refund) => {
    const txTotal = (refund.transactions || []).reduce(
      (txSum, tx) => txSum + (parseFloat(tx.amount) || 0),
      0
    );
    return sum + txTotal;
  }, 0);

  const lineItems: NormalizedLineItem[] = (order.line_items || []).map(
    (item) => ({
      shopify_line_item_id: item.id,
      product_id: item.product_id || null,
      variant_id: item.variant_id || null,
      title: item.title,
      quantity: item.quantity,
      price: parseFloat(item.price) || 0,
      sku: item.sku || null,
    })
  );

  return {
    shopify_order_id: order.id,
    shopify_order_number: order.name || `#${order.order_number}`,
    webhook_event_id: `backfill_${order.id}`,
    event_type: order.cancelled_at ? "cancelled" : "created",
    email: order.email || null,
    financial_status: order.financial_status,
    fulfillment_status: order.fulfillment_status || null,
    currency: order.currency || "EUR",
    total_price: parseFloat(order.total_price) || 0,
    subtotal_price: parseFloat(order.subtotal_price) || 0,
    total_tax: parseFloat(order.total_tax) || 0,
    total_discounts: parseFloat(order.total_discounts) || 0,
    total_refunded: refundTotal,
    line_items: lineItems,
    raw_payload: order,
    shopify_created_at: order.created_at,
    shopify_updated_at: order.updated_at,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
