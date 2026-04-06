import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadStoreConfig } from "@/lib/store-config-loader";
import { handleOrderWebhook } from "@/lib/webhook-handlers/shopify-orders";
import { handleProductWebhook } from "@/lib/webhook-handlers/shopify-products";
import { logger } from "@/lib/logger";
import type { WebhookEvent, StoreConfig } from "@/types/store";

const ORDER_TOPICS = new Set([
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "refunds/create",
]);

/**
 * Shopify Webhook Receiver
 *
 * Flow: HMAC verify → idempotency check → route to handler → refresh aggregates → return 200
 * No auth middleware needed — /api/ paths are excluded in middleware.ts.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params;

  // 1. Read raw body for HMAC verification (must be before JSON parsing)
  const rawBody = Buffer.from(await req.arrayBuffer());

  // 2. Extract Shopify headers
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") || "";
  const topic = req.headers.get("x-shopify-topic") || "";
  const webhookId = req.headers.get("x-shopify-webhook-id") || "";
  const shopDomain = req.headers.get("x-shopify-shop-domain") || "";

  if (!hmacHeader || !topic || !webhookId) {
    return NextResponse.json(
      { error: "Missing required Shopify headers" },
      { status: 400 }
    );
  }

  // 3. Load store config
  let config: StoreConfig;
  try {
    config = await loadStoreConfig(storeId);
  } catch {
    logger.warn("Webhook for unknown/inactive store", { storeId, topic });
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  // 4. HMAC verification
  // TODO [SECURITY]: Re-enable when Shopify client_secret is available.
  // Without this, anyone who knows the URL can send fake webhooks.
  // See: memory/project_security_debt.md
  if (config.credentials.client_secret) {
    const computed = crypto
      .createHmac("sha256", config.credentials.client_secret)
      .update(rawBody)
      .digest("base64");

    const hmacValid = safeCompare(computed, hmacHeader);
    if (!hmacValid) {
      logger.security("Webhook HMAC mismatch", { storeId, topic, shopDomain });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    logger.warn("Webhook HMAC verification SKIPPED — no client_secret", {
      storeId,
      topic,
    });
  }

  // 5. Idempotency check via webhook_log
  const schema = config.schemaName;

  const { data: existing } = await supabaseAdmin
    .schema(schema)
    .from("webhook_log")
    .select("processed")
    .eq("webhook_id", webhookId)
    .maybeSingle();

  if (existing?.processed) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // 6. Insert into webhook_log (upsert for retry safety)
  await supabaseAdmin.schema(schema).from("webhook_log").upsert(
    {
      webhook_id: webhookId,
      topic,
      processed: false,
    },
    { onConflict: "webhook_id" }
  );

  // 7. Parse payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    logger.warn("Webhook payload is not valid JSON", { storeId, topic });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event: WebhookEvent = {
    webhookId,
    topic,
    storeId,
    shopDomain,
    payload,
    receivedAt: new Date(),
  };

  try {
    await routeWebhook(event, config);

    // 8. Mark as processed
    await supabaseAdmin
      .schema(schema)
      .from("webhook_log")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("webhook_id", webhookId);

    // 9. Refresh daily aggregates after order events (real-time, no cron needed)
    if (ORDER_TOPICS.has(event.topic)) {
      await supabaseAdmin.rpc("refresh_daily_aggregates", {
        p_schema: schema,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Webhook processing failed", {
      storeId,
      topic,
      webhookId,
      error: message,
    });

    await supabaseAdmin
      .schema(schema)
      .from("webhook_log")
      .update({ error_message: message })
      .eq("webhook_id", webhookId);
  }

  // Always return 200 to prevent Shopify retry storms
  return NextResponse.json({ ok: true });
}

// ============================================================
// Helpers
// ============================================================

async function routeWebhook(
  event: WebhookEvent,
  config: StoreConfig
): Promise<void> {
  switch (event.topic) {
    case "orders/create":
    case "orders/updated":
    case "orders/cancelled":
    case "refunds/create":
      await handleOrderWebhook(event, config);
      break;
    case "products/create":
    case "products/update":
      await handleProductWebhook(event, config);
      break;
    default:
      logger.warn("Unhandled webhook topic", {
        topic: event.topic,
        storeId: event.storeId,
      });
  }
}

/**
 * Timing-safe string comparison to prevent timing attacks on HMAC.
 */
function safeCompare(a: string, b: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
