-- Migration 040 — drop dead RPC public.read_store_hourly_aggregates(TEXT, DATE)
--
-- The single-date variant was introduced in migration 034 to read 24
-- hourly buckets for one day. Migration 035 added the multi-date
-- `read_store_hourly_aggregates_multi(TEXT, DATE[])`, which is what the
-- app actually calls (currently from `/api/dashboard/home/top-strip`,
-- line 232). The single-date version has zero callers in the codebase
-- (grep `'"read_store_hourly_aggregates"'` excluding `_multi` → empty)
-- and was never re-introduced after the API switched to the multi form.
--
-- We keep `_multi` intact; this migration only drops the dead single-day
-- overload to remove an attack-surface footprint (any function exposed
-- under PostgREST is callable by `authenticated`, even if no Cvetita
-- code path uses it).
--
-- Reversible: re-running migration 034 restores it bit-for-bit.

DROP FUNCTION IF EXISTS public.read_store_hourly_aggregates(TEXT, DATE);
