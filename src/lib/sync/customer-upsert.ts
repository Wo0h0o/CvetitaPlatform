import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { pickPhoneFromShopifyOrder } from "@/lib/phone";

/**
 * Upserts a row into <schema>.customers based on a Shopify order payload.
 *
 * Phone is extracted with the fallback chain
 * (customer.phone → shipping.phone → billing.phone → top-level)
 * and normalized to E.164. If no valid phone is found, the function
 * is a no-op — we don't track customers without a phone in v1.
 *
 * Aggregates (total_orders, total_spent, first/last_order_at) are
 * recomputed from the orders table on every call, so re-running on a
 * stale webhook stays correct.
 */
export async function upsertCustomerFromOrder(
  payload: unknown,
  schemaName: string
): Promise<void> {
  if (!payload || typeof payload !== "object") return;

  const phone = pickPhoneFromShopifyOrder(payload as Parameters<typeof pickPhoneFromShopifyOrder>[0]);

  if (!phone.isValid || !phone.e164) {
    return;
  }

  const { error } = await supabaseAdmin.rpc("upsert_customer_from_order", {
    p_schema: schemaName,
    p_phone_e164: phone.e164,
    p_phone_raw: phone.raw,
    p_country: phone.country,
    p_payload: payload,
  });

  if (error) {
    logger.error("upsert_customer_from_order failed", {
      schema: schemaName,
      phone: phone.e164,
      error: error.message,
    });
    throw new Error(`Customer upsert failed: ${error.message}`);
  }
}
