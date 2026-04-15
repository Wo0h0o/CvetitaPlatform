-- Migration 008 — integration_accounts
-- Purpose: decouple external data-source accounts (Meta ad accounts, GA4 properties,
-- Klaviyo accounts, etc.) from the "store" concept. One org can own N accounts per
-- service; one store can bind to multiple accounts (old + new BG Meta); and some
-- accounts have no store at all (ProteinBar is a Meta-only sub-brand).
--
-- Shopify credentials stay in `store_credentials` (1:1 per store). All other
-- integrations move here.

-- ============================================================
-- TABLE: integration_accounts
-- ============================================================

CREATE TABLE integration_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service           TEXT NOT NULL,               -- 'meta_ads' | 'google_ads' | 'ga4' | 'klaviyo' | 'shopify'
  external_id       TEXT NOT NULL,               -- e.g. 'act_280706744248197', 'G-XXXXXX', 'cvetita.myshopify.com'
  display_name      TEXT NOT NULL,               -- human-readable: 'Meta — BG primary', 'ProteinBar'
  currency          TEXT,                        -- 'EUR', 'USD' — null for non-financial services
  timezone          TEXT,                        -- 'Europe/Sofia', etc.
  credentials       JSONB NOT NULL DEFAULT '{}', -- encrypted secrets (access_token, refresh_token, etc.)
  status            TEXT NOT NULL DEFAULT 'active', -- 'active' | 'expired' | 'error' | 'rate_limited' | 'disabled'
  token_expires_at  TIMESTAMPTZ,
  last_synced_at    TIMESTAMPTZ,
  last_sync_error   TEXT,                        -- last error message for debugging
  metadata          JSONB NOT NULL DEFAULT '{}', -- misc: business_name, account_id_int, etc.
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, service, external_id)
);

CREATE TRIGGER trg_integration_accounts_updated_at
  BEFORE UPDATE ON integration_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_integration_accounts_org_service
  ON integration_accounts (organization_id, service);

CREATE INDEX idx_integration_accounts_service_status
  ON integration_accounts (service, status);

-- ============================================================
-- RLS: same access pattern as store_credentials — only org admins
-- can see/manage credentials (sensitive data).
-- ============================================================

ALTER TABLE integration_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view org integration accounts"
  ON integration_accounts FOR SELECT
  USING (is_org_admin(organization_id));

CREATE POLICY "Admins can insert org integration accounts"
  ON integration_accounts FOR INSERT
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "Admins can update org integration accounts"
  ON integration_accounts FOR UPDATE
  USING (is_org_admin(organization_id));

CREATE POLICY "Admins can delete org integration accounts"
  ON integration_accounts FOR DELETE
  USING (is_org_admin(organization_id));

COMMENT ON TABLE integration_accounts IS
  'External data-source accounts (Meta ad accounts, GA4 properties, Klaviyo, etc.). Independent of stores — bindings live in store_integration_bindings.';
COMMENT ON COLUMN integration_accounts.external_id IS
  'Service-native identifier: act_XXX for Meta, G-XXX for GA4, shop.myshopify.com for Shopify.';
COMMENT ON COLUMN integration_accounts.credentials IS
  'Encrypted via src/lib/encryption.ts. Shape depends on service (e.g. meta: {access_token}; ga4: {refresh_token, client_id}).';
