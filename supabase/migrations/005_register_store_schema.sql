-- Migration 005: Automate PostgREST schema registration
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
--
-- When a new store schema is created (e.g. store_gr), PostgREST must
-- know about it. This function reads the current pgrst.db_schemas setting,
-- appends the new schema if not already present, and triggers a reload.

CREATE OR REPLACE FUNCTION public.register_store_in_postgrest(p_schema TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current TEXT;
  v_new TEXT;
BEGIN
  -- Validate schema name
  IF p_schema !~ '^store_[a-z]{2}([_][a-z0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema;
  END IF;

  -- Get current setting
  SELECT current_setting('pgrst.db_schemas', true) INTO v_current;

  -- Default if empty
  IF v_current IS NULL OR v_current = '' THEN
    v_current := 'public, storage';
  END IF;

  -- Check if already registered (avoid duplicates)
  IF v_current LIKE '%' || p_schema || '%' THEN
    RAISE NOTICE 'Schema % already registered in pgrst.db_schemas', p_schema;
    RETURN;
  END IF;

  -- Append new schema
  v_new := v_current || ', ' || p_schema;

  -- Update role settings
  EXECUTE format('ALTER ROLE authenticator SET pgrst.db_schemas TO %L', v_new);
  EXECUTE format('ALTER ROLE authenticator SET pgrst.db_extra_search_path TO %L', v_new);

  -- Notify PostgREST to reload
  NOTIFY pgrst, 'reload schema';

  RAISE NOTICE 'Registered schema % in PostgREST. New value: %', p_schema, v_new;
END;
$$;

-- Revoke from public (security hardening, consistent with migration 004)
REVOKE EXECUTE ON FUNCTION public.register_store_in_postgrest(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_store_in_postgrest(TEXT) TO service_role;
