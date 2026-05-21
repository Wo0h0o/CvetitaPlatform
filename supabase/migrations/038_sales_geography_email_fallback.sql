-- Migration 038 — email JSONB fallback for sales-by-country / sales-by-city
--
-- Bug surfaced on /sales/geography (2026-05-21): non-БГ countries showed
-- correct revenue + orders but `unique_customers = 0`. Root cause: the
-- RPCs in migrations 036 + 037 use the `email` column from %schema.orders
-- directly. For a non-trivial subset of orders — especially international
-- ones placed without a logged-in Shopify customer (guest checkout) — the
-- `email` column is NULL even though the order JSON carries the buyer's
-- address in `raw_payload.customer.email`, `raw_payload.email`, or
-- `raw_payload.contact_email`.
--
-- The fix is **not** country-scoped: every market — БГ included — was
-- being undercounted. Sofia's "1570 клиенти" line previously hid the
-- omission because БГ has the bulk volume and most БГ orders go through
-- accounts (email column populated). Applying the fallback chain to all
-- rows surfaces the true distinct-buyer count everywhere.
--
-- Fallback order (most specific → fuzziest):
--   1. orders.email                                  — the canonical column
--   2. raw_payload->'customer'->>'email'             — guest checkout customer
--   3. raw_payload->>'email'                         — Shopify order-level
--   4. raw_payload->>'contact_email'                 — fallback contact field
--
-- This matches the pattern migration 013 already uses for the
-- per-schema upsert_customer function — keeping the email-source policy
-- consistent across the schema.

-- =====================================================================
-- 1) read_store_sales_by_country — replace migration 036 version
-- =====================================================================

CREATE OR REPLACE FUNCTION public.read_store_sales_by_country(
  p_schema TEXT,
  p_from   DATE,
  p_to     DATE
)
RETURNS TABLE (
  country_code   TEXT,
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
        -- Resolved buyer identity. Lower-cased to dedupe Shopify's mixed
        -- casing across guest vs account orders ("Foo@x" vs "foo@x").
        LOWER(NULLIF(TRIM(COALESCE(
          email,
          raw_payload->'customer'->>'email',
          raw_payload->>'email',
          raw_payload->>'contact_email'
        )), '')) AS buyer_email
      FROM latest_orders
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid', 'pending', 'partially_refunded', 'partially_paid', 'authorized')
    )
    SELECT
      NULLIF(country_code, '')                                AS country_code,
      SUM(total_price_eur)::NUMERIC(14,2)                     AS total_revenue,
      COUNT(*)::INTEGER                                       AS total_orders,
      COUNT(DISTINCT buyer_email)::INTEGER                    AS unique_customers
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
  'Sales aggregated by shipping country (ISO alpha-2) for the world-map view. v2 (migration 038): email is resolved via a four-step fallback chain (orders.email → raw_payload.customer.email → raw_payload.email → raw_payload.contact_email) and lower-cased before DISTINCT so guest-checkout buyers stop being undercounted.';

-- =====================================================================
-- 2) read_store_sales_by_city — replace migration 037 version
-- =====================================================================

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
        -- Same fallback chain as the country reader so the two views
        -- count buyers identically; "drill down from country to city
        -- and lose 30% of customers" would be a worse bug than the one
        -- we just fixed.
        LOWER(NULLIF(TRIM(COALESCE(
          email,
          raw_payload->'customer'->>'email',
          raw_payload->>'email',
          raw_payload->>'contact_email'
        )), '')) AS buyer_email
      FROM latest_orders
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid', 'pending', 'partially_refunded', 'partially_paid', 'authorized')
    )
    SELECT
      NULLIF(country_code, '')                                AS country_code,
      NULLIF(city, '')                                        AS city,
      SUM(total_price_eur)::NUMERIC(14,2)                     AS total_revenue,
      COUNT(*)::INTEGER                                       AS total_orders,
      COUNT(DISTINCT buyer_email)::INTEGER                    AS unique_customers
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
  'City-level sales aggregation for the world-map pulsing dots overlay. v2 (migration 038): same email fallback chain as read_store_sales_by_country, so country-level and city-level unique-customer counts stay consistent under guest-checkout traffic.';
