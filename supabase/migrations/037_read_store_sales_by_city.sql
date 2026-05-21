-- Migration 037 — public.read_store_sales_by_city
--
-- City-level aggregation for the world-map pulsing dots overlay
-- (/sales/geography Phase C). Same DISTINCT ON + paid_orders gate as the
-- country reader (migration 036); same on-the-fly JSONB extraction with
-- billing fallback when shipping_address is missing.
--
-- We return (country_code, city) tuples — disambiguates same-name cities
-- across countries (Plovdiv exists in many languages; we keep it
-- canonical to its country). City strings come out raw — uppercased and
-- whitespace-trimmed but NOT transliterated. The client owns the lookup
-- against an alias table so the matching layer stays in TypeScript where
-- it's easy to extend.

CREATE OR REPLACE FUNCTION public.read_store_sales_by_city(
  p_schema TEXT,
  p_from   DATE,
  p_to     DATE
)
RETURNS TABLE (
  country_code   TEXT,
  city           TEXT,
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
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
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
        TRIM(COALESCE(
          raw_payload->'shipping_address'->>'city',
          raw_payload->'billing_address'->>'city',
          ''
        )) AS city,
        total_price_eur,
        email
      FROM latest_orders
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid', 'pending', 'partially_refunded', 'partially_paid', 'authorized')
    )
    SELECT
      NULLIF(country_code, '')                                AS country_code,
      NULLIF(city, '')                                        AS city,
      SUM(total_price_eur)::NUMERIC(14,2)                     AS total_revenue,
      COUNT(*)::INTEGER                                       AS total_orders,
      COUNT(DISTINCT NULLIF(email, ''))::INTEGER              AS unique_customers
    FROM paid_orders
    WHERE country_code <> '' AND city <> ''
    GROUP BY country_code, city
    ORDER BY SUM(total_price_eur) DESC
  $f$, p_schema) USING p_from, p_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.read_store_sales_by_city(TEXT, DATE, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.read_store_sales_by_city(TEXT, DATE, DATE) IS
  'City-level sales aggregation for the world-map pulsing dots overlay. Returns one row per (country, city) tuple; alias resolution + lat/lng lookup is done client-side against src/lib/geo/cities.ts.';
