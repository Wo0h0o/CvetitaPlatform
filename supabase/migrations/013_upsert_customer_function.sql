-- Migration 013 — upsert_customer_from_order function
-- Atomic upsert into per-store customers table, called from the order
-- webhook handler and backfill script. Computes totals from the orders
-- table (DISTINCT ON latest event per shopify_order_id, paid statuses)
-- so that re-running on a stale order webhook stays correct.
--
-- Phone normalization is done in TS (libphonenumber-js); this function
-- trusts that p_phone_e164 is already canonical. If p_phone_e164 is NULL,
-- the function is a no-op (we don't track customers without a phone).

CREATE OR REPLACE FUNCTION public.upsert_customer_from_order(
  p_schema       TEXT,
  p_phone_e164   TEXT,
  p_phone_raw    TEXT,
  p_country      TEXT,
  p_payload      JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_customer_id  BIGINT;
  v_ids          BIGINT[];
  v_totals       RECORD;
BEGIN
  -- Validate schema name
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  -- No phone → no customer row
  IF p_phone_e164 IS NULL OR p_phone_e164 = '' THEN
    RETURN;
  END IF;

  v_customer_id := NULLIF(p_payload->'customer'->>'id', '')::BIGINT;
  IF v_customer_id IS NULL THEN
    -- No customer ID (extremely rare guest checkout) → can't aggregate. Skip.
    RETURN;
  END IF;

  -- Get existing IDs for this phone, append the new one
  EXECUTE format(
    'SELECT shopify_customer_ids FROM %I.customers WHERE phone_e164 = $1',
    p_schema
  ) USING p_phone_e164 INTO v_ids;

  IF v_ids IS NULL THEN v_ids := ARRAY[]::BIGINT[]; END IF;
  IF NOT (v_customer_id = ANY(v_ids)) THEN
    v_ids := v_ids || v_customer_id;
  END IF;

  -- Aggregate latest event per order, paid statuses, matching ANY of the
  -- shopify_customer_ids belonging to this phone. Cancelled excluded.
  EXECUTE format($f$
    SELECT
      COUNT(*)::INTEGER                              AS total_orders,
      COALESCE(SUM(total_price), 0)::NUMERIC(12,2)   AS total_spent,
      MIN(shopify_created_at)                        AS first_order_at,
      MAX(shopify_created_at)                        AS last_order_at
    FROM (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id, total_price, shopify_created_at,
        financial_status, event_type, raw_payload
      FROM %I.orders
      WHERE NULLIF(raw_payload->'customer'->>'id','')::BIGINT = ANY($1)
      ORDER BY shopify_order_id, received_at DESC
    ) latest
    WHERE event_type != 'cancelled'
      AND financial_status IN ('paid','pending','partially_paid','authorized','partially_refunded')
  $f$, p_schema)
  USING v_ids INTO v_totals;

  -- Upsert. EXCLUDED columns from INSERT VALUES; existing values via target.
  EXECUTE format($f$
    INSERT INTO %I.customers (
      phone_e164, phone_raw, shopify_customer_ids, email,
      first_name, last_name, total_orders, total_spent,
      first_order_at, last_order_at,
      default_city, default_address, country
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
    )
    ON CONFLICT (phone_e164) DO UPDATE SET
      phone_raw            = COALESCE(EXCLUDED.phone_raw, %I.customers.phone_raw),
      shopify_customer_ids = EXCLUDED.shopify_customer_ids,
      email                = COALESCE(EXCLUDED.email, %I.customers.email),
      first_name           = COALESCE(EXCLUDED.first_name, %I.customers.first_name),
      last_name            = COALESCE(EXCLUDED.last_name, %I.customers.last_name),
      total_orders         = EXCLUDED.total_orders,
      total_spent          = EXCLUDED.total_spent,
      first_order_at       = LEAST(EXCLUDED.first_order_at, %I.customers.first_order_at),
      last_order_at        = GREATEST(EXCLUDED.last_order_at, %I.customers.last_order_at),
      default_city         = COALESCE(EXCLUDED.default_city, %I.customers.default_city),
      default_address      = COALESCE(EXCLUDED.default_address, %I.customers.default_address),
      country              = COALESCE(EXCLUDED.country, %I.customers.country)
  $f$, p_schema, p_schema, p_schema, p_schema, p_schema, p_schema, p_schema, p_schema, p_schema, p_schema)
  USING
    p_phone_e164,
    p_phone_raw,
    v_ids,
    NULLIF(p_payload->'customer'->>'email', ''),
    NULLIF(p_payload->'customer'->>'first_name', ''),
    NULLIF(p_payload->'customer'->>'last_name', ''),
    v_totals.total_orders,
    v_totals.total_spent,
    v_totals.first_order_at,
    v_totals.last_order_at,
    NULLIF(p_payload->'shipping_address'->>'city', ''),
    NULLIF(p_payload->'shipping_address'->>'address1', ''),
    p_country;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_customer_from_order(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_customer_from_order(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
