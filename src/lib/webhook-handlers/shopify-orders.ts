import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type {
  WebhookEvent,
  StoreConfig,
  NormalizedOrder,
  NormalizedLineItem,
} from "@/types/store";

// ============================================================
// Shopify order/refund webhook payload types (partial)
// ============================================================

interface ShopifyLineItem {
  id: number;
  product_id: number | null;
  variant_id: number | null;
  title: string;
  quantity: number;
  price: string;
  sku: string | null;
}

interface ShopifyOrderPayload {
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
  line_items: ShopifyLineItem[];
  refunds?: { transactions?: { amount: string }[] }[];
}

/**
 * Processes order-related webhooks: orders/create, orders/updated,
 * orders/cancelled, refunds/create.
 *
 * Inserts into the per-store append-only orders table.
 */
export async function handleOrderWebhook(
  event: WebhookEvent,
  config: StoreConfig
): Promise<void> {
  const raw = event.payload;
  if (!raw || typeof raw !== "object" || !("id" in raw) || !("financial_status" in raw)) {
    throw new Error(`Invalid order payload: missing required fields (id, financial_status)`);
  }
  const payload = raw as ShopifyOrderPayload;
  const eventType = mapTopicToEventType(event.topic);

  const totalRefunded = calculateRefundTotal(payload);

  const normalized: NormalizedOrder = {
    shopify_order_id: payload.id,
    shopify_order_number: payload.name || `#${payload.order_number}`,
    webhook_event_id: event.webhookId,
    event_type: eventType,
    email: payload.email || null,
    financial_status: payload.financial_status,
    fulfillment_status: payload.fulfillment_status || null,
    currency: payload.currency || "EUR",
    total_price: parseFloat(payload.total_price) || 0,
    subtotal_price: parseFloat(payload.subtotal_price) || 0,
    total_tax: parseFloat(payload.total_tax) || 0,
    total_discounts: parseFloat(payload.total_discounts) || 0,
    total_refunded: totalRefunded,
    line_items: normalizeLineItems(payload.line_items || []),
    raw_payload: payload,
    shopify_created_at: payload.created_at,
    shopify_updated_at: payload.updated_at,
  };

  const { error } = await supabaseAdmin
    .schema(config.schemaName)
    .from("orders")
    .insert(normalized);

  if (error) {
    // Duplicate webhook_event_id is expected on retries — not an error
    if (error.code === "23505") {
      logger.info("Duplicate order event skipped", {
        storeId: event.storeId,
        orderId: payload.id,
        webhookId: event.webhookId,
      });
      return;
    }
    throw new Error(`Order insert failed: ${error.message}`);
  }

  logger.info("Order webhook processed", {
    storeId: event.storeId,
    orderId: payload.id,
    eventType,
    total: normalized.total_price,
  });
}

// ============================================================
// Helpers
// ============================================================

function mapTopicToEventType(
  topic: string
): NormalizedOrder["event_type"] {
  switch (topic) {
    case "orders/create":
      return "created";
    case "orders/updated":
      return "updated";
    case "orders/cancelled":
      return "cancelled";
    case "refunds/create":
      return "refunded";
    default:
      return "updated";
  }
}

function normalizeLineItems(items: ShopifyLineItem[]): NormalizedLineItem[] {
  return items.map((item) => ({
    shopify_line_item_id: item.id,
    product_id: item.product_id || null,
    variant_id: item.variant_id || null,
    title: item.title,
    quantity: item.quantity,
    price: parseFloat(item.price) || 0,
    sku: item.sku || null,
  }));
}

function calculateRefundTotal(payload: ShopifyOrderPayload): number {
  if (!payload.refunds?.length) return 0;
  return payload.refunds.reduce((sum, refund) => {
    const txTotal = (refund.transactions || []).reduce(
      (txSum, tx) => txSum + (parseFloat(tx.amount) || 0),
      0
    );
    return sum + txTotal;
  }, 0);
}
