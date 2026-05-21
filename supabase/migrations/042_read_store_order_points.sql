-- Migration 042 — public.read_store_order_points
--
-- Powers the hierarchical zoom-driven dot view on /sales/geography
-- (replaces static city-centroid markers for any store whose Shopify
-- webhook delivers shipping_address.latitude / longitude).
--
-- Shape: one row per unique (lat, lng) tuple in the period. БГ orders
-- ship via courier offices (Speedy/Econt pick-up points), so the same
-- office address sees many orders — aggregating by (lat, lng) collapses
-- them into one MapLibre feature with `total_orders` and `total_revenue`
-- summed across the office's pick-ups. At zoom-in, MapLibre's native
-- clustering then visually "splits" Sofia's order mass into its
-- component offices (Triadica / Mladost / Lyulin / etc.) without us
-- having to do any zoom-aware aggregation in the API.
--
-- Why per-office, not per-order:
--   1. Same (lat, lng) for N orders renders as N stacked SVG circles in
--      the browser, which is a perf hazard at scale (БГ has ~2800
--      orders / 30d, ~150 distinct offices — 18× difference).
--   2. The "individual order" detail is meaningless when N customers
--      ship to the same office. The interesting question is "how busy
--      is this office", which is a SUM, not a list.
--   3. PII safety: address1 is the Speedy/Econt office name (already a
--      public address), not the buyer's home. Zero customer leak.
--
-- Skip rules:
--   * Cancelled orders excluded (same gate as 036/037/038/039).
--   * Rows without lat/lng dropped silently (foreign-store schemas with
--     PII-redacted payloads — covered by the city-centroid fallback
--     path in `read_store_sales_by_city`).
--
-- Buyer identity for unique_customers uses the v3 cascade from
-- migration 039 (email → customer.id) so cross-RPC counts stay
-- consistent.

CREATE OR REPLACE FUNCTION public.read_store_order_points(
  p_schema TEXT,
  p_from   DATE,
  p_to     DATE
)
RETURNS TABLE (
  lat              DOUBLE PRECISION,
  lng              DOUBLE PRECISION,
  country_code     TEXT,
  city             TEXT,
  address1         TEXT,
  zip              TEXT,
  total_revenue    NUMERIC,
  total_orders     INTEGER,
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
    paid_with_geo AS (
      SELECT
        (raw_payload->'shipping_address'->>'latitude')::DOUBLE PRECISION  AS lat,
        (raw_payload->'shipping_address'->>'longitude')::DOUBLE PRECISION AS lng,
        UPPER(COALESCE(raw_payload->'shipping_address'->>'country_code', '')) AS country_code,
        raw_payload->'shipping_address'->>'city'      AS city,
        raw_payload->'shipping_address'->>'address1'  AS address1,
        raw_payload->'shipping_address'->>'zip'       AS zip,
        total_price_eur,
        -- Buyer identity cascade (migration 039 v3). For per-office
        -- aggregation we just need DISTINCT counting to be consistent
        -- with country/city RPCs — same cascade, same result.
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
        AND raw_payload->'shipping_address'->>'latitude'  IS NOT NULL
        AND raw_payload->'shipping_address'->>'longitude' IS NOT NULL
    )
    SELECT
      lat,
      lng,
      NULLIF(country_code, '')                                  AS country_code,
      -- All rows sharing a (lat, lng) tuple should share the same
      -- address strings (it's the same Speedy/Econt office). MIN is
      -- safe + deterministic — picks the lexicographically first
      -- variant if Shopify ever delivers slight casing differences.
      MIN(city)                                                  AS city,
      MIN(address1)                                              AS address1,
      MIN(zip)                                                   AS zip,
      SUM(total_price_eur)::NUMERIC(14,2)                        AS total_revenue,
      COUNT(*)::INTEGER                                          AS total_orders,
      COUNT(DISTINCT buyer_identity)::INTEGER                    AS unique_customers
    FROM paid_with_geo
    GROUP BY lat, lng, country_code
    ORDER BY total_revenue DESC
  $f$, p_schema) USING p_from, p_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.read_store_order_points(TEXT, DATE, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.read_store_order_points(TEXT, DATE, DATE) IS
  'Per-office aggregated order points for the world-map hierarchical zoom view. One row per unique (lat, lng) tuple in the period; tooltip-ready address1/city/zip taken from the lexicographically first matching order. Used by /api/sales/geography/order-points; falls back to read_store_sales_by_city on schemas whose payloads lack shipping_address.latitude (foreign stores with PII-redacted webhooks).';
