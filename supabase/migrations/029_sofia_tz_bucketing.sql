-- Migration 029 — bucket order dates in Europe/Sofia, not server UTC
--
-- Problem: refresh_daily_aggregates / top_products_for_period /
-- period_unique_customers all used DATE(shopify_created_at) or
-- shopify_created_at::date, which evaluate in the Postgres session
-- timezone (UTC on Supabase). The dashboard front-end (sofia-date.ts)
-- anchors "today" to Europe/Sofia, so orders made between 00:00–03:00
-- Sofia time (21:00–00:00 UTC the previous day) fell into yesterday's
-- bucket — the customer list showed them as "today" while the
-- dashboard KPI tiles did not.
--
-- Fix: convert shopify_created_at into Europe/Sofia before extracting
-- the date in all three functions. Signatures unchanged; callers and
-- grants stay as-is.
--
-- After applying this migration, run
--   SELECT public.refresh_daily_aggregates('store_<market>');
-- for every active store so daily_aggregates is rebuilt with the
-- corrected bucketing.

-- ============================================================
-- 1. refresh_daily_aggregates — bucket by Sofia tz
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
        (shopify_created_at AT TIME ZONE ''Europe/Sofia'')::DATE AS order_date,
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
      GROUP BY (shopify_created_at AT TIME ZONE ''Europe/Sofia'')::DATE
    ),
    product_stats AS (
      SELECT
        (o.shopify_created_at AT TIME ZONE ''Europe/Sofia'')::DATE AS order_date,
        COALESCE(item->>''title'', ''Unknown'') AS title,
        SUM(COALESCE((item->>''quantity'')::INTEGER, 0)) AS quantity,
        SUM(
          COALESCE((item->>''price'')::NUMERIC, 0)
          * COALESCE((item->>''quantity'')::INTEGER, 0)
          / NULLIF(o.exchange_rate_to_eur, 0)
        ) AS revenue
      FROM paid_orders o,
        jsonb_array_elements(COALESCE(o.line_items, ''[]''::JSONB)) AS item
      GROUP BY (o.shopify_created_at AT TIME ZONE ''Europe/Sofia'')::DATE, item->>''title''
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
-- 2. top_products_for_period — filter by Sofia-day
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
      WHERE (shopify_created_at AT TIME ZONE 'Europe/Sofia')::DATE BETWEEN $1 AND $2
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
-- 3. period_unique_customers — filter by Sofia-day
-- ============================================================

CREATE OR REPLACE FUNCTION public.period_unique_customers(
  p_schema TEXT,
  p_from   DATE,
  p_to     DATE
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  EXECUTE format($f$
    WITH latest AS (
      SELECT DISTINCT ON (shopify_order_id)
        shopify_order_id, email, financial_status, event_type
      FROM %I.orders
      WHERE (shopify_created_at AT TIME ZONE 'Europe/Sofia')::DATE BETWEEN $1 AND $2
      ORDER BY shopify_order_id, received_at DESC
    )
    SELECT COUNT(DISTINCT email)::INTEGER
    FROM latest
    WHERE email IS NOT NULL
      AND event_type != 'cancelled'
      AND financial_status IN ('paid','pending','partially_refunded','partially_paid','authorized')
  $f$, p_schema)
  INTO v_count
  USING p_from, p_to;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.period_unique_customers(TEXT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.period_unique_customers(TEXT, DATE, DATE) TO service_role;
