-- ECOMMAND Foundation Tables
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE member_role AS ENUM ('admin', 'manager', 'viewer');
CREATE TYPE store_platform AS ENUM ('shopify', 'woocommerce', 'custom');

-- ============================================================
-- HELPER: auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- HELPER: get org IDs for the current user (used by RLS)
-- ============================================================

CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT organization_id
  FROM organization_members
  WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- HELPER: check if current user is admin of an org
-- ============================================================

CREATE OR REPLACE FUNCTION is_org_admin(org_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = auth.uid()
      AND organization_id = org_id
      AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- TABLE: organizations
-- ============================================================

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'EUR',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_organizations_slug ON organizations (slug);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their orgs"
  ON organizations FOR SELECT
  USING (id IN (SELECT user_org_ids()));

CREATE POLICY "Admins can update their orgs"
  ON organizations FOR UPDATE
  USING (is_org_admin(id));

-- ============================================================
-- TABLE: organization_members
-- ============================================================

CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'viewer',
  store_access UUID[] DEFAULT NULL, -- NULL = all stores, array = specific store IDs
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TRIGGER trg_org_members_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_org_members_user ON organization_members (user_id);
CREATE INDEX idx_org_members_org ON organization_members (organization_id);

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view co-members"
  ON organization_members FOR SELECT
  USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "Admins can insert members"
  ON organization_members FOR INSERT
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "Admins can delete members"
  ON organization_members FOR DELETE
  USING (is_org_admin(organization_id));

-- ============================================================
-- TABLE: stores
-- ============================================================

CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  market_code TEXT NOT NULL, -- 'bg', 'gr', 'ro', 'hu', etc.
  platform store_platform NOT NULL DEFAULT 'shopify',
  domain TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_stores_updated_at
  BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_stores_org ON stores (organization_id);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view org stores"
  ON stores FOR SELECT
  USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "Admins can insert stores"
  ON stores FOR INSERT
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "Admins and managers can update stores"
  ON stores FOR UPDATE
  USING (
    organization_id IN (SELECT user_org_ids())
    AND EXISTS (
      SELECT 1 FROM organization_members
      WHERE user_id = auth.uid()
        AND organization_id = stores.organization_id
        AND role IN ('admin', 'manager')
    )
  );

-- ============================================================
-- TABLE: store_credentials
-- ============================================================

CREATE TABLE store_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  service TEXT NOT NULL, -- 'shopify', 'meta', 'ga4', 'klaviyo', 'google_ads'
  credentials JSONB NOT NULL DEFAULT '{}', -- encrypted at app level
  status TEXT NOT NULL DEFAULT 'active', -- active, expired, error
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, service)
);

CREATE TRIGGER trg_store_creds_updated_at
  BEFORE UPDATE ON store_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_store_creds_store ON store_credentials (store_id);

ALTER TABLE store_credentials ENABLE ROW LEVEL SECURITY;

-- Only admins can see/manage credentials (sensitive data)
CREATE POLICY "Admins can view credentials"
  ON store_credentials FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM stores s
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE s.id = store_credentials.store_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert credentials"
  ON store_credentials FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM stores s
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE s.id = store_credentials.store_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

CREATE POLICY "Admins can update credentials"
  ON store_credentials FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM stores s
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE s.id = store_credentials.store_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete credentials"
  ON store_credentials FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM stores s
      JOIN organization_members om ON om.organization_id = s.organization_id
      WHERE s.id = store_credentials.store_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );
