-- Migration 033 — meta_insights_hourly
-- Purpose: account-level hourly Meta Ads insights for the home dashboard's
-- intraday tempo chart ("Днес" preset → 0-24h cumulative curve).
--
-- Why a separate table (not a `breakdown` column on meta_insights_daily):
--   * Different write cadence — populated every 15 min vs daily 3-day backfill.
--   * Different sync depth — account level only; we do NOT slice campaigns by
--     hour (BUC budget, not needed for home dashboard).
--   * Different retention — only last 14 days kept; older hourly data is not
--     useful and the daily table already holds the long-tail history.
--
-- Why account level only:
--   The home tempo chart visualises portfolio-wide spend pacing. Per-campaign
--   hourly breakdown would 8x the BUC cost per account (≈50 campaigns × 24 h
--   per sync). When/if a per-campaign hourly view is needed, extend this table
--   with `level/object_id` exactly like meta_insights_daily — the PK already
--   carries them.
--
-- Timezone:
--   We use Meta's `hourly_stats_aggregated_by_advertiser_time_zone` breakdown.
--   All 6 cvetita accounts are set to Europe/Sofia on Meta side, so the `hour`
--   column directly matches Sofia wall-clock — same axis Shopify orders are
--   bucketed against. See feedback_sofia_tz_bucketing.md for the principle.

-- ============================================================
-- TABLE: meta_insights_hourly
-- ============================================================

CREATE TABLE meta_insights_hourly (
  integration_account_id UUID NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  date                   DATE NOT NULL,
  hour                   SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  level                  TEXT NOT NULL DEFAULT 'account',
  object_id              TEXT NOT NULL,    -- 'act_...' sentinel at account level

  spend                  NUMERIC(14,4) NOT NULL DEFAULT 0,
  impressions            BIGINT        NOT NULL DEFAULT 0,
  clicks                 BIGINT        NOT NULL DEFAULT 0,
  link_clicks            BIGINT        NOT NULL DEFAULT 0,

  purchases              NUMERIC(14,4) NOT NULL DEFAULT 0,
  revenue                NUMERIC(14,4) NOT NULL DEFAULT 0,

  currency               TEXT         NOT NULL,
  fetched_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),

  PRIMARY KEY (integration_account_id, date, hour, level, object_id)
);

-- ============================================================
-- Indexes
-- ============================================================

-- "last N days hourly for account X" — primary read pattern from top-strip
CREATE INDEX idx_meta_insights_hourly_account_date
  ON meta_insights_hourly (integration_account_id, date DESC, hour);

-- "all accounts on a given date" — cross-store hourly aggregate for the
-- portfolio home tempo
CREATE INDEX idx_meta_insights_hourly_date
  ON meta_insights_hourly (date DESC, hour, integration_account_id);

-- ============================================================
-- RLS — mirrors meta_insights_daily policy
-- ============================================================

ALTER TABLE meta_insights_hourly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view hourly insights in their orgs"
  ON meta_insights_hourly FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM integration_accounts ia
      WHERE ia.id = meta_insights_hourly.integration_account_id
        AND ia.organization_id IN (SELECT user_org_ids())
    )
  );

-- Only service_role writes — RLS blocks INSERT/UPDATE/DELETE for authenticated.

-- ============================================================
-- VIEW: meta_insights_hourly_by_store
-- Blends rows per-store by joining through active bindings. Mirrors the
-- meta_insights_by_store pattern so the top-strip route can SUM across
-- stores for the same date+hour bucket.
-- ============================================================

CREATE OR REPLACE VIEW meta_insights_hourly_by_store AS
SELECT
  s.id                       AS store_id,
  s.market_code              AS market_code,
  mih.date                   AS date,
  mih.hour                   AS hour,
  SUM(mih.spend)             AS spend,
  SUM(mih.impressions)       AS impressions,
  SUM(mih.clicks)            AS clicks,
  SUM(mih.link_clicks)       AS link_clicks,
  SUM(mih.purchases)         AS purchases,
  SUM(mih.revenue)           AS revenue,
  MAX(mih.currency)          AS currency,
  MAX(mih.fetched_at)        AS fetched_at
FROM meta_insights_hourly mih
JOIN store_integration_bindings sib
  ON sib.integration_account_id = mih.integration_account_id
  AND sib.store_id IS NOT NULL
  AND (sib.active_from  IS NULL OR sib.active_from  <= mih.date)
  AND (sib.active_until IS NULL OR sib.active_until >= mih.date)
JOIN stores s ON s.id = sib.store_id
WHERE mih.level = 'account'
GROUP BY s.id, s.market_code, mih.date, mih.hour;

COMMENT ON TABLE meta_insights_hourly IS
  'Account-level hourly Meta Ads insights (Sofia tz). Populated by /api/cron/meta-sync-hourly every 15 min for today + yesterday. Retention: 14 days (older rows pruned by the cron).';
COMMENT ON COLUMN meta_insights_hourly.hour IS
  '0-23, Sofia wall-clock. Sourced from breakdowns=hourly_stats_aggregated_by_advertiser_time_zone (all accounts set to Europe/Sofia on Meta).';
COMMENT ON VIEW meta_insights_hourly_by_store IS
  'Per-store hourly Meta insights. Used by the home dashboard tempo chart in "Днес" preset to overlay current-hour spend against the matched-hour typical baseline.';
