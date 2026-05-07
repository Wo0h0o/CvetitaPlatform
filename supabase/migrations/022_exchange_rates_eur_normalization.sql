-- Migration 022 — Exchange-rate normalization to EUR
--
-- Problem: store_ro.orders stores total_price/subtotal/etc in RON (shop
-- currency), but every dashboard widget hard-codes "EUR". The Sales view
-- showed RO orders ~5x inflated (e.g. 273.34 RON labelled €273.34).
--
-- Fix: snapshot the EUR exchange rate at order ingest time and expose
-- *_eur generated columns. All aggregators and the customer cache then
-- read the *_eur columns; raw shop-currency values are preserved for
-- transparency (tooltip in UI, audit trail).
--
-- Source of rates: ECB daily reference rates (free, no auth). Cached in
-- public.exchange_rates and refreshed daily by cron.
--
-- Order of operations in this migration:
--   1. Create public.exchange_rates table.
--   2. Patch create_store_schema() so future stores get the columns from
--      the start.
--   3. ALTER existing store_bg/store_gr/store_ro.orders:
--        - add exchange_rate_to_eur (NOT NULL DEFAULT 1.0 → BG/GR safe;
--          RO will be UPDATEd by the backfill script before use)
--        - add 5 STORED generated EUR columns
--   4. Patch upsert_customer_from_order to use total_price_eur.
--   5. Patch refresh_daily_aggregates to compute revenue from *_eur
--      and from line-item prices divided by exchange_rate_to_eur.
--   6. Patch top_products_for_period to convert line items.
--   7. Patch customer_orders to expose total_price_eur.
--
-- Step 8 (data backfill of RO rates) is performed by
-- scripts/backfill-exchange-rates.mjs, NOT inside this migration —
-- the migration file shouldn't make outbound HTTP calls to ECB.

-- ============================================================
-- 1. public.exchange_rates — daily ECB-sourced cache
-- ============================================================

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  rate_date     DATE        NOT NULL,
  currency      TEXT        NOT NULL,        -- ISO 4217 (RON, USD, GBP, …)
  rate_to_eur   NUMERIC(14,8) NOT NULL,      -- units of `currency` per 1 EUR
  source        TEXT        NOT NULL DEFAULT 'ecb',
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_date, currency),
  CONSTRAINT exchange_rates_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT exchange_rates_rate_chk    CHECK (rate_to_eur > 0)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency_date
  ON public.exchange_rates (currency, rate_date DESC);

COMMENT ON TABLE public.exchange_rates IS
  'Daily reference exchange rates (ECB). rate_to_eur = how many units of currency = 1 EUR. EUR itself stored as 1.0.';

-- EUR identity row, valid for all dates (we look it up via currency='EUR'
-- regardless of date, but having an explicit anchor is cheap insurance).
INSERT INTO public.exchange_rates (rate_date, currency, rate_to_eur, source)
VALUES ('1999-01-01', 'EUR', 1.0, 'identity')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Patch create_store_schema() so future stores include the columns
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_store_schema(p_schema TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %. Expected format: store_xx or store_xx_suffix', p_schema;
  END IF;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', p_schema);

  -- orders table — now includes exchange_rate_to_eur + generated EUR columns
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.orders (
      id BIGSERIAL PRIMARY KEY,
      shopify_order_id BIGINT NOT NULL,
      shopify_order_number TEXT,
      webhook_event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      email TEXT,
      financial_status TEXT NOT NULL,
      fulfillment_status TEXT,
      currency TEXT NOT NULL DEFAULT ''EUR'',
      total_price NUMERIC(12,2) NOT NULL,
      subtotal_price NUMERIC(12,2) DEFAULT 0,
      total_tax NUMERIC(12,2) DEFAULT 0,
      total_discounts NUMERIC(12,2) DEFAULT 0,
      total_refunded NUMERIC(12,2) DEFAULT 0,
      exchange_rate_to_eur NUMERIC(14,8) NOT NULL DEFAULT 1.0,
      total_price_eur     NUMERIC(14,4) GENERATED ALWAYS AS (total_price          / exchange_rate_to_eur) STORED,
      subtotal_price_eur  NUMERIC(14,4) GENERATED ALWAYS AS (COALESCE(subtotal_price,  0) / exchange_rate_to_eur) STORED,
      total_tax_eur       NUMERIC(14,4) GENERATED ALWAYS AS (COALESCE(total_tax,       0) / exchange_rate_to_eur) STORED,
      total_discounts_eur NUMERIC(14,4) GENERATED ALWAYS AS (COALESCE(total_discounts, 0) / exchange_rate_to_eur) STORED,
      total_refunded_eur  NUMERIC(14,4) GENERATED ALWAYS AS (COALESCE(total_refunded,  0) / exchange_rate_to_eur) STORED,
      line_items JSONB NOT NULL DEFAULT ''[]'',
      raw_payload JSONB,
      shopify_created_at TIMESTAMPTZ NOT NULL,
      shopify_updated_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orders_event_unique UNIQUE (webhook_event_id)
    )
  ', p_schema);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_orders_shopify_id ON %I.orders (shopify_order_id)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_orders_created_at ON %I.orders (shopify_created_at DESC)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_orders_received_at ON %I.orders (received_at DESC)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_orders_financial ON %I.orders (financial_status)', p_schema);

  -- products + webhook_log + daily_aggregates: unchanged, but we recreate
  -- them here in case create_store_schema is called for a fresh store.
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.products (
      id BIGSERIAL PRIMARY KEY,
      shopify_product_id BIGINT NOT NULL,
      title TEXT NOT NULL,
      handle TEXT,
      vendor TEXT,
      product_type TEXT,
      status TEXT NOT NULL DEFAULT ''active'',
      tags TEXT[] DEFAULT ''{}''::TEXT[],
      variants JSONB NOT NULL DEFAULT ''[]'',
      images JSONB NOT NULL DEFAULT ''[]'',
      shopify_created_at TIMESTAMPTZ,
      shopify_updated_at TIMESTAMPTZ,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT products_shopify_id_unique UNIQUE (shopify_product_id)
    )
  ', p_schema);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.webhook_log (
      id BIGSERIAL PRIMARY KEY,
      webhook_event_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT ''received'',
      error TEXT,
      payload_snapshot JSONB,
      CONSTRAINT webhook_log_event_unique UNIQUE (webhook_event_id)
    )
  ', p_schema);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.daily_aggregates (
      order_date DATE PRIMARY KEY,
      total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_orders INTEGER NOT NULL DEFAULT 0,
      avg_order_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_refunded NUMERIC(12,2) NOT NULL DEFAULT 0,
      unique_customers INTEGER NOT NULL DEFAULT 0,
      top_products JSONB NOT NULL DEFAULT ''[]''::JSONB,
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  ', p_schema);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_store_schema(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_schema(TEXT) TO service_role;

-- ============================================================
-- 3. ALTER existing orders tables (BG, GR, RO)
-- ============================================================
-- The exchange_rate_to_eur column defaults to 1.0. For BG and GR (both EUR
-- shops) this is permanently correct. For RO it's a placeholder; the
-- backfill script (scripts/backfill-exchange-rates.mjs) will UPDATE each
-- row with the historical ECB rate, which automatically refreshes the
-- generated columns.

DO $migration$
DECLARE
  v_schema TEXT;
BEGIN
  FOREACH v_schema IN ARRAY ARRAY['store_bg', 'store_gr', 'store_ro'] LOOP
    -- Skip if schema doesn't exist (e.g. fresh dev DB)
    IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = v_schema) THEN
      RAISE NOTICE 'Schema % does not exist, skipping', v_schema;
      CONTINUE;
    END IF;

    -- exchange_rate_to_eur (additive, idempotent)
    EXECUTE format('
      ALTER TABLE %I.orders
        ADD COLUMN IF NOT EXISTS exchange_rate_to_eur NUMERIC(14,8) NOT NULL DEFAULT 1.0
    ', v_schema);

    -- Generated EUR columns. Wrapped in DO blocks because IF NOT EXISTS
    -- isn't supported for generated columns in older PG versions.
    BEGIN
      EXECUTE format('
        ALTER TABLE %I.orders
          ADD COLUMN total_price_eur NUMERIC(14,4)
            GENERATED ALWAYS AS (total_price / exchange_rate_to_eur) STORED
      ', v_schema);
    EXCEPTION WHEN duplicate_column THEN NULL; END;

    BEGIN
      EXECUTE format('
        ALTER TABLE %I.orders
          ADD COLUMN subtotal_price_eur NUMERIC(14,4)
            GENERATED ALWAYS AS (COALESCE(subtotal_price, 0) / exchange_rate_to_eur) STORED
      ', v_schema);
    EXCEPTION WHEN duplicate_column THEN NULL; END;

    BEGIN
      EXECUTE format('
        ALTER TABLE %I.orders
          ADD COLUMN total_tax_eur NUMERIC(14,4)
            GENERATED ALWAYS AS (COALESCE(total_tax, 0) / exchange_rate_to_eur) STORED
      ', v_schema);
    EXCEPTION WHEN duplicate_column THEN NULL; END;

    BEGIN
      EXECUTE format('
        ALTER TABLE %I.orders
          ADD COLUMN total_discounts_eur NUMERIC(14,4)
            GENERATED ALWAYS AS (COALESCE(total_discounts, 0) / exchange_rate_to_eur) STORED
      ', v_schema);
    EXCEPTION WHEN duplicate_column THEN NULL; END;

    BEGIN
      EXECUTE format('
        ALTER TABLE %I.orders
          ADD COLUMN total_refunded_eur NUMERIC(14,4)
            GENERATED ALWAYS AS (COALESCE(total_refunded, 0) / exchange_rate_to_eur) STORED
      ', v_schema);
    EXCEPTION WHEN duplicate_column THEN NULL; END;

    RAISE NOTICE 'Patched %.orders with EUR columns', v_schema;
  END LOOP;
END;
$migration$;

-- ============================================================
-- 4. Patch upsert_customer_from_order — use total_price_eur for total_spent
-- ============================================================

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
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  IF p_phone_e164 IS NULL OR p_phone_e164 = '' THEN
    RETURN;
  END IF;

  v_customer_id := NULLIF(p_payload->'customer'->>'id', '')::BIGINT;
  IF v_customer_id IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'SELECT shopify_customer_ids FROM %I.customers WHERE phone_e164 = $1',
    p_schema
  ) USING p_phone_e164 INTO v_ids;

  IF v_ids IS NULL THEN v_ids := ARRAY[]::BIGINT[]; END IF;
  IF NOT (v_customer_id = ANY(v_ids)) THEN
    v_ids := v_ids || v_customer_id;
  END IF;

  EXECUTE format($f$
    SELECT
      COUNT(*)::INTEGER                                  AS total_orders,
      COALESCE(SUM(total_price_eur), 0)::NUMERIC(12,2)   AS total_spent,
      MIN(shopify_created_at)                            AS first_order_at,
      MAX(shopify_created_at)                            AS last_order_at
    FROM (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id, total_price_eur, shopify_created_at,
        financial_status, event_type, raw_payload
      FROM %I.orders
      WHERE NULLIF(raw_payload->'customer'->>'id','')::BIGINT = ANY($1)
      ORDER BY shopify_order_id, received_at DESC
    ) latest
    WHERE event_type != 'cancelled'
      AND financial_status IN ('paid','pending','partially_paid','authorized','partially_refunded')
  $f$, p_schema)
  USING v_ids INTO v_totals;

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

-- ============================================================
-- 5. Patch refresh_daily_aggregates — sums in EUR (line items divided
--    by per-order exchange_rate_to_eur)
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_daily_aggregates(p_schema TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  EXECUTE format('
    WITH latest_orders AS (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id,
        shopify_created_at,
        total_price_eur,
        total_refunded_eur,
        exchange_rate_to_eur,
        financial_status,
        event_type,
        email,
        line_items
      FROM %I.orders
      ORDER BY shopify_order_id, received_at DESC
    ),
    paid_orders AS (
      SELECT *
      FROM latest_orders
      WHERE event_type != ''cancelled''
        AND financial_status IN (''paid'', ''pending'', ''partially_refunded'', ''partially_paid'', ''authorized'')
    ),
    daily AS (
      SELECT
        DATE(shopify_created_at) AS order_date,
        COALESCE(SUM(total_price_eur), 0)::NUMERIC(12,2) AS total_revenue,
        COUNT(*)::INTEGER AS total_orders,
        CASE
          WHEN COUNT(*) > 0
          THEN (SUM(total_price_eur) / COUNT(*))::NUMERIC(12,2)
          ELSE 0
        END AS avg_order_value,
        COALESCE(SUM(total_refunded_eur), 0)::NUMERIC(12,2) AS total_refunded,
        COUNT(DISTINCT email) FILTER (WHERE email IS NOT NULL AND email != '''')::INTEGER AS unique_customers
      FROM paid_orders
      GROUP BY DATE(shopify_created_at)
    ),
    product_stats AS (
      SELECT
        DATE(o.shopify_created_at) AS order_date,
        COALESCE(item->>''title'', ''Unknown'') AS title,
        SUM(COALESCE((item->>''quantity'')::INTEGER, 0)) AS quantity,
        SUM(
          COALESCE((item->>''price'')::NUMERIC, 0)
          * COALESCE((item->>''quantity'')::INTEGER, 0)
          / NULLIF(o.exchange_rate_to_eur, 0)
        ) AS revenue
      FROM paid_orders o,
        jsonb_array_elements(COALESCE(o.line_items, ''[]''::JSONB)) AS item
      GROUP BY DATE(o.shopify_created_at), item->>''title''
    ),
    top_products AS (
      SELECT
        order_date,
        jsonb_agg(
          jsonb_build_object(''title'', title, ''quantity'', quantity, ''revenue'', revenue)
          ORDER BY revenue DESC
        ) FILTER (WHERE rn <= 5) AS top_products
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY order_date ORDER BY revenue DESC) AS rn
        FROM product_stats
      ) ranked
      GROUP BY order_date
    )
    INSERT INTO %I.daily_aggregates (
      order_date, total_revenue, total_orders, avg_order_value,
      total_refunded, unique_customers, top_products, refreshed_at
    )
    SELECT
      d.order_date,
      d.total_revenue,
      d.total_orders,
      d.avg_order_value,
      d.total_refunded,
      d.unique_customers,
      COALESCE(tp.top_products, ''[]''::JSONB),
      now()
    FROM daily d
    LEFT JOIN top_products tp ON tp.order_date = d.order_date
    ON CONFLICT (order_date) DO UPDATE SET
      total_revenue = EXCLUDED.total_revenue,
      total_orders = EXCLUDED.total_orders,
      avg_order_value = EXCLUDED.avg_order_value,
      total_refunded = EXCLUDED.total_refunded,
      unique_customers = EXCLUDED.unique_customers,
      top_products = EXCLUDED.top_products,
      refreshed_at = EXCLUDED.refreshed_at
  ', p_schema, p_schema);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_daily_aggregates(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_daily_aggregates(TEXT) TO service_role;

-- ============================================================
-- 6. Patch top_products_for_period — convert line items to EUR
-- ============================================================

CREATE OR REPLACE FUNCTION public.top_products_for_period(
  p_schema TEXT,
  p_from   DATE,
  p_to     DATE,
  p_limit  INT DEFAULT 50
) RETURNS TABLE (
  title    TEXT,
  quantity BIGINT,
  revenue  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  RETURN QUERY EXECUTE format($f$
    WITH latest AS (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id, line_items, exchange_rate_to_eur,
        financial_status, event_type
      FROM %I.orders
      WHERE shopify_created_at::date BETWEEN $1 AND $2
      ORDER BY shopify_order_id, received_at DESC
    ),
    paid AS (
      SELECT line_items, exchange_rate_to_eur FROM latest
      WHERE event_type != 'cancelled'
        AND financial_status IN ('paid','pending','partially_refunded','partially_paid','authorized')
    )
    SELECT
      (li->>'title')::TEXT AS title,
      SUM((li->>'quantity')::INT)::BIGINT AS quantity,
      SUM(
        (li->>'price')::NUMERIC
        * (li->>'quantity')::INT
        / NULLIF(p.exchange_rate_to_eur, 0)
      )::NUMERIC(14,2) AS revenue
    FROM paid p, jsonb_array_elements(line_items) li
    WHERE li->>'title' IS NOT NULL
    GROUP BY li->>'title'
    ORDER BY 3 DESC NULLS LAST
    LIMIT $3
  $f$, p_schema)
  USING p_from, p_to, p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.top_products_for_period(TEXT, DATE, DATE, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.top_products_for_period(TEXT, DATE, DATE, INT) TO service_role;

-- ============================================================
-- 7. Patch customer_orders — expose total_price_eur (and others) so the
--    customer profile timeline shows EUR. Keep raw columns too for the
--    "original currency" tooltip the UI will render for RON orders.
-- ============================================================

DROP FUNCTION IF EXISTS public.customer_orders(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.customer_orders(
  p_schema  TEXT,
  p_phone   TEXT
) RETURNS TABLE (
  shopify_order_id      BIGINT,
  shopify_order_number  TEXT,
  total_price           NUMERIC,
  total_price_eur       NUMERIC,
  subtotal_price        NUMERIC,
  subtotal_price_eur    NUMERIC,
  total_discounts       NUMERIC,
  total_discounts_eur   NUMERIC,
  total_refunded        NUMERIC,
  total_refunded_eur    NUMERIC,
  exchange_rate_to_eur  NUMERIC,
  currency              TEXT,
  financial_status      TEXT,
  fulfillment_status    TEXT,
  event_type            TEXT,
  line_items            JSONB,
  shopify_created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ids BIGINT[];
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  IF p_phone IS NULL OR p_phone !~ '^\+\d{8,15}$' THEN
    RAISE EXCEPTION 'Invalid phone format: %', p_phone;
  END IF;

  EXECUTE format(
    'SELECT shopify_customer_ids FROM %I.customers WHERE phone_e164 = $1',
    p_schema
  ) USING p_phone INTO v_ids;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format($f$
    SELECT
      shopify_order_id,
      shopify_order_number,
      total_price,
      total_price_eur,
      subtotal_price,
      subtotal_price_eur,
      total_discounts,
      total_discounts_eur,
      total_refunded,
      total_refunded_eur,
      exchange_rate_to_eur,
      currency,
      financial_status,
      fulfillment_status,
      event_type,
      line_items,
      shopify_created_at
    FROM (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id,
        shopify_order_number,
        total_price,
        total_price_eur,
        subtotal_price,
        subtotal_price_eur,
        total_discounts,
        total_discounts_eur,
        total_refunded,
        total_refunded_eur,
        exchange_rate_to_eur,
        currency,
        financial_status,
        fulfillment_status,
        event_type,
        line_items,
        shopify_created_at,
        received_at
      FROM %I.orders
      WHERE NULLIF(raw_payload->'customer'->>'id','')::BIGINT = ANY($1)
      ORDER BY shopify_order_id, received_at DESC
    ) latest
    ORDER BY shopify_created_at DESC
  $f$, p_schema)
  USING v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_orders(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_orders(TEXT, TEXT) TO service_role;
