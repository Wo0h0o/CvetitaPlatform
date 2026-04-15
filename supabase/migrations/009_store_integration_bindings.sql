-- Migration 009 — store_integration_bindings
-- Purpose: many-to-many between business `stores` and `integration_accounts`.
-- Handles three topologies:
--   1. Normal (1:1)   — BG store → primary Meta account
--   2. Legacy (N:1)   — BG store → [primary Meta, legacy Meta] (both historical, one current)
--   3. Orphan (null:1) — ProteinBar Meta account with no Shopify store (store_id = NULL)
--
-- `role` distinguishes: primary (default read), secondary (blended read), legacy (history only).
-- `weight` is reserved for future split-attribution reporting.

-- ============================================================
-- TABLE: store_integration_bindings
-- ============================================================

CREATE TABLE store_integration_bindings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id               UUID REFERENCES stores(id) ON DELETE CASCADE, -- nullable: orphan accounts (ProteinBar)
  integration_account_id UUID NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  role                   TEXT NOT NULL DEFAULT 'primary',  -- 'primary' | 'secondary' | 'legacy'
  weight                 NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  active_from            DATE,
  active_until           DATE,  -- lets old BG account decay gracefully
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT store_integration_bindings_role_check
    CHECK (role IN ('primary', 'secondary', 'legacy'))
);

CREATE TRIGGER trg_store_integration_bindings_updated_at
  BEFORE UPDATE ON store_integration_bindings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Uniqueness: partial indexes because store_id is nullable.
-- Postgres treats NULLs as distinct in normal UNIQUE, which would allow
-- duplicate orphan bindings for the same integration_account_id. Split into
-- two partial indexes to get the right semantics for both cases.
-- ============================================================

-- For store-backed bindings: one binding per (store, account, role)
CREATE UNIQUE INDEX idx_sib_unique_store_role
  ON store_integration_bindings (store_id, integration_account_id, role)
  WHERE store_id IS NOT NULL;

-- For orphan bindings: one binding per (account, role) — can't bind ProteinBar twice
CREATE UNIQUE INDEX idx_sib_unique_orphan_role
  ON store_integration_bindings (integration_account_id, role)
  WHERE store_id IS NULL;

-- Frequent lookup paths
CREATE INDEX idx_sib_store ON store_integration_bindings (store_id) WHERE store_id IS NOT NULL;
CREATE INDEX idx_sib_account ON store_integration_bindings (integration_account_id);

-- ============================================================
-- RLS: bindings are visible to any org member who can see the store
-- OR (for orphan bindings) to admins of the owning org via the account.
-- ============================================================

ALTER TABLE store_integration_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view bindings in their orgs"
  ON store_integration_bindings FOR SELECT
  USING (
    -- Store-backed: org membership via the store
    (store_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM stores s
      WHERE s.id = store_integration_bindings.store_id
        AND s.organization_id IN (SELECT user_org_ids())
    ))
    OR
    -- Orphan: admin of the account's org
    (store_id IS NULL AND EXISTS (
      SELECT 1 FROM integration_accounts ia
      WHERE ia.id = store_integration_bindings.integration_account_id
        AND is_org_admin(ia.organization_id)
    ))
  );

CREATE POLICY "Admins can insert bindings"
  ON store_integration_bindings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM integration_accounts ia
      WHERE ia.id = store_integration_bindings.integration_account_id
        AND is_org_admin(ia.organization_id)
    )
  );

CREATE POLICY "Admins can update bindings"
  ON store_integration_bindings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM integration_accounts ia
      WHERE ia.id = store_integration_bindings.integration_account_id
        AND is_org_admin(ia.organization_id)
    )
  );

CREATE POLICY "Admins can delete bindings"
  ON store_integration_bindings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM integration_accounts ia
      WHERE ia.id = store_integration_bindings.integration_account_id
        AND is_org_admin(ia.organization_id)
    )
  );

COMMENT ON TABLE store_integration_bindings IS
  'Many-to-many between stores and integration_accounts. store_id NULL = orphan account (e.g. ProteinBar, a Meta-only sub-brand).';
COMMENT ON COLUMN store_integration_bindings.role IS
  'primary = default read source; secondary = blended/additional; legacy = historical only (do not write new data).';
COMMENT ON COLUMN store_integration_bindings.weight IS
  'Reserved for future split-attribution reporting (e.g. 80/20 revenue credit across two ad accounts).';
