-- Per-Store Schema Provisioning
-- Creates a complete store schema with orders, products, webhook_log, daily_aggregates.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- ============================================================
-- FUNCTION: create_store_schema
-- Called during store onboarding to provision per-store tables.
-- Example: SELECT create_store_schema('store_bg');
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_store_schema(p_schema TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate schema name: must be store_{2-letter code} or store_{code}_{suffix}
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %. Expected format: store_xx or store_xx_suffix', p_schema;
  END IF;

  -- Create the schema
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', p_schema);

  -- --------------------------------------------------------
  -- TABLE: orders (append-only event log from webhooks + backfill)
  -- --------------------------------------------------------
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

  -- --------------------------------------------------------
  -- TABLE: products (latest state, upserted on webhook/sync)
  -- --------------------------------------------------------
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

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_products_handle ON %I.products (handle)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_products_status ON %I.products (status)', p_schema);

  -- --------------------------------------------------------
  -- TABLE: webhook_log (deduplication + audit trail)
  -- --------------------------------------------------------
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.webhook_log (
      id BIGSERIAL PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      processed BOOLEAN NOT NULL DEFAULT false,
      error_message TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at TIMESTAMPTZ,

      CONSTRAINT webhook_log_id_unique UNIQUE (webhook_id)
    )
  ', p_schema);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_webhook_received ON %I.webhook_log (received_at DESC)', p_schema);

  -- --------------------------------------------------------
  -- TABLE: daily_aggregates (computed rollup, refreshed by pg_cron)
  -- --------------------------------------------------------
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.daily_aggregates (
      id BIGSERIAL PRIMARY KEY,
      order_date DATE NOT NULL,
      total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_orders INTEGER NOT NULL DEFAULT 0,
      avg_order_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_refunded NUMERIC(12,2) NOT NULL DEFAULT 0,
      unique_customers INTEGER NOT NULL DEFAULT 0,
      top_products JSONB NOT NULL DEFAULT ''[]'',
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT daily_agg_date_unique UNIQUE (order_date)
    )
  ', p_schema);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_daily_agg_date ON %I.daily_aggregates (order_date DESC)', p_schema);

  -- --------------------------------------------------------
  -- GRANTS: allow service_role and authenticated to access
  -- --------------------------------------------------------
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO service_role, authenticated', p_schema);
  EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO service_role', p_schema);
  EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO authenticated', p_schema);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO service_role', p_schema);

  -- Set default privileges for future tables in this schema
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO service_role', p_schema);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO authenticated', p_schema);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO service_role', p_schema);

END;
$$;
