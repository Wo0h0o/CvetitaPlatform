-- Migration 018 — agent_upsell_stats aggregation function
-- For each non-revoked order_attributions row in the window, picks the
-- latest event-row for that shopify_order_id (orders is append-only) and
-- groups by agent. Excludes revoked attributions; revenue uses the most
-- recent total_price (so partial refunds reflected in updated events
-- show up).

CREATE OR REPLACE FUNCTION public.agent_upsell_stats(
  p_schema TEXT,
  p_since  TIMESTAMPTZ
) RETURNS TABLE (
  agent_user_id  UUID,
  upsells        INT,
  upsell_revenue NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  RETURN QUERY EXECUTE format($f$
    SELECT
      a.agent_user_id,
      COUNT(*)::INT                                 AS upsells,
      COALESCE(SUM(o.total_price), 0)::NUMERIC      AS upsell_revenue
    FROM %I.order_attributions a
    JOIN LATERAL (
      SELECT total_price
      FROM %I.orders
      WHERE shopify_order_id = a.shopify_order_id
      ORDER BY received_at DESC
      LIMIT 1
    ) o ON TRUE
    WHERE a.revoked_at IS NULL
      AND a.attributed_at >= $1
      AND a.agent_user_id IS NOT NULL
    GROUP BY a.agent_user_id
  $f$, p_schema, p_schema)
  USING p_since;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_upsell_stats(TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_upsell_stats(TEXT, TIMESTAMPTZ) TO service_role;
