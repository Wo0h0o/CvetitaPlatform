-- Migration 026 — public.insert_store_order
--
-- Companion to migration 025 (read_store_daily_aggregates). The poll-shopify-
-- orders cron writes new rows via `supabaseAdmin.schema(s).from('orders').
-- insert(...)`. That path is blocked by the same PostgREST schema cache
-- issue: when a new per-store schema (store_de / store_it / store_uk) has
-- just been provisioned, PostgREST may still be running with the previous
-- exposed-schemas snapshot and rejects every write with PGRST106.
--
-- Symptoms before this fix: the cron's cursor (last_orders_poll_at, stored
-- in public.stores.settings) advanced every hour, but the inner INSERT into
-- store_de.orders / store_it.orders / store_uk.orders failed silently and
-- the table stayed empty. New DE/IT/UK orders never appeared on the
-- dashboard until a manual backfill via the Management API.
--
-- Fix: same trick as migration 025 — a SECURITY DEFINER function in `public`
-- (always exposed) that takes the target schema name + a JSONB row, then
-- uses EXECUTE format() to issue the INSERT into the appropriate per-store
-- table. PostgREST never has to know about per-store schemas at all.

CREATE OR REPLACE FUNCTION public.insert_store_order(
  p_schema TEXT,
  p_row    JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  -- Same shape validator as create_store_schema().
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %. Expected format: store_xx or store_xx_suffix', p_schema;
  END IF;

  EXECUTE format(
    'INSERT INTO %I.orders (
       shopify_order_id, shopify_order_number, webhook_event_id, event_type,
       email, financial_status, fulfillment_status, currency,
       total_price, subtotal_price, total_tax, total_discounts, total_refunded,
       line_items, raw_payload,
       shopify_created_at, shopify_updated_at, exchange_rate_to_eur
     ) VALUES (
       ($1->>''shopify_order_id'')::BIGINT,
       $1->>''shopify_order_number'',
       $1->>''webhook_event_id'',
       $1->>''event_type'',
       $1->>''email'',
       COALESCE($1->>''financial_status'', ''pending''),
       $1->>''fulfillment_status'',
       COALESCE($1->>''currency'', ''EUR''),
       COALESCE(($1->>''total_price'')::NUMERIC, 0),
       COALESCE(($1->>''subtotal_price'')::NUMERIC, 0),
       COALESCE(($1->>''total_tax'')::NUMERIC, 0),
       COALESCE(($1->>''total_discounts'')::NUMERIC, 0),
       COALESCE(($1->>''total_refunded'')::NUMERIC, 0),
       COALESCE($1->''line_items'', ''[]''::jsonb),
       $1->''raw_payload'',
       ($1->>''shopify_created_at'')::TIMESTAMPTZ,
       ($1->>''shopify_updated_at'')::TIMESTAMPTZ,
       COALESCE(($1->>''exchange_rate_to_eur'')::NUMERIC, 1.0)
     )
     ON CONFLICT (webhook_event_id) DO NOTHING
     RETURNING id',
    p_schema
  ) INTO v_id USING p_row;

  -- Returns NULL on conflict (duplicate). Caller distinguishes
  -- inserted vs skipped by checking IS NOT NULL.
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_store_order(TEXT, JSONB)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.insert_store_order(TEXT, JSONB) IS
  'Cross-schema write for per-store orders. Bypasses the PostgREST schema cache. Returns the new id on insert, NULL on duplicate (UNIQUE webhook_event_id).';
