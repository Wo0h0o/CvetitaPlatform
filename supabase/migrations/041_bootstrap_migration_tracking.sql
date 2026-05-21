-- Migration 041 — bootstrap `supabase_migrations.schema_migrations`
--
-- Cvetita has shipped 40 migrations without a tracking table — every
-- migration was applied ad-hoc (psql, Supabase SQL Editor, lately the
-- Management API). The result: no way to answer "is migration N
-- applied?" without re-reading every CREATE/ALTER and grepping
-- pg_proc/pg_class. Audit on 2026-05-21 caught migration 038 living in
-- the repo for two days without ever reaching the prod DB, with zero
-- automated signal. That class of drift is what this migration closes.
--
-- Approach: stand up the same `supabase_migrations.schema_migrations`
-- table that the Supabase CLI uses, then back-fill rows for every
-- existing migration file. We deliberately leave `statements` NULL
-- (Cvetita doesn't drive applies through `supabase db push` — the CLI
-- would otherwise try to re-apply on `version` mismatch with empty
-- local statements). The table is therefore a **registry of what's
-- applied**, not a full history snapshot.
--
-- Going forward, registration is **tool-enforced**, not convention-
-- enforced: `scripts/apply-migration.mjs` inserts (version, name)
-- automatically after every successful apply, parsing the values from
-- the filename. Migration files themselves no longer need to
-- self-register, which keeps them focused on schema changes and
-- removes a class of "forgot the INSERT" failure mode.
--
-- Drift detection: `scripts/audit-migrations.mjs` diffs filenames in
-- `supabase/migrations/` against rows in this table and flags anything
-- on disk that hasn't been applied (or any registry row whose file is
-- missing).

CREATE SCHEMA IF NOT EXISTS supabase_migrations;

-- Matches the Supabase CLI's expected shape so we stay forward-compatible
-- if the team ever does adopt `supabase db push`. version is the
-- canonical key; name is freeform; statements stays NULL for back-filled
-- rows.
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version    TEXT PRIMARY KEY,
  statements TEXT[],
  name       TEXT,
  created_by TEXT,
  idempotency_key UUID DEFAULT gen_random_uuid()
);

COMMENT ON TABLE supabase_migrations.schema_migrations IS
  'Registry of applied schema migrations. Back-filled by migration 041 (2026-05-21). Each new migration must self-register via INSERT … ON CONFLICT DO NOTHING in its final block.';

-- Back-fill: every migration file present in supabase/migrations/ at
-- the time of migration 041. Names mirror the filename minus the version
-- prefix and the .sql suffix — easy to grep when auditing.
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('001', 'foundation_tables'),
  ('002', 'store_schema'),
  ('003', 'materialized_views'),
  ('004', 'audit_fixes'),
  ('005', 'register_store_schema'),
  ('006', 'competitor_monitoring'),
  ('007', 'price_history_and_alerts'),
  ('008', 'integration_accounts'),
  ('009', 'store_integration_bindings'),
  ('010', 'meta_insights_daily'),
  ('011', 'agent_briefs'),
  ('012', 'customers_call_log'),
  ('013', 'upsert_customer_function'),
  ('014', 'customer_list_function'),
  ('015', 'customer_orders_function'),
  ('016', 'customer_orders_shipping'),
  ('017', 'upsell_attribution'),
  ('018', 'agent_upsell_stats'),
  ('019', 'customer_list_date_range'),
  ('020', 'top_products_for_period'),
  ('021', 'period_unique_customers'),
  ('022', 'exchange_rates_eur_normalization'),
  ('023', 'competitor_product_map_and_slug'),
  ('024', 'competitor_seed_urls'),
  ('025', 'read_store_daily_aggregates'),
  ('026', 'insert_store_order_rpc'),
  ('027', 'agent_inbox_extensions'),
  ('028', 'ad_destinations_and_products'),
  ('029', 'sofia_tz_bucketing'),
  ('030', 'hr_module'),
  ('031', 'hr_holidays'),
  ('032', 'hr_leave_end_date'),
  ('033', 'meta_insights_hourly'),
  ('034', 'read_store_hourly_aggregates'),
  ('035', 'read_store_hourly_aggregates_multi'),
  ('036', 'hour_weekday_and_country'),
  ('037', 'read_store_sales_by_city'),
  ('038', 'sales_geography_email_fallback'),
  ('039', 'sales_geography_customer_id_fallback'),
  ('040', 'drop_dead_read_store_hourly_aggregates'),
  ('041', 'bootstrap_migration_tracking')
ON CONFLICT (version) DO NOTHING;
