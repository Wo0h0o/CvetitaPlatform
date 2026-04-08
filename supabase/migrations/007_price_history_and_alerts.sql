-- ============================================================
-- MIGRATION 007: Price History & Competitor Alerts
-- ============================================================

-- TABLE: competitor_alerts
CREATE TABLE competitor_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  type TEXT NOT NULL,  -- 'price_drop', 'price_increase', 'new_product', 'product_removed', 'out_of_stock'
  title TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',  -- {old_price, new_price, pct_change, product_name, url...}
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_org_date ON competitor_alerts (organization_id, created_at DESC);
CREATE INDEX idx_alerts_unread ON competitor_alerts (organization_id, is_read) WHERE is_read = false;
ALTER TABLE competitor_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view alerts"
  ON competitor_alerts FOR SELECT
  USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "System can manage alerts"
  ON competitor_alerts FOR ALL
  USING (organization_id IN (SELECT user_org_ids()));

-- Add INSERT policy for competitor_prices (was missing, caused scan writes to fail via user session)
CREATE POLICY "Members can insert competitor prices"
  ON competitor_prices FOR INSERT
  WITH CHECK (competitor_id IN (SELECT id FROM competitors WHERE organization_id IN (SELECT user_org_ids())));

CREATE POLICY "Members can delete competitor prices"
  ON competitor_prices FOR DELETE
  USING (competitor_id IN (SELECT id FROM competitors WHERE organization_id IN (SELECT user_org_ids())));
