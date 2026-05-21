-- Migration 035 — public.read_store_hourly_aggregates_multi
--
-- Why: read_store_hourly_aggregates(p_schema, p_date) returns 24 rows for
-- one date. The home dashboard needs hourly data for today + 4 prior
-- same-weekdays (5 dates) × 6 active store schemas = 30 RPC calls — slow,
-- and 30 round-trips burns the Edge Function budget.
--
-- This variant accepts a DATE[] and returns rows tagged with the date,
-- collapsing the call count to 6 (one per schema). The single-date variant
-- stays in place for ad-hoc/admin use.

CREATE OR REPLACE FUNCTION public.read_store_hourly_aggregates_multi(
  p_schema TEXT,
  p_dates  DATE[]
)
RETURNS TABLE (
  order_date      DATE,
  hour            SMALLINT,
  total_revenue   NUMERIC,
  total_orders    INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
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
      WHERE (shopify_created_at AT TIME ZONE 'Europe/Sofia')::DATE = ANY($1)
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
        order_date,
        hour,
        SUM(total_price_eur)::NUMERIC(14,2) AS total_revenue,
        COUNT(*)::INTEGER                   AS total_orders
      FROM paid_orders
      GROUP BY order_date, hour
    )
    SELECT
      d::DATE                                              AS order_date,
      h::SMALLINT                                          AS hour,
      COALESCE(hourly.total_revenue, 0)::NUMERIC(14,2)     AS total_revenue,
      COALESCE(hourly.total_orders, 0)::INTEGER            AS total_orders
    FROM UNNEST($1::DATE[]) AS d
    CROSS JOIN generate_series(0, 23) AS h
    LEFT JOIN hourly
      ON hourly.order_date = d
     AND hourly.hour       = h
    ORDER BY d, h
  $f$, p_schema) USING p_dates;
END;
$$;

GRANT EXECUTE ON FUNCTION public.read_store_hourly_aggregates_multi(TEXT, DATE[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.read_store_hourly_aggregates_multi(TEXT, DATE[]) IS
  'Batched hourly aggregates. Returns 24 × N rows (N = |p_dates|), zero-filled. Used by the home top-strip route for the "Днес"/"Вчера" curves which need today + 4 prior same-weekdays in one call.';
