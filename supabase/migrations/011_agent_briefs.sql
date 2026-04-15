-- Migration 011 — agent_briefs
-- Purpose: store action cards pre-generated nightly by the portfolio-intel
-- LLM. Consumed by the Owner Home page's ActionRow, mutated by user actions
-- (pause / scale / dismiss / acknowledge).
--
-- Write path:  /api/cron/agent-briefs  (Vercel cron at 04:30 UTC = 07:30 Sofia DST)
-- Read path:   /api/dashboard/home/action-cards
-- Update path: /api/dashboard/action/{pause,scale,dismiss}
--
-- Why shared schema (not per-tenant): the cron fans out across all active
-- integration_accounts in a single run and treats the Meta platform as one
-- surface. Row volume is tiny (≤10 cards/account/day × 5 accounts × 365d ≈
-- 18k rows/year). RLS is by organization_id.

-- ============================================================
-- TABLE
-- ============================================================

CREATE TABLE agent_briefs (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_account_id  UUID        NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,

  -- Sofia-local date this brief is FOR. The cron fires at ~07:30 Sofia, so
  -- for_date is the same day the user will see the card, not "tomorrow".
  for_date                DATE        NOT NULL,

  severity                TEXT        NOT NULL CHECK (severity IN ('red', 'amber', 'green')),
  title                   TEXT        NOT NULL,
  why                     TEXT        NOT NULL,

  -- What the card is pointing at. target_type mirrors Meta's hierarchy.
  target_type             TEXT        NOT NULL CHECK (target_type IN ('ad', 'adset', 'campaign')),
  target_id               TEXT        NOT NULL,                -- native Meta id
  target_name             TEXT,                                -- denormalized for display

  -- Subset of pause / scale / review / dismiss — the buttons the card renders.
  actions                 TEXT[]      NOT NULL,

  status                  TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'actioned', 'dismissed', 'acknowledged')),

  -- Input metrics + LLM trace (stop_reason, tokens used). Pure audit; never
  -- surfaced to the user. Lets us answer "why did Claude flag this row?".
  payload                 JSONB       NOT NULL DEFAULT '{}',

  actioned_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Cron idempotency: re-running the same day's cron must not dupe cards
  -- targeting the same object. Upsert uses ON CONFLICT DO NOTHING against this.
  UNIQUE (integration_account_id, for_date, target_type, target_id)
);

-- ============================================================
-- Indexes
-- ============================================================

-- "Today's pending briefs for this org" — Owner Home query.
CREATE INDEX idx_agent_briefs_today
  ON agent_briefs (organization_id, for_date DESC, status);

-- "All briefs for a given Meta account, recent first" — cron + debug query.
CREATE INDEX idx_agent_briefs_account
  ON agent_briefs (integration_account_id, for_date DESC);

-- ============================================================
-- RLS: visible to any member of the owning account's org
-- ============================================================

ALTER TABLE agent_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view briefs in their orgs"
  ON agent_briefs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM integration_accounts ia
      WHERE ia.id = agent_briefs.integration_account_id
        AND ia.organization_id IN (SELECT user_org_ids())
    )
  );

-- Writes (INSERT / UPDATE / DELETE) go through the service-role key from
-- /api/cron/agent-briefs and /api/dashboard/action/*. RLS blocks
-- authenticated-role writes by default, which is what we want.

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE agent_briefs IS
  'Pre-generated action cards written nightly by /api/cron/agent-briefs. One row per (integration_account, for_date, target). Consumed by /api/dashboard/home/action-cards; mutated by /api/dashboard/action/{pause,scale,dismiss}.';

COMMENT ON COLUMN agent_briefs.for_date IS
  'Sofia-local date the brief is FOR — i.e. the date the user sees it. Cron fires at ~07:30 Sofia, so this is the same day, not tomorrow.';

COMMENT ON COLUMN agent_briefs.target_id IS
  'Native Meta id (ad / adset / campaign). Combined with integration_account_id to route mutations to the right ad account.';

COMMENT ON COLUMN agent_briefs.payload IS
  'Input metrics that triggered the flag + LLM trace (stop_reason, tokens). Audit trail; never surfaced to the user.';
