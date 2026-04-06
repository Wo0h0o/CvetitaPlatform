-- Audit Fixes: Security, performance, and correctness
-- Addresses findings from code audit 2026-04-06

-- ============================================================
-- FIX #1: Revoke authenticated direct access to per-store schemas
-- Only service_role should write; reads go through API routes
-- ============================================================

REVOKE ALL ON ALL TABLES IN SCHEMA store_bg FROM authenticated;
REVOKE USAGE ON SCHEMA store_bg FROM authenticated;

-- Update create_store_schema to NOT grant authenticated access
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

  -- GRANTS: service_role only (no authenticated access)
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO service_role', p_schema);
  EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO service_role', p_schema);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO service_role', p_schema);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO service_role', p_schema);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO service_role', p_schema);
END;
$$;

-- ============================================================
-- FIX #2: Add NOT NULL to existing store_bg nullable columns
-- ============================================================

ALTER TABLE store_bg.orders ALTER COLUMN subtotal_price SET NOT NULL;
ALTER TABLE store_bg.orders ALTER COLUMN subtotal_price SET DEFAULT 0;
ALTER TABLE store_bg.orders ALTER COLUMN total_tax SET NOT NULL;
ALTER TABLE store_bg.orders ALTER COLUMN total_tax SET DEFAULT 0;
ALTER TABLE store_bg.orders ALTER COLUMN total_discounts SET NOT NULL;
ALTER TABLE store_bg.orders ALTER COLUMN total_discounts SET DEFAULT 0;
ALTER TABLE store_bg.orders ALTER COLUMN total_refunded SET NOT NULL;
ALTER TABLE store_bg.orders ALTER COLUMN total_refunded SET DEFAULT 0;

-- ============================================================
-- FIX #3: Restrict SECURITY DEFINER functions to service_role only
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.create_store_schema(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_schema(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refresh_daily_aggregates(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_daily_aggregates(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.register_store_cron(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_store_cron(TEXT) TO service_role;

-- ============================================================
-- FIX #4: Composite index for DISTINCT ON performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_orders_shopify_id_received
  ON store_bg.orders (shopify_order_id, received_at DESC);

-- ============================================================
-- FIX #5: Update aggregate function with COALESCE for JSONB fields
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
        total_price,
        total_refunded,
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
        COALESCE(SUM(total_price), 0)::NUMERIC(12,2) AS total_revenue,
        COUNT(*)::INTEGER AS total_orders,
        CASE
          WHEN COUNT(*) > 0
          THEN (SUM(total_price) / COUNT(*))::NUMERIC(12,2)
          ELSE 0
        END AS avg_order_value,
        COALESCE(SUM(total_refunded), 0)::NUMERIC(12,2) AS total_refunded,
        COUNT(DISTINCT email) FILTER (WHERE email IS NOT NULL AND email != '''')::INTEGER AS unique_customers
      FROM paid_orders
      GROUP BY DATE(shopify_created_at)
    ),
    product_stats AS (
      SELECT
        DATE(o.shopify_created_at) AS order_date,
        COALESCE(item->>''title'', ''Unknown'') AS title,
        SUM(COALESCE((item->>''quantity'')::INTEGER, 0)) AS quantity,
        SUM(COALESCE((item->>''price'')::NUMERIC, 0) * COALESCE((item->>''quantity'')::INTEGER, 0)) AS revenue
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

-- Re-restrict after replacement
REVOKE EXECUTE ON FUNCTION public.refresh_daily_aggregates(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_daily_aggregates(TEXT) TO service_role;

-- ============================================================
-- Refresh aggregates with the fixed function
-- ============================================================

SELECT refresh_daily_aggregates('store_bg');
