-- Migration 021 — period_unique_customers
-- daily_aggregates.unique_customers is per-day distinct emails. Summing
-- across N days double-counts customers who order on multiple days. The
-- dashboard widget needs the period-distinct count instead.
--
-- This function reads orders directly with the same paid-status filter
-- as refresh_daily_aggregates, then COUNT(DISTINCT email) over the whole
-- window in one pass.

CREATE OR REPLACE FUNCTION public.period_unique_customers(
  p_schema TEXT,
  p_from   DATE,
  p_to     DATE
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  EXECUTE format($f$
    WITH latest AS (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id, email, financial_status, event_type
      FROM %I.orders
      WHERE shopify_created_at::date BETWEEN $1 AND $2
      ORDER BY shopify_order_id, received_at DESC
    )
    SELECT COUNT(DISTINCT email)::INTEGER
    FROM latest
    WHERE email IS NOT NULL
      AND event_type != 'cancelled'
      AND financial_status IN ('paid','pending','partially_refunded','partially_paid','authorized')
  $f$, p_schema)
  INTO v_count
  USING p_from, p_to;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.period_unique_customers(TEXT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.period_unique_customers(TEXT, DATE, DATE) TO service_role;
