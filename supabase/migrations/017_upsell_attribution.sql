-- Migration 017 — upsell attribution
-- Lets agents flag a customer for upsell after a phone conversation; the
-- next created order from that customer (within the expiry window) is
-- credited to that agent. Cancellation of the order revokes the credit.
--
-- Storage:
--  - customers.pending_upsell_*  → who's expecting an order, when, until.
--  - order_attributions          → per-shopify_order_id record of the credit
--    (separate from orders because orders is an append-only event log
--    with multiple rows per shopify_order_id).

-- ============================================================
-- 1. Extend customers (pending state)
-- ============================================================

ALTER TABLE store_bg.customers
  ADD COLUMN IF NOT EXISTS pending_upsell_agent_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pending_upsell_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_upsell_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_pending_upsell
  ON store_bg.customers (pending_upsell_expires_at)
  WHERE pending_upsell_agent_id IS NOT NULL;

-- ============================================================
-- 2. order_attributions table
-- ============================================================

CREATE TABLE IF NOT EXISTS store_bg.order_attributions (
  shopify_order_id BIGINT PRIMARY KEY,
  agent_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source           TEXT NOT NULL DEFAULT 'upsell' CHECK (source IN ('upsell', 'manual')),
  attributed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  revoke_reason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_attributions_agent
  ON store_bg.order_attributions (agent_user_id, attributed_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attributions_active
  ON store_bg.order_attributions (attributed_at DESC)
  WHERE revoked_at IS NULL;

-- ============================================================
-- 3. Forward-compat: extend create_store_schema()
-- (keeps future GR/RO stores in sync; uses IF NOT EXISTS so idempotent)
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

  -- orders, products, webhook_log, daily_aggregates, customers, call_log
  -- (definitions unchanged from migration 012; re-run safely via IF NOT EXISTS)
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

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.products (
      id BIGSERIAL PRIMARY KEY, shopify_product_id BIGINT NOT NULL, title TEXT NOT NULL,
      handle TEXT, vendor TEXT, product_type TEXT, status TEXT NOT NULL DEFAULT ''active'',
      tags TEXT[] DEFAULT ''{}''::TEXT[], variants JSONB NOT NULL DEFAULT ''[]'',
      images JSONB NOT NULL DEFAULT ''[]'', shopify_created_at TIMESTAMPTZ,
      shopify_updated_at TIMESTAMPTZ, synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT products_shopify_id_unique UNIQUE (shopify_product_id)
    )
  ', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_products_handle ON %I.products (handle)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_products_status ON %I.products (status)', p_schema);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.webhook_log (
      id BIGSERIAL PRIMARY KEY, webhook_id TEXT NOT NULL, topic TEXT NOT NULL,
      processed BOOLEAN NOT NULL DEFAULT false, error_message TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ,
      CONSTRAINT webhook_log_id_unique UNIQUE (webhook_id)
    )
  ', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_webhook_received ON %I.webhook_log (received_at DESC)', p_schema);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.daily_aggregates (
      id BIGSERIAL PRIMARY KEY, order_date DATE NOT NULL,
      total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0, total_orders INTEGER NOT NULL DEFAULT 0,
      avg_order_value NUMERIC(12,2) NOT NULL DEFAULT 0, total_refunded NUMERIC(12,2) NOT NULL DEFAULT 0,
      unique_customers INTEGER NOT NULL DEFAULT 0, top_products JSONB NOT NULL DEFAULT ''[]'',
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT daily_agg_date_unique UNIQUE (order_date)
    )
  ', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_daily_agg_date ON %I.daily_aggregates (order_date DESC)', p_schema);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.customers (
      phone_e164 TEXT PRIMARY KEY, phone_raw TEXT, shopify_customer_ids BIGINT[] NOT NULL DEFAULT ''{}'',
      email TEXT, first_name TEXT, last_name TEXT, total_orders INTEGER NOT NULL DEFAULT 0,
      total_spent NUMERIC(12,2) NOT NULL DEFAULT 0, first_order_at TIMESTAMPTZ, last_order_at TIMESTAMPTZ,
      tags TEXT[] NOT NULL DEFAULT ''{}'', default_city TEXT, default_address TEXT, country TEXT,
      notes TEXT, preferred_call_hour TEXT, do_not_call BOOLEAN NOT NULL DEFAULT FALSE,
      pending_upsell_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      pending_upsell_at TIMESTAMPTZ, pending_upsell_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  ', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_customers_email ON %I.customers (email)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_customers_last_order ON %I.customers (last_order_at DESC NULLS LAST)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_customers_total_spent ON %I.customers (total_spent DESC)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_customers_shopify_ids ON %I.customers USING GIN (shopify_customer_ids)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_customers_pending_upsell ON %I.customers (pending_upsell_expires_at) WHERE pending_upsell_agent_id IS NOT NULL', p_schema);

  EXECUTE format('
    DROP TRIGGER IF EXISTS trg_customers_updated_at ON %I.customers;
    CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON %I.customers
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  ', p_schema, p_schema);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.call_log (
      id BIGSERIAL PRIMARY KEY,
      customer_phone_e164 TEXT NOT NULL REFERENCES %I.customers(phone_e164) ON DELETE CASCADE,
      agent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN (''call'', ''note'')),
      outcome TEXT CHECK (outcome IS NULL OR outcome IN (''satisfied'',''unsatisfied'',''no_answer'',''declined'',''wants_repeat'',''has_question'',''other'')),
      body TEXT, duration_seconds INTEGER, follow_up_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT call_log_outcome_kind CHECK ((kind=''note'' AND outcome IS NULL) OR (kind=''call'' AND outcome IS NOT NULL))
    )
  ', p_schema, p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_call_log_customer ON %I.call_log (customer_phone_e164, created_at DESC)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_call_log_agent ON %I.call_log (agent_user_id, created_at DESC)', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_call_log_follow_up ON %I.call_log (follow_up_at) WHERE follow_up_at IS NOT NULL', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_call_log_kind_outcome ON %I.call_log (kind, outcome)', p_schema);

  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.order_attributions (
      shopify_order_id BIGINT PRIMARY KEY,
      agent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      source TEXT NOT NULL DEFAULT ''upsell'' CHECK (source IN (''upsell'', ''manual'')),
      attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ, revoke_reason TEXT
    )
  ', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_attributions_agent ON %I.order_attributions (agent_user_id, attributed_at DESC) WHERE revoked_at IS NULL', p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_attributions_active ON %I.order_attributions (attributed_at DESC) WHERE revoked_at IS NULL', p_schema);

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
-- 4. claim_upsell_attribution(p_schema, p_phone, p_shopify_order_id)
-- Atomic: read pending flag → if valid, create attribution + clear flag.
-- Returns the agent_user_id when attributed, NULL otherwise.
-- Idempotent on duplicate webhooks via ON CONFLICT DO NOTHING.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_upsell_attribution(
  p_schema           TEXT,
  p_phone            TEXT,
  p_shopify_order_id BIGINT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_agent  UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;
  IF p_phone IS NULL OR p_phone = '' OR p_shopify_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Lock the customer row, read pending flag.
  EXECUTE format(
    'SELECT pending_upsell_agent_id, pending_upsell_expires_at FROM %I.customers WHERE phone_e164=$1 FOR UPDATE',
    p_schema
  ) USING p_phone INTO v_agent, v_expires;

  IF v_agent IS NULL OR v_expires IS NULL OR v_expires <= now() THEN
    RETURN NULL;
  END IF;

  -- Insert attribution (idempotent on retry).
  EXECUTE format(
    'INSERT INTO %I.order_attributions (shopify_order_id, agent_user_id, source) VALUES ($1, $2, ''upsell'') ON CONFLICT (shopify_order_id) DO NOTHING',
    p_schema
  ) USING p_shopify_order_id, v_agent;

  -- Clear the pending flag.
  EXECUTE format(
    'UPDATE %I.customers SET pending_upsell_agent_id=NULL, pending_upsell_at=NULL, pending_upsell_expires_at=NULL WHERE phone_e164=$1',
    p_schema
  ) USING p_phone;

  RETURN v_agent;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_upsell_attribution(TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_upsell_attribution(TEXT, TEXT, BIGINT) TO service_role;

-- ============================================================
-- 5. revoke_upsell_attribution(p_schema, p_shopify_order_id, p_reason)
-- Marks an attribution as revoked. Idempotent (no-op if already revoked
-- or not attributed).
-- ============================================================

CREATE OR REPLACE FUNCTION public.revoke_upsell_attribution(
  p_schema           TEXT,
  p_shopify_order_id BIGINT,
  p_reason           TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;
  IF p_shopify_order_id IS NULL THEN
    RETURN FALSE;
  END IF;

  EXECUTE format(
    'UPDATE %I.order_attributions SET revoked_at=now(), revoke_reason=$2 WHERE shopify_order_id=$1 AND revoked_at IS NULL',
    p_schema
  ) USING p_shopify_order_id, COALESCE(p_reason, 'cancelled');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_upsell_attribution(TEXT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_upsell_attribution(TEXT, BIGINT, TEXT) TO service_role;

-- ============================================================
-- 6. customer_orders RPC: extend with attribution fields
-- (DROP first because return type changes)
-- ============================================================

DROP FUNCTION IF EXISTS public.customer_orders(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.customer_orders(
  p_schema  TEXT,
  p_phone   TEXT
) RETURNS TABLE (
  shopify_order_id      BIGINT,
  shopify_order_number  TEXT,
  total_price           NUMERIC,
  subtotal_price        NUMERIC,
  total_discounts       NUMERIC,
  total_refunded        NUMERIC,
  currency              TEXT,
  financial_status      TEXT,
  fulfillment_status    TEXT,
  event_type            TEXT,
  line_items            JSONB,
  shopify_created_at    TIMESTAMPTZ,
  shipping_title        TEXT,
  shipping_address      TEXT,
  attributed_agent_id   UUID,
  attribution_source    TEXT,
  attribution_revoked   BOOLEAN
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

  EXECUTE format('SELECT shopify_customer_ids FROM %I.customers WHERE phone_e164 = $1', p_schema)
    USING p_phone INTO v_ids;
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN RETURN; END IF;

  RETURN QUERY EXECUTE format($f$
    SELECT
      latest.shopify_order_id, latest.shopify_order_number,
      latest.total_price, latest.subtotal_price, latest.total_discounts, latest.total_refunded,
      latest.currency, latest.financial_status, latest.fulfillment_status, latest.event_type,
      latest.line_items, latest.shopify_created_at,
      latest.shipping_title, latest.shipping_address,
      a.agent_user_id AS attributed_agent_id,
      a.source        AS attribution_source,
      (a.revoked_at IS NOT NULL) AS attribution_revoked
    FROM (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id, shopify_order_number,
        total_price, subtotal_price, total_discounts, total_refunded,
        currency, financial_status, fulfillment_status, event_type,
        line_items, shopify_created_at, received_at,
        NULLIF(raw_payload->'shipping_lines'->0->>'title', '')   AS shipping_title,
        NULLIF(raw_payload->'shipping_address'->>'address1', '') AS shipping_address
      FROM %I.orders
      WHERE NULLIF(raw_payload->'customer'->>'id','')::BIGINT = ANY($1)
      ORDER BY shopify_order_id, received_at DESC
    ) latest
    LEFT JOIN %I.order_attributions a ON a.shopify_order_id = latest.shopify_order_id
    ORDER BY latest.shopify_created_at DESC
  $f$, p_schema, p_schema)
  USING v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_orders(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_orders(TEXT, TEXT) TO service_role;
