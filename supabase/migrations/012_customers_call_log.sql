-- Migration 012 — Customers CRM (call center module)
-- Adds two per-store tables: customers (materialized profile, keyed by
-- normalized phone) and call_log (append-only timeline of calls + notes).
-- Also extends member_role enum with 'agent' for call center operators.
--
-- Source of truth: Shopify orders. customers is a write-through cache
-- populated by the order webhook handler + a backfill script.
-- Local-only fields (notes, preferred_call_hour, do_not_call) live on
-- customers; activity log lives on call_log.
--
-- Scope: BG store only for v1. Function update is forward-compatible
-- with future stores.

-- ============================================================
-- 1. Extend member_role enum with 'agent'
-- ============================================================

ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'agent';

-- ============================================================
-- 2. Update create_store_schema to include customers + call_log
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

  -- orders (append-only event log)
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
      subtotal_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_tax NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_discounts NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_refunded NUMERIC(12,2) NOT NULL DEFAULT 0,
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
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_orders_shopify_id_received ON %I.orders (shopify_order_id, received_at DESC)', p_schema);

  -- products
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

  -- webhook_log
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

  -- daily_aggregates
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

  -- ====================================================
  -- NEW in 012: customers (materialized profile, keyed by E.164 phone)
  -- ====================================================
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.customers (
      phone_e164            TEXT PRIMARY KEY,
      phone_raw             TEXT,
      shopify_customer_ids  BIGINT[] NOT NULL DEFAULT ''{}'',
      email                 TEXT,
      first_name            TEXT,
      last_name             TEXT,
      total_orders          INTEGER NOT NULL DEFAULT 0,
      total_spent           NUMERIC(12,2) NOT NULL DEFAULT 0,
      first_order_at        TIMESTAMPTZ,
      last_order_at         TIMESTAMPTZ,
      tags                  TEXT[] NOT NULL DEFAULT ''{}'',
      default_city          TEXT,
      default_address       TEXT,
      country               TEXT,
      -- Local fields (not from Shopify)
      notes                 TEXT,
      preferred_call_hour   TEXT,
      do_not_call           BOOLEAN NOT NULL DEFAULT FALSE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  ', p_schema);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_customers_email ON %I.customers (email)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_customers_last_order ON %I.customers (last_order_at DESC NULLS LAST)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_customers_total_spent ON %I.customers (total_spent DESC)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_customers_shopify_ids ON %I.customers USING GIN (shopify_customer_ids)', p_schema);

  -- updated_at trigger (uses public.update_updated_at from migration 001)
  EXECUTE format('
    DROP TRIGGER IF EXISTS trg_customers_updated_at ON %I.customers;
    CREATE TRIGGER trg_customers_updated_at
      BEFORE UPDATE ON %I.customers
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  ', p_schema, p_schema);

  -- ====================================================
  -- NEW in 012: call_log (append-only timeline of calls + notes)
  -- ====================================================
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.call_log (
      id                   BIGSERIAL PRIMARY KEY,
      customer_phone_e164  TEXT NOT NULL REFERENCES %I.customers(phone_e164) ON DELETE CASCADE,
      agent_user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      kind                 TEXT NOT NULL CHECK (kind IN (''call'', ''note'')),
      outcome              TEXT CHECK (
                             outcome IS NULL OR outcome IN (
                               ''satisfied'', ''unsatisfied'', ''no_answer'',
                               ''declined'', ''wants_repeat'', ''has_question'', ''other''
                             )
                           ),
      body                 TEXT,
      duration_seconds     INTEGER,
      follow_up_at         TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- A note has no outcome; a call should have an outcome.
      CONSTRAINT call_log_outcome_kind CHECK (
        (kind = ''note'' AND outcome IS NULL) OR
        (kind = ''call'' AND outcome IS NOT NULL)
      )
    )
  ', p_schema, p_schema);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_call_log_customer ON %I.call_log (customer_phone_e164, created_at DESC)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_call_log_agent ON %I.call_log (agent_user_id, created_at DESC)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_call_log_follow_up ON %I.call_log (follow_up_at) WHERE follow_up_at IS NOT NULL', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_call_log_kind_outcome ON %I.call_log (kind, outcome)', p_schema);

  -- GRANTS: service_role only (no authenticated direct access — go through API routes)
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO service_role', p_schema);
  EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO service_role', p_schema);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO service_role', p_schema);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO service_role', p_schema);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO service_role', p_schema);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_store_schema(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_schema(TEXT) TO service_role;

-- ============================================================
-- 3. Apply new tables to existing store_bg (idempotent — uses IF NOT EXISTS)
-- ============================================================

SELECT public.create_store_schema('store_bg');
