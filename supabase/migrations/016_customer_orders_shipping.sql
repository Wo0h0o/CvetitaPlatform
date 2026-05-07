-- Migration 016 — extend customer_orders with shipping fields
-- Adds shipping_title (from shipping_lines[0].title) and shipping_address
-- (from shipping_address.address1) so the customer profile can show the
-- courier (Еконт/Спиди/BoxNow/...) and pickup location per order.
--
-- raw_payload->shipping_lines is a JSONB array; we take element 0 since
-- BG orders ship via a single carrier in practice. shipping_address may
-- be null for digital/cancelled orders.

DROP FUNCTION IF EXISTS public.customer_orders(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.customer_orders(
  p_schema  TEXT,
  p_phone   TEXT
) RETURNS TABLE (
  shopify_order_id      BIGINT,
  shopify_order_number  TEXT,
  total_price           NUMERIC,
  subtotal_price        NUMERIC,
  total_discounts       NUMERIC,
  total_refunded        NUMERIC,
  currency              TEXT,
  financial_status      TEXT,
  fulfillment_status    TEXT,
  event_type            TEXT,
  line_items            JSONB,
  shopify_created_at    TIMESTAMPTZ,
  shipping_title        TEXT,
  shipping_address      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ids BIGINT[];
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  IF p_phone IS NULL OR p_phone !~ '^\+\d{8,15}$' THEN
    RAISE EXCEPTION 'Invalid phone format: %', p_phone;
  END IF;

  EXECUTE format(
    'SELECT shopify_customer_ids FROM %I.customers WHERE phone_e164 = $1',
    p_schema
  ) USING p_phone INTO v_ids;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format($f$
    SELECT
      shopify_order_id,
      shopify_order_number,
      total_price,
      subtotal_price,
      total_discounts,
      total_refunded,
      currency,
      financial_status,
      fulfillment_status,
      event_type,
      line_items,
      shopify_created_at,
      shipping_title,
      shipping_address
    FROM (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id,
        shopify_order_number,
        total_price,
        subtotal_price,
        total_discounts,
        total_refunded,
        currency,
        financial_status,
        fulfillment_status,
        event_type,
        line_items,
        shopify_created_at,
        received_at,
        NULLIF(raw_payload->'shipping_lines'->0->>'title', '')   AS shipping_title,
        NULLIF(raw_payload->'shipping_address'->>'address1', '') AS shipping_address
      FROM %I.orders
      WHERE NULLIF(raw_payload->'customer'->>'id','')::BIGINT = ANY($1)
      ORDER BY shopify_order_id, received_at DESC
    ) latest
    ORDER BY shopify_created_at DESC
  $f$, p_schema)
  USING v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_orders(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_orders(TEXT, TEXT) TO service_role;
