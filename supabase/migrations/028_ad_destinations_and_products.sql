-- Migration 028 — ad destinations + product mappings
--
-- Backstory: agent-briefs analyses ads in isolation today and writes
-- one card per Meta object. The owner wants product-centric cards
-- ("for Левзея Макс in BG, 2 of 5 ads aren't working — here are the
-- winners and losers"). That requires knowing which product each ad
-- sells, including ads that link to advertorial pages instead of
-- product pages.
--
-- Two-layer mapping:
--   Layer A (ad_destinations)      cache of "which URL does this ad point at"
--                                  populated automatically from Meta API.
--   Layer B (destination_products) "which product(s) does that URL sell"
--                                  LLM-inferred from Shopify page/product
--                                  content; verified later via /settings.
--
-- Volume math: ~30-40 new ads/day, but most reuse existing destination
-- URLs (one advertorial → 30+ ads). Realistic infer cost: 2-5
-- destinations/day at Haiku 4.5 pricing, well under $0.01/day.

-- ============================================================
-- Layer A — ad_destinations
-- ============================================================

CREATE TABLE ad_destinations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_account_id UUID NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  ad_id                  TEXT NOT NULL,                -- native Meta ad id
  ad_name                TEXT,                          -- denormalised for resolver UI
  destination_url        TEXT,                          -- raw URL from Meta creative
  destination_path       TEXT,                          -- normalised path '/pages/X' or '/products/Y'
  destination_type       TEXT CHECK (destination_type IN (
                           'product',    -- /products/<handle>
                           'page',       -- /pages/<handle>   (advertorial)
                           'collection', -- /collections/<handle>
                           'home',       -- '/' or '/store'
                           'external',   -- non-Shopify host
                           'unknown'     -- couldn't parse
                         )),
  destination_handle     TEXT,                          -- parsed handle slug
  resolved_at            TIMESTAMPTZ,                   -- NULL = not yet fetched from Meta
  resolve_error          TEXT,                          -- last error string for retries
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_account_id, ad_id)
);

CREATE TRIGGER trg_ad_destinations_updated_at
  BEFORE UPDATE ON ad_destinations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Cron "find ads needing resolution" — partial index keeps it tight.
CREATE INDEX idx_ad_destinations_unresolved
  ON ad_destinations (integration_account_id, created_at)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_ad_destinations_by_path
  ON ad_destinations (destination_path)
  WHERE destination_path IS NOT NULL;

-- ============================================================
-- Layer B — destination_products
-- ============================================================

CREATE TABLE destination_products (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id               UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  destination_path       TEXT NOT NULL,                 -- '/pages/astenia-levzea-max'
  product_handles        TEXT[] NOT NULL DEFAULT '{}',  -- ['levzea-max'] or [a,b] for combos
  inference_confidence   NUMERIC(3,2),                  -- 0.00 .. 1.00, NULL if not inferred
  inference_reasoning    TEXT,                          -- LLM's why-trace, surfaced in sweep UI
  inference_model        TEXT,                          -- 'claude-haiku-4-5'
  verified_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at            TIMESTAMPTZ,
  last_seen_at           TIMESTAMPTZ DEFAULT now(),     -- bump when an active ad references this
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, destination_path)
);

CREATE TRIGGER trg_destination_products_updated_at
  BEFORE UPDATE ON destination_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- "Show me low-confidence mappings that have active ads" (sweep UI).
CREATE INDEX idx_destination_products_sweep
  ON destination_products (store_id, verified_at, inference_confidence)
  WHERE verified_at IS NULL;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE ad_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE destination_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view ad_destinations in their orgs"
  ON ad_destinations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM integration_accounts ia
      WHERE ia.id = ad_destinations.integration_account_id
        AND ia.organization_id IN (SELECT user_org_ids())
    )
  );

CREATE POLICY "Members can view destination_products in their orgs"
  ON destination_products FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM stores s
      WHERE s.id = destination_products.store_id
        AND s.organization_id IN (SELECT user_org_ids())
    )
  );

-- Writes happen via service-role from the cron + settings UI.

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE ad_destinations IS
  'Cache of "which URL does this Meta ad point at". Populated by /api/cron/resolve-ad-destinations. One row per (account, ad).';

COMMENT ON TABLE destination_products IS
  'Mapping from a Shopify destination path to the product handle(s) it sells. LLM-inferred initially; sweep UI lets the owner fix mistakes later.';

COMMENT ON COLUMN destination_products.product_handles IS
  'Array because some advertorials sell a combo / multiple SKUs. Order matters: first handle is the hero product.';

COMMENT ON COLUMN destination_products.inference_confidence IS
  'LLM self-reported confidence 0-1. Sweep UI sorts ascending × harch to prioritise high-impact mistakes.';
