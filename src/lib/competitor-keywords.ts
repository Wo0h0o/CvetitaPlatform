/**
 * Cvetita relevance scoring + canonical dedup for competitor scans.
 *
 * The competitor catalog scrape is noisy: a generic e-commerce site (Gymbeam,
 * iherb-style) has thousands of SKUs in categories we don't care about
 * (clothing, accessories, equipment). Without a relevance filter we waste scan
 * budget on gloves and shirts and miss the supplements we actually compete on.
 *
 * Approach:
 *   1) Build a keyword set from our own Shopify catalog (titles + product_type
 *      + tags), enriched with a small BG/EN supplement vocabulary baseline.
 *   2) Score every competitor candidate URL/name by how many keywords it hits.
 *   3) Group candidates by canonical name (strip variant suffixes like
 *      "60 caps", "X mg") and keep one per group.
 */

import type { ShopifyProduct } from "./shopify";

// ---------- Baseline supplement vocabulary ----------
// Always relevant, even before catalog enrichment. Lowercase, in canonical form.
const BASELINE_KEYWORDS = new Set<string>([
  // Macros / minerals
  "магнезий", "magnesium", "цинк", "zinc", "калций", "calcium",
  "желязо", "iron", "калий", "potassium",
  // Vitamins
  "витамин", "vitamin", "d3", "k2", "b6", "b12", "c-витамин",
  "vit-c", "vit-d", "vit-k", "vitc", "vitd",
  // Adaptogens / herbs
  "tribulus", "трибулус", "leuzea", "левзея", "rhodiola", "родиола",
  "ashwagandha", "ашваганда", "ginseng", "женшен",
  "екдистерон", "ecdysterone", "екдистен", "ecdystene",
  "куркума", "curcumin", "curcuma", "turmeric",
  "силимарин", "silymarin", "бял трън", "thistle", "milk-thistle",
  "босилек", "босвелия", "boswellia",
  // Performance
  "creatine", "креатин", "bcaa", "leucine", "leucine",
  "glutamine", "глутамин", "carnitine", "карнитин",
  "arginine", "аргинин", "citrulline", "цитрулин",
  "beta-alanine", "бета-аланин", "taurine", "таурин",
  // Targeted
  "tribuloid", "testosterone", "тестостерон", "test-booster",
  "omega", "омега", "fish-oil", "рибено", "epa", "dha",
  "collagen", "колаген", "biotin", "биотин",
  "ginkgo", "гинко", "biloba", "билоба",
  "melatonin", "мелатонин", "valerian", "валериан",
  "passion-flower", "пасифлора", "лаванда",
  // Cvetita-specific Bulgarian terms
  "тинктура", "екстракт", "extract", "tincture",
  "капки", "капсули", "капс", "caps", "capsules", "таблетки", "tablet",
  "билка", "herbal", "herbs",
  "имунитет", "immune", "стрес", "stress", "сън", "sleep",
  "тонус", "енергия", "energy", "детокс", "detox",
  // Cvetita brand cues (in case competitor sells our brand or copies names)
  "цветита", "cvetita",
]);

const STOPWORDS = new Set<string>([
  // BG
  "и", "или", "за", "от", "на", "с", "във", "по", "до", "при",
  "пакет", "комбо", "сет", "ново", "ново!", "наличен", "промо",
  // EN
  "the", "and", "or", "for", "of", "in", "on", "to", "with",
  "pack", "combo", "set", "new", "premium", "kg", "g", "mg", "ml",
  "free", "shipping",
  // Numerics
  "100", "200", "250", "300", "500", "750", "1000",
]);

/**
 * Build a relevance keyword set from our Shopify catalog (handles, titles,
 * product types, tags), unioned with the BASELINE_KEYWORDS vocabulary.
 */
export function buildCvetitaKeywords(catalog: ShopifyProduct[]): Set<string> {
  const out = new Set<string>(BASELINE_KEYWORDS);

  for (const p of catalog) {
    addTokens(out, p.title);
    addTokens(out, p.product_type);
    addTokens(out, p.tags);
    addTokens(out, p.handle.replace(/-/g, " "));
    addTokens(out, p.vendor);
  }

  return out;
}

function addTokens(set: Set<string>, raw: string | undefined | null): void {
  if (!raw) return;
  const tokens = raw
    .toLowerCase()
    .replace(/®|™|©/g, "")
    .split(/[\s,/\-_+|()[\]]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  for (const t of tokens) set.add(t);
}

// ---------- Relevance scoring ----------

/**
 * Score a competitor product's relevance to our catalog. 0 = no match,
 * higher = stronger. We use a 0..1 cap to keep call-sites simple.
 *
 * Inputs scored: URL slug + product name. Hits are deduped per call.
 */
export function scoreRelevance(
  candidate: { url: string; name?: string },
  keywords: Set<string>
): number {
  const corpus =
    (decodeUrlPath(candidate.url) + " " + (candidate.name || "")).toLowerCase();

  // Tokenise corpus the same way we tokenise our catalog (for consistency)
  const tokens = corpus
    .replace(/®|™|©/g, "")
    .split(/[\s,/\-_+|()[\]?=&]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));

  const hits = new Set<string>();
  for (const t of tokens) {
    if (keywords.has(t)) hits.add(t);
  }

  // Diminishing returns: first hit is the discovery, more hits add confidence
  if (hits.size === 0) return 0;
  return Math.min(1, 0.4 + hits.size * 0.2);
}

function decodeUrlPath(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname + u.search);
  } catch {
    return url;
  }
}

// ---------- Canonical name (dedup) ----------

const VARIANT_SUFFIX_PATTERNS: RegExp[] = [
  /\b\d{1,4}\s*(mg|g|ml|kg|caps?|капсули|капс|таблетки|tablet|pcs|ct|count|servings|порции|порция)\b/gi,
  /\b\(\s*\d{1,4}\s*[a-zа-я]*\s*\)/gi,
  /[–—-]\s*\d{1,4}\s*[a-zа-я]*\s*$/i,
];

/**
 * Canonicalise a product name so that "Solid Life 60 caps", "Solid Life 120
 * capsules", "Solid Life - 240 ct" all collapse to "solid life".
 *
 * Used to dedup multi-variant SKUs that share a base product but differ only
 * in pack size. We keep one row per canonical name (the cheapest variant).
 */
export function canonicalProductName(name: string): string {
  let s = name.toLowerCase();
  s = s.replace(/®|™|©/g, "");
  for (const re of VARIANT_SUFFIX_PATTERNS) {
    s = s.replace(re, " ");
  }
  // Strip leading brand prefix duplicates (already-lowercased)
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
