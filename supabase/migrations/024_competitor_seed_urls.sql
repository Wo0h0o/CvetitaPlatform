-- ============================================================
-- MIGRATION 024: Competitor seed URLs
-- ============================================================
-- Admin-curated category/collection page URLs from which scanner
-- harvests product links. Solves the "Gymbeam has 1000s of SKUs
-- and sitemap order is azbuchen" problem — admin points scan at
-- the right shelf.

ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS seed_urls TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN competitors.seed_urls IS
  'Optional admin-curated category/collection URLs to harvest product links from. Empty = fall back to sitemap discovery.';
