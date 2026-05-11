-- Migration 025 — public.read_store_daily_aggregates
--
-- Why: Supabase's PostgREST instance caches the list of exposed schemas and
-- doesn't always reload promptly after new per-store schemas are added
-- (`store_de`, `store_it`, `store_uk`). When the cache is stale, every
-- `supabaseAdmin.schema('store_de').from('daily_aggregates').select(...)`
-- call from the Next.js app returns PGRST106 "Invalid schema" and the
-- dashboard renders empty cards for the affected markets — even though
-- the data is sitting healthy in the underlying table.
--
-- Fix: wrap the cross-schema read in a SECURITY DEFINER function in `public`,
-- which PostgREST always exposes. The function uses `EXECUTE format()` (same
-- pattern as the existing `refresh_daily_aggregates`) so it works for any
-- per-store schema added via `create_store_schema(...)` — present or future.
-- Callers switch from `.schema(s).from('daily_aggregates')` to
-- `.rpc('read_store_daily_aggregates', { p_schema, p_dates })`.
--
-- Side benefit: this is a defence-in-depth pattern. Adding a 7th, 8th, …
-- market in the future never depends on the PostgREST schema cache reloading
-- on time; the read path is purely public-RPC-based.

CREATE OR REPLACE FUNCTION public.read_store_daily_aggregates(
  p_schema TEXT,
  p_dates  DATE[]
)
RETURNS TABLE (
  order_date        DATE,
  total_revenue     NUMERIC,
  total_orders      INTEGER,
  unique_customers  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Same shape validator as create_store_schema() — refuse anything that
  -- doesn't look like a per-store schema name.
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %. Expected format: store_xx or store_xx_suffix', p_schema;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT order_date, total_revenue, total_orders, unique_customers
     FROM %I.daily_aggregates
     WHERE order_date = ANY($1)',
    p_schema
  ) USING p_dates;
END;
$$;

GRANT EXECUTE ON FUNCTION public.read_store_daily_aggregates(TEXT, DATE[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.read_store_daily_aggregates(TEXT, DATE[]) IS
  'Cross-schema read for per-store daily_aggregates. Bypasses the PostgREST schema cache by living in public. Pass p_schema = store_<code>, p_dates = ARRAY of ISO dates.';
