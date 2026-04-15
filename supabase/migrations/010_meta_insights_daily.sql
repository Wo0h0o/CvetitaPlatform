-- Migration 010 — meta_insights_daily
-- Purpose: shared, cross-account materialized table of daily Meta Ads insights.
-- Written by /api/cron/meta-sync (nightly fan-out across all integration_accounts
-- with service = 'meta_ads'). Read by the Owner Home page small-multiples, the
-- compare_stores view, and the portfolio-intel agent.
--
-- Why in public (shared), not in per-tenant schemas:
--   Ads insights must blend across stores for the Owner Home and portfolio
--   queries. Keeping them in per-tenant schemas would fight cross-store JOINs.
--   Row volume is modest (6 accounts × ~50 campaigns × 365d × ~3 levels ≈ 330k
--   rows/year) — tiny compared to orders/products.

-- ============================================================
-- TABLE: meta_insights_daily
-- ============================================================

CREATE TABLE meta_insights_daily (
  integration_account_id UUID NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  date                   DATE NOT NULL,
  level                  TEXT NOT NULL,                          -- 'account' | 'campaign' | 'adset' | 'ad'
  object_id              TEXT NOT NULL,                          -- campaign_id / adset_id / ad_id / 'account' sentinel
  object_name            TEXT,                                   -- denormalized for fast reads; re-synced from dimension tables
  parent_campaign_id     TEXT,                                   -- for adset + ad rows
  parent_adset_id        TEXT,                                   -- for ad rows

  spend                  NUMERIC(14,4) NOT NULL DEFAULT 0,
  impressions            BIGINT        NOT NULL DEFAULT 0,
  clicks                 BIGINT        NOT NULL DEFAULT 0,
  link_clicks            BIGINT        NOT NULL DEFAULT 0,
  reach                  BIGINT        NOT NULL DEFAULT 0,
  frequency              NUMERIC(10,4) NOT NULL DEFAULT 0,

  purchases              NUMERIC(14,4) NOT NULL DEFAULT 0,       -- count of omni_purchase actions
  revenue                NUMERIC(14,4) NOT NULL DEFAULT 0,       -- omni_purchase action_value (native currency)
  add_to_cart            NUMERIC(14,4) NOT NULL DEFAULT 0,
  initiate_checkout      NUMERIC(14,4) NOT NULL DEFAULT 0,
  landing_page_views     NUMERIC(14,4) NOT NULL DEFAULT 0,

  actions                JSONB        NOT NULL DEFAULT '{}',     -- full actions array for rare types (lead, subscribe, etc.)
  currency               TEXT         NOT NULL,                  -- from integration_accounts.currency
  fetched_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),

  PRIMARY KEY (integration_account_id, date, level, object_id)
);

-- ============================================================
-- Indexes for common read patterns
-- ============================================================

-- "last N days for account X"
CREATE INDEX idx_meta_insights_account_date
  ON meta_insights_daily (integration_account_id, date DESC);

-- "all accounts on a given date" (cross-store aggregate)
CREATE INDEX idx_meta_insights_date
  ON meta_insights_daily (date DESC, integration_account_id);

-- "campaign-level rows only" — for breakdowns
CREATE INDEX idx_meta_insights_level
  ON meta_insights_daily (integration_account_id, level, date DESC);

-- "all data for a specific campaign across dates"
CREATE INDEX idx_meta_insights_object
  ON meta_insights_daily (object_id)
  WHERE level IN ('campaign', 'adset', 'ad');

-- ============================================================
-- RLS: visible to any member of the owning integration account's org
-- ============================================================

ALTER TABLE meta_insights_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view insights in their orgs"
  ON meta_insights_daily FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM integration_accounts ia
      WHERE ia.id = meta_insights_daily.integration_account_id
        AND ia.organization_id IN (SELECT user_org_ids())
    )
  );

-- Only service_role writes (the cron, a server-only path)
-- Authenticated users cannot INSERT/UPDATE/DELETE — RLS blocks by default.

COMMENT ON TABLE meta_insights_daily IS
  'Daily-aggregated Meta Ads insights per account, across all levels (account/campaign/adset/ad). Populated by /api/cron/meta-sync nightly.';
COMMENT ON COLUMN meta_insights_daily.object_id IS
  'For level=account, use the integration_account_id as string sentinel; otherwise the native Meta id.';
COMMENT ON COLUMN meta_insights_daily.currency IS
  'Native currency at the time of the row. Never convert at write-time — conversion happens in views via fx_rates_daily (future).';

-- ============================================================
-- VIEW: meta_insights_by_store
-- Blends rows per-store by joining through active bindings.
-- Aggregates across legacy + primary accounts for the same store-day when
-- both have data. Excludes orphan accounts (store_id IS NULL) — those are
-- queryable directly from meta_insights_daily.
-- ============================================================

CREATE OR REPLACE VIEW meta_insights_by_store AS
SELECT
  s.id                       AS store_id,
  s.name                     AS store_name,
  s.market_code              AS market_code,
  mid.date                   AS date,
  mid.level                  AS level,
  mid.object_id              AS object_id,
  mid.object_name            AS object_name,
  SUM(mid.spend)             AS spend,
  SUM(mid.impressions)       AS impressions,
  SUM(mid.clicks)            AS clicks,
  SUM(mid.link_clicks)       AS link_clicks,
  SUM(mid.reach)             AS reach,
  SUM(mid.purchases)         AS purchases,
  SUM(mid.revenue)           AS revenue,
  SUM(mid.add_to_cart)       AS add_to_cart,
  SUM(mid.initiate_checkout) AS initiate_checkout,
  SUM(mid.landing_page_views) AS landing_page_views,
  -- Blended frequency is weighted by impressions, not a simple SUM
  CASE WHEN SUM(mid.impressions) > 0
       THEN SUM(mid.reach * mid.frequency) / NULLIF(SUM(mid.reach), 0)
       ELSE 0
  END AS frequency,
  -- Currency: assume homogeneous per store for v1 (all EUR). If a store ever
  -- mixes currencies across bindings, we'll add FX conversion here.
  MAX(mid.currency)          AS currency,
  MAX(mid.fetched_at)        AS fetched_at
FROM meta_insights_daily mid
JOIN store_integration_bindings sib
  ON sib.integration_account_id = mid.integration_account_id
  AND sib.store_id IS NOT NULL
  AND (sib.active_from  IS NULL OR sib.active_from  <= mid.date)
  AND (sib.active_until IS NULL OR sib.active_until >= mid.date)
JOIN stores s ON s.id = sib.store_id
GROUP BY s.id, s.name, s.market_code, mid.date, mid.level, mid.object_id, mid.object_name;

COMMENT ON VIEW meta_insights_by_store IS
  'Per-store blended daily Meta insights. Aggregates across all active bindings for each store-day. Excludes orphan accounts like ProteinBar (query meta_insights_daily directly for those).';
