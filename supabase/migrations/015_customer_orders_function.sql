-- Migration 015 — customer_orders function
-- Returns the order timeline for a single customer, joined by the customer's
-- shopify_customer_ids array (handles guest→registered merges). DISTINCT ON
-- shopify_order_id + ORDER BY received_at DESC picks the latest event per
-- order, so cancellations/refunds are reflected. Cancelled orders are kept
-- in the result (UI may grey them out) but financial fields stay accurate.
--
-- Used by GET /api/customers/[phone] for the profile timeline.

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
  shopify_created_at    TIMESTAMPTZ
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
      shopify_created_at
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
        received_at
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
