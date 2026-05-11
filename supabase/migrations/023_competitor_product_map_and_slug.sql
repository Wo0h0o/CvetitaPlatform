-- ============================================================
-- MIGRATION 023: Competitor slug + product mapping table
-- ============================================================
-- Adds:
--   1) competitors.slug — human-readable URLs (/competitors/gymbeam)
--   2) competitor_product_map — links each scraped competitor URL
--      to our Shopify product, for live price-diff comparison

-- ============================================================
-- 1) SLUG on competitors
-- ============================================================

ALTER TABLE competitors ADD COLUMN IF NOT EXISTS slug TEXT;

-- Backfill: lower(name), non-alphanumeric → hyphen, trim leading/trailing hyphens
UPDATE competitors
SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
WHERE slug IS NULL OR slug = '';

ALTER TABLE competitors ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitors_slug_org
  ON competitors (organization_id, slug);

-- ============================================================
-- 2) competitor_product_map — их URL ↔ наш Shopify product
-- ============================================================

CREATE TABLE IF NOT EXISTS competitor_product_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  competitor_product_url TEXT NOT NULL,
  competitor_product_name TEXT NOT NULL,
  our_shopify_product_id TEXT NOT NULL,  -- "gid://shopify/Product/..." OR numeric ID
  our_handle TEXT NOT NULL,
  our_product_name TEXT NOT NULL,
  mapping_confidence TEXT NOT NULL DEFAULT 'manual',  -- manual | ai_suggested
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competitor_id, competitor_product_url)
);

CREATE INDEX IF NOT EXISTS idx_cpm_competitor ON competitor_product_map (competitor_id);
CREATE INDEX IF NOT EXISTS idx_cpm_org ON competitor_product_map (organization_id);

CREATE TRIGGER trg_cpm_updated_at
  BEFORE UPDATE ON competitor_product_map
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE competitor_product_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view product mappings"
  ON competitor_product_map FOR SELECT
  USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "Members manage product mappings"
  ON competitor_product_map FOR ALL
  USING (organization_id IN (SELECT user_org_ids()))
  WITH CHECK (organization_id IN (SELECT user_org_ids()));
