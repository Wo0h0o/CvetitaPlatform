-- Migration 039 — customer.id fallback for sales-by-country / sales-by-city
--
-- Migration 038 fixed the obvious "guest checkout had no email column"
-- case by chaining four email sources (orders.email →
-- raw_payload.customer.email → raw_payload.email →
-- raw_payload.contact_email). Smoke-testing v2 surfaced a deeper
-- finding: foreign-store payloads (store_gr, store_it, store_ro,
-- store_de, store_uk, ...) are **PII-redacted at intake** — Shopify
-- delivers webhooks for these stores without the buyer's email in the
-- payload, full stop. The customer object still carries `verified_email:
-- true` and a numeric `customer.id`, but the actual address string is
-- stripped before the order ever lands in our raw_payload column.
--
-- This is almost certainly the webhook scope: store_bg has
-- `read_customers` so emails arrive; the foreign stores were registered
-- with `read_orders` only, so the JSON arrives email-less.
--
-- The unique-customer count for those schemas was therefore stuck at 0
-- not because of a code bug but because the source data has no email to
-- count. v3 closes the gap by adding `customer.id` as a fifth fallback —
-- Shopify's customer.id is shop-unique and persistent across orders, so
-- counting DISTINCT customer.id reliably reflects unique buyers even
-- when emails are absent.
--
-- The `'cust:'` prefix on the id-based identity prevents an extremely
-- unlikely collision with email-like strings that happen to start with
-- digits (e.g. `123@x.com`) — keeps the DISTINCT set partitioned by
-- identity source.
--
-- Why not switch all schemas to id-based counting?
--   * orders.email is the canonical buyer identity when present. Two
--     accounts with different Shopify ids can share an email (an org
--     bought twice through different staff members); we want to count
--     that as ONE customer.
--   * customer.id is per-shop; the same person ordering across multiple
--     shops would be counted as N customers. Email collapses them.
--
-- The cascade therefore prefers email when available, falls back to
-- customer.id only when email is missing. Net effect:
--   * store_bg: same numbers as v2 (emails populated, id fallback never
--     triggers).
--   * store_gr/it/ro/de/uk/hu/sk: jumps from 0 to actual buyer count.

-- =====================================================================
-- 1) read_store_sales_by_country — v3
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
        -- Buyer identity cascade. Email-based identity wins when
        -- present (collapses cross-store buyers); customer.id-based
        -- identity is the fallback for PII-redacted foreign-store
        -- payloads. The 'cust:' prefix keeps the two identity spaces
        -- partitioned in the DISTINCT set.
        COALESCE(
          LOWER(NULLIF(TRIM(COALESCE(
            email,
            raw_payload->'customer'->>'email',
            raw_payload->>'email',
            raw_payload->>'contact_email'
          )), '')),
          NULLIF('cust:' || (raw_payload->'customer'->>'id'), 'cust:')
        ) AS buyer_identity
      FROM latest_orders
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid', 'pending', 'partially_refunded', 'partially_paid', 'authorized')
    )
    SELECT
      NULLIF(country_code, '')                                AS country_code,
      SUM(total_price_eur)::NUMERIC(14,2)                     AS total_revenue,
      COUNT(*)::INTEGER                                       AS total_orders,
      COUNT(DISTINCT buyer_identity)::INTEGER                 AS unique_customers
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
  'Sales aggregated by shipping country (ISO alpha-2) for the world-map view. v3 (migration 039): buyer identity cascade now falls back to raw_payload.customer.id when all email sources are NULL — fixes the "0 unique_customers" on foreign-store schemas whose webhooks deliver PII-redacted payloads (store_gr, store_it, store_ro, store_de, store_uk, store_hu, store_sk).';

-- =====================================================================
-- 2) read_store_sales_by_city — v3
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
        -- Identical buyer-identity cascade to the country reader (v3) —
        -- drill-down from country to city must count buyers the same
        -- way or "I lost 30% of clients when I clicked the country" is
        -- the next reported bug.
        COALESCE(
          LOWER(NULLIF(TRIM(COALESCE(
            email,
            raw_payload->'customer'->>'email',
            raw_payload->>'email',
            raw_payload->>'contact_email'
          )), '')),
          NULLIF('cust:' || (raw_payload->'customer'->>'id'), 'cust:')
        ) AS buyer_identity
      FROM latest_orders
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid', 'pending', 'partially_refunded', 'partially_paid', 'authorized')
    )
    SELECT
      NULLIF(country_code, '')                                AS country_code,
      NULLIF(city, '')                                        AS city,
      SUM(total_price_eur)::NUMERIC(14,2)                     AS total_revenue,
      COUNT(*)::INTEGER                                       AS total_orders,
      COUNT(DISTINCT buyer_identity)::INTEGER                 AS unique_customers
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
  'City-level sales aggregation for the world-map pulsing dots overlay. v3 (migration 039): same buyer-identity cascade as read_store_sales_by_country v3 — falls back to raw_payload.customer.id when emails are PII-redacted, so country and city customer counts stay consistent on foreign-store schemas.';
