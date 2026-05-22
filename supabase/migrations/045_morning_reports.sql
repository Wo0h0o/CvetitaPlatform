-- Migration 045 — morning_reports
-- Purpose: persist the AI-generated daily morning report so it is generated
-- ONCE per Sofia day, then read. Before this, every visit to /morning-report
-- re-ran a Claude streaming call (~€0.50-1 each) — a report should be printed
-- once, not re-typeset on every glance.
--
-- Write path: /api/agents/morning-report POST  (upsert after streaming finishes)
-- Read path:  /api/agents/morning-report GET   (cache lookup on page open)
--
-- The route degrades gracefully if this migration has not been applied yet:
-- GET treats a missing table as "no cache", POST logs the persist failure
-- and still streams the report. Apply this and the cost/instant-load win
-- switches on with no code change.

-- ============================================================
-- TABLE
-- ============================================================

CREATE TABLE morning_reports (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Sofia-local date the report is FOR. One report per org per day.
  report_date      DATE        NOT NULL,

  -- The AI-generated markdown narrative.
  content          TEXT        NOT NULL,

  -- Snapshot of the structured business context the report was built from.
  -- Powers the deterministic KPI strip so it renders instantly from cache
  -- without re-touching any upstream API.
  data_snapshot    JSONB       NOT NULL DEFAULT '{}',

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One report per org per Sofia day. POST upserts against this.
  UNIQUE (organization_id, report_date)
);

-- ============================================================
-- Index
-- ============================================================

-- "Today's report for this org" — the only read query.
CREATE INDEX idx_morning_reports_lookup
  ON morning_reports (organization_id, report_date DESC);

-- ============================================================
-- RLS: visible to any member of the owning org
-- ============================================================

ALTER TABLE morning_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view morning reports in their orgs"
  ON morning_reports FOR SELECT
  USING (organization_id IN (SELECT user_org_ids()));

-- Writes (INSERT / UPDATE) go through the service-role key from
-- /api/agents/morning-report. RLS blocks authenticated-role writes by
-- default, which is what we want.

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE morning_reports IS
  'One AI-generated daily business briefing per (organization, Sofia date). Written by /api/agents/morning-report POST after streaming completes; read by the same route''s GET for instant, zero-cost cache loads.';

COMMENT ON COLUMN morning_reports.report_date IS
  'Sofia-local date the report is FOR. Unique per org — a second generation the same day overwrites.';

COMMENT ON COLUMN morning_reports.data_snapshot IS
  'BusinessContext snapshot (Shopify / Meta / GA4 / Klaviyo) the report was built from. Feeds the deterministic KPI strip — never re-derived from the markdown.';
