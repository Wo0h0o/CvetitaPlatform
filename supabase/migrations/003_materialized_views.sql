-- Materialized Views: Daily Aggregates Refresh Function + pg_cron Registration
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Prerequisite: pg_cron extension enabled in Dashboard → Database → Extensions

-- ============================================================
-- FUNCTION: refresh_daily_aggregates
-- Computes daily revenue, orders, AOV, refunds, and top products
-- from the append-only orders log. Uses DISTINCT ON to get the
-- latest state of each order (since webhooks append multiple events).
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_daily_aggregates(p_schema TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate schema name
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  -- Upsert daily aggregates from the orders append log.
  -- Step 1: Get the latest state of each unique order (DISTINCT ON).
  -- Step 2: Group by date and compute aggregates.
  -- Step 3: ON CONFLICT upsert for idempotent refresh.
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
        COUNT(DISTINCT email) FILTER (WHERE email IS NOT NULL)::INTEGER AS unique_customers
      FROM paid_orders
      GROUP BY DATE(shopify_created_at)
    ),
    -- Top 5 products per day by revenue
    product_stats AS (
      SELECT
        DATE(o.shopify_created_at) AS order_date,
        item->>''title'' AS title,
        SUM((item->>''quantity'')::INTEGER) AS quantity,
        SUM((item->>''price'')::NUMERIC * (item->>''quantity'')::INTEGER) AS revenue
      FROM paid_orders o,
        jsonb_array_elements(o.line_items) AS item
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

-- ============================================================
-- FUNCTION: register_store_cron
-- Registers a pg_cron job to refresh aggregates every 15 minutes.
-- Call once during store onboarding.
-- Example: SELECT register_store_cron('store_bg');
-- ============================================================

CREATE OR REPLACE FUNCTION public.register_store_cron(p_schema TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_name TEXT;
BEGIN
  -- Validate schema name
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  v_job_name := 'refresh_agg_' || p_schema;

  -- Unschedule existing job if present (idempotent)
  BEGIN
    PERFORM cron.unschedule(v_job_name);
  EXCEPTION WHEN OTHERS THEN
    -- Job doesn't exist yet, that's fine
    NULL;
  END;

  -- Schedule new job every 15 minutes
  PERFORM cron.schedule(
    v_job_name,
    '*/15 * * * *',
    format('SELECT public.refresh_daily_aggregates(%L)', p_schema)
  );

  RETURN v_job_name;
END;
$$;
