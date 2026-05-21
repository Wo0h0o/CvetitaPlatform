-- Migration 034 — public.read_store_hourly_aggregates
--
-- Why: the home dashboard's "Днес" preset (and the typical-day baseline that
-- pairs with it) needs per-hour revenue + orders for a specific Sofia date.
-- daily_aggregates is too coarse; the orders table has the raw timestamps
-- but lives in per-store schemas (`store_<market>`) that PostgREST may not
-- have refreshed yet — same problem migration 025 solved for daily reads.
--
-- Mirror of read_store_daily_aggregates, but bucketed by Sofia hour:
--   * Sofia-tz cast BEFORE the EXTRACT/DATE_TRUNC (the same gotcha
--     migration 029 fixed in refresh_daily_aggregates — see
--     feedback_sofia_tz_bucketing.md).
--   * Same DISTINCT ON (shopify_order_id) + paid_orders gate so a late
--     refund or cancellation webhook removes the row.
--   * Returns 24 fixed rows per call via generate_series, zero-filled for
--     hours with no orders. Callers don't need to defensive-pad.

CREATE OR REPLACE FUNCTION public.read_store_hourly_aggregates(
  p_schema TEXT,
  p_date   DATE
)
RETURNS TABLE (
  hour            SMALLINT,
  total_revenue   NUMERIC,
  total_orders    INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Same shape validator as create_store_schema() — refuse anything that
  -- doesn't look like a per-store schema name.
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %. Expected format: store_xx or store_xx_suffix', p_schema;
  END IF;

  RETURN QUERY EXECUTE format($f$
    WITH latest_orders AS (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id,
        shopify_created_at,
        total_price_eur,
        financial_status,
        event_type
      FROM %I.orders
      ORDER BY shopify_order_id, received_at DESC
    ),
    paid_orders AS (
      SELECT
        (shopify_created_at AT TIME ZONE 'Europe/Sofia')::DATE  AS order_date,
        EXTRACT(HOUR FROM (shopify_created_at AT TIME ZONE 'Europe/Sofia'))::SMALLINT AS hour,
        total_price_eur
      FROM latest_orders
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid', 'pending', 'partially_refunded', 'partially_paid', 'authorized')
    ),
    hourly AS (
      SELECT
        hour,
        COALESCE(SUM(total_price_eur), 0)::NUMERIC(14,2) AS total_revenue,
        COUNT(*)::INTEGER                                AS total_orders
      FROM paid_orders
      WHERE order_date = $1
      GROUP BY hour
    )
    SELECT
      h::SMALLINT                                         AS hour,
      COALESCE(hourly.total_revenue, 0)::NUMERIC(14,2)    AS total_revenue,
      COALESCE(hourly.total_orders, 0)::INTEGER           AS total_orders
    FROM generate_series(0, 23) AS h
    LEFT JOIN hourly ON hourly.hour = h
    ORDER BY h
  $f$, p_schema) USING p_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.read_store_hourly_aggregates(TEXT, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.read_store_hourly_aggregates(TEXT, DATE) IS
  'Cross-schema read for per-store hourly order aggregates (Sofia tz). Always returns 24 rows (one per hour, zero-filled). Used by the home dashboard "Днес" preset to draw the 0-24h cumulative tempo curve.';
