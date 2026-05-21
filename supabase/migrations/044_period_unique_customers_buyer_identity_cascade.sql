-- Migration 044 — period_unique_customers v3 buyer-identity cascade
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- Migration 029 created `period_unique_customers(schema, from, to)` to count
-- distinct buyers over a Sofia-anchored date window for the hero KPI strip
-- on /sales ("Уникални клиенти"). That implementation counted
-- COUNT(DISTINCT email) only.
--
-- Migrations 038 and 039 fixed the same identity problem for the
-- geography RPCs (`read_store_sales_by_country`, `read_store_sales_by_city`)
-- by introducing a buyer-identity cascade: when orders.email and the three
-- raw_payload email sources are all NULL (the case for foreign-store
-- schemas whose Shopify webhooks deliver PII-redacted payloads — store_gr,
-- store_it, store_ro, store_de, store_uk, store_hu, store_sk), fall back to
-- `'cust:' || raw_payload.customer.id`. customer.id is per-shop unique and
-- persistent across orders, so it reliably collapses repeat buyers even
-- with no email present.
--
-- period_unique_customers was overlooked in that pass. Result: the /sales
-- hero KPI ("Уникални клиенти" — derived from this RPC) reports
-- understated counts for the seven foreign stores, while the Geography
-- card (derived from the v3 RPCs) reports the real numbers. Two figures
-- for the same concept on the same screen.
--
-- This migration ports the buyer-identity cascade from migration 039 onto
-- period_unique_customers. Net effect:
--
--   * store_bg: unchanged (emails are populated; the customer.id fallback
--     never fires).
--   * store_gr/it/ro/de/uk/hu/sk: counts jump from ~0 to the real number,
--     matching the Geography card's sum.
--
-- Identity-space partitioning rule (same as 039): the 'cust:' prefix
-- ensures customer.id values can never collide with email-shaped strings.
-- Email-based identity is preferred when present — collapses
-- cross-store buyers using the same address. customer.id is a fallback
-- only, by design.
--
-- Long-term: upgrade the foreign-store Shopify apps to `read_customers`
-- scope so emails arrive in the webhook payload, then this cascade
-- collapses to its email branch on all stores. Until then, the v3 cascade
-- is the honest answer.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.period_unique_customers(
  p_schema TEXT,
  p_from   DATE,
  p_to     DATE
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %. Expected format: store_xx or store_xx_suffix', p_schema;
  END IF;

  EXECUTE format($f$
    WITH latest AS (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id,
        shopify_created_at,
        email,
        financial_status,
        event_type,
        raw_payload
      FROM %I.orders
      WHERE (shopify_created_at AT TIME ZONE 'Europe/Sofia')::DATE BETWEEN $1 AND $2
      ORDER BY shopify_order_id, received_at DESC
    ),
    paid_orders AS (
      SELECT
        -- Buyer identity cascade (mirrors migration 039 / v3). Email-based
        -- identity wins when present; customer.id fallback only fires
        -- for PII-redacted payloads. The 'cust:' prefix partitions the
        -- two identity spaces so they can never collide in COUNT DISTINCT.
        COALESCE(
          LOWER(NULLIF(TRIM(COALESCE(
            email,
            raw_payload->'customer'->>'email',
            raw_payload->>'email',
            raw_payload->>'contact_email'
          )), '')),
          NULLIF('cust:' || (raw_payload->'customer'->>'id'), 'cust:')
        ) AS buyer_identity
      FROM latest
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid', 'pending', 'partially_refunded', 'partially_paid', 'authorized')
    )
    SELECT COUNT(DISTINCT buyer_identity)::INTEGER
    FROM paid_orders
    WHERE buyer_identity IS NOT NULL
  $f$, p_schema)
  INTO v_count
  USING p_from, p_to;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.period_unique_customers(TEXT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.period_unique_customers(TEXT, DATE, DATE) TO service_role;

COMMENT ON FUNCTION public.period_unique_customers(TEXT, DATE, DATE) IS
  'Distinct buyer count over a Sofia-anchored date window. v3 (migration 044): buyer identity now cascades email → raw_payload email sources → customer.id fallback, matching the v3 logic in read_store_sales_by_country/by_city (migrations 038/039). Fixes the /sales hero "Уникални клиенти" KPI undercounting foreign-store schemas that ship PII-redacted webhooks (store_gr, store_it, store_ro, store_de, store_uk, store_hu, store_sk).';
