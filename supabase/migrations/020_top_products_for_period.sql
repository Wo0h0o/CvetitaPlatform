-- Migration 020 — top_products_for_period
-- Replaces the cached `daily_aggregates.top_products` (TOP 5 per day)
-- which loses long-tail products: a product that's #6 on a given day
-- never enters the cache, so when the UI sums daily caches across a
-- multi-day window the long tail gets undercounted.
--
-- This function reads directly from orders for the requested period,
-- using DISTINCT ON for the latest event per shopify_order_id and the
-- same paid-status filter as refresh_daily_aggregates.

CREATE OR REPLACE FUNCTION public.top_products_for_period(
  p_schema TEXT,
  p_from   DATE,
  p_to     DATE,
  p_limit  INT DEFAULT 50
) RETURNS TABLE (
  title    TEXT,
  quantity BIGINT,
  revenue  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  RETURN QUERY EXECUTE format($f$
    WITH latest AS (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id, line_items, financial_status, event_type
      FROM %I.orders
      WHERE shopify_created_at::date BETWEEN $1 AND $2
      ORDER BY shopify_order_id, received_at DESC
    ),
    paid AS (
      SELECT line_items FROM latest
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid','pending','partially_refunded','partially_paid','authorized')
    )
    SELECT
      (li->>'title')::TEXT AS title,
      SUM((li->>'quantity')::INT)::BIGINT AS quantity,
      SUM((li->>'price')::NUMERIC * (li->>'quantity')::INT)::NUMERIC(12,2) AS revenue
    FROM paid, jsonb_array_elements(line_items) li
    WHERE li->>'title' IS NOT NULL
    GROUP BY li->>'title'
    ORDER BY 3 DESC NULLS LAST
    LIMIT $3
  $f$, p_schema)
  USING p_from, p_to, p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.top_products_for_period(TEXT, DATE, DATE, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.top_products_for_period(TEXT, DATE, DATE, INT) TO service_role;
