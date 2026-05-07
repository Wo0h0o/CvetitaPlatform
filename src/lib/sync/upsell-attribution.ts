import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { pickPhoneFromShopifyOrder } from "@/lib/phone";

/**
 * On a newly-created order, check the customer's pending_upsell flag and,
 * if active, credit the agent (via public.claim_upsell_attribution).
 *
 * Idempotent on Shopify retries: the SQL function clears the pending flag
 * after the first successful claim, so retries return NULL silently.
 *
 * Fail-soft: any error is logged and swallowed — the order itself is
 * already persisted, and a missed attribution is recoverable manually.
 */
export async function claimUpsellAttribution(
  payload: unknown,
  schemaName: string,
  shopifyOrderId: number
): Promise<void> {
  if (!payload || typeof payload !== "object") return;

  const phone = pickPhoneFromShopifyOrder(payload as Parameters<typeof pickPhoneFromShopifyOrder>[0]);
  if (!phone.isValid || !phone.e164) return;

  const { data, error } = await supabaseAdmin.rpc("claim_upsell_attribution", {
    p_schema: schemaName,
    p_phone: phone.e164,
    p_shopify_order_id: shopifyOrderId,
  });

  if (error) {
    logger.error("claim_upsell_attribution failed", {
      schema: schemaName,
      orderId: shopifyOrderId,
      error: error.message,
    });
    return;
  }

  if (data) {
    logger.info("Upsell attribution claimed", {
      schema: schemaName,
      orderId: shopifyOrderId,
      agentId: data,
    });
  }
}

/**
 * On a cancelled order, revoke any existing upsell attribution.
 * Idempotent: SQL function returns false if already revoked or never
 * attributed.
 */
export async function revokeUpsellAttribution(
  schemaName: string,
  shopifyOrderId: number,
  reason: string = "cancelled"
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("revoke_upsell_attribution", {
    p_schema: schemaName,
    p_shopify_order_id: shopifyOrderId,
    p_reason: reason,
  });

  if (error) {
    logger.error("revoke_upsell_attribution failed", {
      schema: schemaName,
      orderId: shopifyOrderId,
      error: error.message,
    });
    return;
  }

  if (data) {
    logger.info("Upsell attribution revoked", {
      schema: schemaName,
      orderId: shopifyOrderId,
      reason,
    });
  }
}
