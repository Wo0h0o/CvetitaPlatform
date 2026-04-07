-- ============================================================
-- MIGRATION 006: Competitor Monitoring
-- ============================================================

-- TABLE: competitors
CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  logo_url TEXT,
  facebook_page TEXT,
  category TEXT NOT NULL DEFAULT 'direct',  -- direct, indirect, marketplace
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}',     -- CSS selectors, tracked URLs, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_competitors_updated_at
  BEFORE UPDATE ON competitors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_competitors_org ON competitors (organization_id);
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view competitors"
  ON competitors FOR SELECT
  USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "Admins can manage competitors"
  ON competitors FOR ALL
  USING (organization_id IN (SELECT user_org_ids()));

-- TABLE: competitor_prices
CREATE TABLE competitor_prices (
  id BIGSERIAL PRIMARY KEY,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_url TEXT,
  price NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BGN',
  in_stock BOOLEAN DEFAULT true,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_competitor_prices_lookup ON competitor_prices (competitor_id, scraped_at DESC);
ALTER TABLE competitor_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view competitor prices"
  ON competitor_prices FOR SELECT
  USING (competitor_id IN (SELECT id FROM competitors WHERE organization_id IN (SELECT user_org_ids())));

-- TABLE: competitor_ads
CREATE TABLE competitor_ads (
  id BIGSERIAL PRIMARY KEY,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'meta',    -- meta, google
  ad_id TEXT,
  creative_url TEXT,
  ad_text TEXT,
  started_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_competitor_ads_lookup ON competitor_ads (competitor_id, scraped_at DESC);
ALTER TABLE competitor_ads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view competitor ads"
  ON competitor_ads FOR SELECT
  USING (competitor_id IN (SELECT id FROM competitors WHERE organization_id IN (SELECT user_org_ids())));

-- TABLE: competitor_intel
CREATE TABLE competitor_intel (
  id BIGSERIAL PRIMARY KEY,
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,  -- nullable for industry-level
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'tavily',    -- tavily, manual, ad_library
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  sentiment TEXT DEFAULT 'neutral',         -- positive, negative, neutral
  relevance_score NUMERIC(3, 2) DEFAULT 0.5,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_competitor_intel_org ON competitor_intel (organization_id, discovered_at DESC);
ALTER TABLE competitor_intel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view competitor intel"
  ON competitor_intel FOR SELECT
  USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "System can insert intel"
  ON competitor_intel FOR INSERT
  WITH CHECK (organization_id IN (SELECT user_org_ids()));
