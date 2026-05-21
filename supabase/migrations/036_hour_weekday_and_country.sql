-- Migration 036 — read_store_hour_weekday + read_store_sales_by_country
--
-- Two new cross-schema reads for the /sales surface:
--
--   1) read_store_hour_weekday(p_schema, p_from, p_to)
--      Aggregates paid orders by Sofia weekday × hour over the [from, to]
--      window. Always returns 7 × 24 = 168 rows, zero-filled — the heatmap
--      client doesn't need to pad.
--
--   2) read_store_sales_by_country(p_schema, p_from, p_to)
--      Aggregates paid orders by shipping_address.country_code over the
--      window. Returns one row per (country_code) actually shipped to;
--      callers merge across schemas. Used by the world-map view.
--
-- Both follow the same DISTINCT ON (shopify_order_id) + paid_orders gate
-- the daily/hourly readers already use, so a late refund/cancel webhook
-- correctly drops the order from the aggregates.
--
-- ISO weekday convention: Monday=1 ... Sunday=7. БГ users read calendars
-- Mon-first, so we use EXTRACT(ISODOW) instead of EXTRACT(DOW) (which
-- returns Sunday=0).
--
-- No new column / index on orders for the country reader: we extract from
-- raw_payload->'shipping_address'->>'country_code' on the fly. Current
-- volume (~60k orders/year cross-store) makes a sequential JSON extract
-- sub-second when combined with the existing shopify_created_at index.
-- If volume grows past ~500k/year we revisit with a JSON expression index.

-- =====================================================================
-- 1) read_store_hour_weekday — heatmap data
-- =====================================================================

CREATE OR REPLACE FUNCTION public.read_store_hour_weekday(
  p_schema TEXT,
  p_from   DATE,
  p_to     DATE
)
RETURNS TABLE (
  weekday         SMALLINT,  -- ISO: 1 = Mon, 7 = Sun
  hour            SMALLINT,  -- 0-23 Sofia hour
  total_revenue   NUMERIC,
  total_orders    INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
      WHERE (shopify_created_at AT TIME ZONE 'Europe/Sofia')::DATE BETWEEN $1 AND $2
      ORDER BY shopify_order_id, received_at DESC
    ),
    paid_orders AS (
      SELECT
        EXTRACT(ISODOW FROM (shopify_created_at AT TIME ZONE 'Europe/Sofia'))::SMALLINT AS weekday,
        EXTRACT(HOUR   FROM (shopify_created_at AT TIME ZONE 'Europe/Sofia'))::SMALLINT AS hour,
        total_price_eur
      FROM latest_orders
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid', 'pending', 'partially_refunded', 'partially_paid', 'authorized')
    ),
    bucketed AS (
      SELECT
        weekday,
        hour,
        SUM(total_price_eur)::NUMERIC(14,2) AS total_revenue,
        COUNT(*)::INTEGER                   AS total_orders
      FROM paid_orders
      GROUP BY weekday, hour
    )
    SELECT
      wd::SMALLINT                                         AS weekday,
      h::SMALLINT                                          AS hour,
      COALESCE(bucketed.total_revenue, 0)::NUMERIC(14,2)   AS total_revenue,
      COALESCE(bucketed.total_orders, 0)::INTEGER          AS total_orders
    FROM generate_series(1, 7) AS wd
    CROSS JOIN generate_series(0, 23) AS h
    LEFT JOIN bucketed
      ON bucketed.weekday = wd
     AND bucketed.hour    = h
    ORDER BY wd, h
  $f$, p_schema) USING p_from, p_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.read_store_hour_weekday(TEXT, DATE, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.read_store_hour_weekday(TEXT, DATE, DATE) IS
  'Sofia-tz hour × ISO-weekday aggregates for the /sales rhythm heatmap. Always returns 168 rows (7 wd × 24 h), zero-filled. Sums across the [p_from, p_to] window.';

-- =====================================================================
-- 2) read_store_sales_by_country — choropleth data
-- =====================================================================

CREATE OR REPLACE FUNCTION public.read_store_sales_by_country(
  p_schema TEXT,
  p_from   DATE,
  p_to     DATE
)
RETURNS TABLE (
  country_code   TEXT,   -- ISO 3166-1 alpha-2, uppercased
  total_revenue  NUMERIC,
  total_orders   INTEGER,
  unique_customers INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
        event_type,
        email,
        raw_payload
      FROM %I.orders
      WHERE (shopify_created_at AT TIME ZONE 'Europe/Sofia')::DATE BETWEEN $1 AND $2
      ORDER BY shopify_order_id, received_at DESC
    ),
    paid_orders AS (
      SELECT
        UPPER(COALESCE(
          raw_payload->'shipping_address'->>'country_code',
          raw_payload->'billing_address'->>'country_code',
          ''
        )) AS country_code,
        total_price_eur,
        email
      FROM latest_orders
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid', 'pending', 'partially_refunded', 'partially_paid', 'authorized')
    )
    SELECT
      NULLIF(country_code, '')                                AS country_code,
      SUM(total_price_eur)::NUMERIC(14,2)                     AS total_revenue,
      COUNT(*)::INTEGER                                       AS total_orders,
      COUNT(DISTINCT NULLIF(email, ''))::INTEGER              AS unique_customers
    FROM paid_orders
    WHERE country_code IS NOT NULL AND country_code <> ''
    GROUP BY country_code
    ORDER BY SUM(total_price_eur) DESC
  $f$, p_schema) USING p_from, p_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.read_store_sales_by_country(TEXT, DATE, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.read_store_sales_by_country(TEXT, DATE, DATE) IS
  'Sales aggregated by shipping country (ISO alpha-2) for the world-map view. One row per country shipped to in the window. Extracts country from raw_payload JSONB — current order volume (~60k/year cross-store) makes the sequential scan sub-second; revisit if volume crosses ~500k/year with a JSON expression index.';
