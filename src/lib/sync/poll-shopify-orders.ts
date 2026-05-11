import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildShopifyFetch, getNextPageUrl } from "@/lib/store-config-loader";
import { withRetry } from "@/lib/fetch-utils";
import { logger } from "@/lib/logger";
import { getRateToEur } from "@/lib/exchange-rates";
import { upsertCustomerFromOrder } from "@/lib/sync/customer-upsert";
import type { StoreConfig, NormalizedOrder, NormalizedLineItem } from "@/types/store";

/**
 * Pull orders updated since `sinceISO` and upsert into <schema>.orders.
 *
 * Why polling exists:
 *   Shopify webhooks require a valid app API secret for HMAC verification.
 *   Until the secret in store_credentials is corrected, real-time webhooks
 *   stay 401-rejected. This cron-driven poll uses only the access_token (which
 *   we have) so the dashboard stays current with at most ~poll-interval lag.
 *
 * Idempotency:
 *   webhook_event_id = `poll-{order_id}-{updated_at_iso}` → repeat fetches
 *   of the same shopify_updated_at collapse to one row via the UNIQUE index.
 *   When Shopify advances updated_at (e.g. fulfillment change), a new row is
 *   appended — matches the existing webhook semantics where every event
 *   becomes a new history entry.
 */
export interface PollResult {
  fetched: number;
  inserted: number;
  skipped: number;
  errors: number;
  customerUpserts: number;
  latestUpdatedAt: string | null;
}

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
  line_items: Array<{
    id: number;
    product_id: number | null;
    variant_id: number | null;
    title: string;
    quantity: number;
    price: string;
    sku: string | null;
  }>;
  refunds?: Array<{ transactions?: Array<{ amount: string }> }>;
}

const PAGE_DELAY_MS = 250;

export async function pollShopifyOrders(
  config: StoreConfig,
  sinceISO: string
): Promise<PollResult> {
  const shopify = buildShopifyFetch(config);
  const schema = config.schemaName;

  const params = new URLSearchParams({
    status: "any",
    updated_at_min: sinceISO,
    limit: "250",
  });

  let url: string | null = `/orders.json?${params.toString()}`;
  const result: PollResult = {
    fetched: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
    customerUpserts: 0,
    latestUpdatedAt: null,
  };

  while (url) {
    const res = await withRetry(() => shopify(url!), {
      retries: 3,
      baseDelay: 1500,
      shouldRetry: (err) =>
        err instanceof Error && (err.message.includes("timed out") || err.message.includes("429")),
    });
    if (!res.ok) {
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
        await sleep(retryAfter * 1000);
        continue;
      }
      throw new Error(`Shopify orders API ${res.status} for ${config.schemaName}`);
    }

    const data = (await res.json()) as { orders?: ShopifyOrderRaw[] };
    const orders = data.orders || [];
    result.fetched += orders.length;

    for (const o of orders) {
      const normalized = await normalizeOrder(o);
      if (!result.latestUpdatedAt || o.updated_at > result.latestUpdatedAt) {
        result.latestUpdatedAt = o.updated_at;
      }
      // Insert through the public RPC wrapper so writes don't depend on
      // PostgREST's exposed-schemas cache being current. RPC returns the
      // new id on insert, NULL on duplicate (ON CONFLICT DO NOTHING).
      // See migration 026.
      const { data: insertedId, error } = await supabaseAdmin.rpc(
        "insert_store_order",
        { p_schema: schema, p_row: normalized }
      );
      if (error) {
        result.errors++;
        logger.error("poll-orders insert failed", {
          schema,
          orderId: o.id,
          code: error.code,
          error: error.message,
        });
        continue;
      }
      if (insertedId === null || insertedId === undefined) {
        result.skipped++;
      } else {
        result.inserted++;
      }

      try {
        await upsertCustomerFromOrder(o, schema);
        result.customerUpserts++;
      } catch {
        // upsert already logs internally; continue polling
      }
    }

    const nextUrl = getNextPageUrl(res.headers.get("link"));
    if (nextUrl) {
      const parsed = new URL(nextUrl);
      url =
        parsed.pathname.replace(`/admin/api/${config.credentials.api_version}`, "") +
        parsed.search;
      await sleep(PAGE_DELAY_MS);
    } else {
      url = null;
    }
  }

  return result;
}

async function normalizeOrder(o: ShopifyOrderRaw): Promise<NormalizedOrder> {
  const refundTotal = (o.refunds || []).reduce((sum, refund) => {
    const tx = (refund.transactions || []).reduce(
      (s, t) => s + (parseFloat(t.amount) || 0),
      0
    );
    return sum + tx;
  }, 0);

  const lineItems: NormalizedLineItem[] = (o.line_items || []).map((item) => ({
    shopify_line_item_id: item.id,
    product_id: item.product_id || null,
    variant_id: item.variant_id || null,
    title: item.title,
    quantity: item.quantity,
    price: parseFloat(item.price) || 0,
    sku: item.sku || null,
  }));

  const currency = o.currency || "EUR";
  let exchangeRate = 1.0;
  if (currency !== "EUR") {
    try {
      exchangeRate = await getRateToEur(currency, new Date(o.created_at));
    } catch (err) {
      logger.error("poll: rate lookup failed; storing rate=1", {
        orderId: o.id,
        currency,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    shopify_order_id: o.id,
    shopify_order_number: o.name || `#${o.order_number}`,
    webhook_event_id: `poll-${o.id}-${o.updated_at}`,
    event_type: o.cancelled_at ? "cancelled" : "updated",
    email: o.email || null,
    financial_status: o.financial_status,
    fulfillment_status: o.fulfillment_status || null,
    currency,
    total_price: parseFloat(o.total_price) || 0,
    subtotal_price: parseFloat(o.subtotal_price) || 0,
    total_tax: parseFloat(o.total_tax) || 0,
    total_discounts: parseFloat(o.total_discounts) || 0,
    total_refunded: refundTotal,
    exchange_rate_to_eur: exchangeRate,
    line_items: lineItems,
    raw_payload: o,
    shopify_created_at: o.created_at,
    shopify_updated_at: o.updated_at,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
