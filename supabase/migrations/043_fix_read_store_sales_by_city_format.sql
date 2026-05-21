-- Migration 043 — fix format() escape bug in read_store_sales_by_city
--
-- Migration 039 introduced this line as a SQL comment inside the
-- format() body:
--
--   -- way or "I lost 30% of clients when I clicked the country" is
--
-- PostgreSQL's `format()` parses `%` as a format directive **regardless
-- of whether it sits inside an SQL comment** — it has no idea what SQL
-- comments are; the format string is opaque to it. The result:
--
--   ERROR: 22023: unrecognized format() type specifier " "
--   HINT: For a single "%" use "%%".
--   CONTEXT: PL/pgSQL function read_store_sales_by_city ... line 7
--
-- Every call to read_store_sales_by_city since 039 was deployed (two
-- migrations ago) has been hard-erroring. The /sales/geography world
-- map silently lost all foreign-store city markers because the
-- /cities API call returned `[]` (the route catches RPC errors and
-- logs them server-side; the client just sees an empty array).
--
-- Caught by manual inspection — first request to load foreign-store
-- city centroids hit the bug. Smoke-test pass added to
-- scripts/audit-migrations.mjs in the same commit so this class of
-- silent runtime breakage gets caught at audit time, not by an
-- operator squinting at the map.
--
-- The fix is the smallest possible change: rewrite the comment to
-- avoid the literal `%` (could also escape as `%%`, but rewriting is
-- clearer and the comment loses nothing).

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
        -- Identical buyer-identity cascade to the country reader (v3).
        -- Keeping the two RPCs in lockstep ensures drill-down from
        -- country to city does not drop customers between the two
        -- views.
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
  'City-level sales aggregation for the world-map view. v3.1 (migration 043): fixes a format() escape bug introduced by 039 where a literal % inside a SQL comment in the EXECUTE body was parsed as a directive. Same buyer-identity cascade as read_store_sales_by_country v3.';
