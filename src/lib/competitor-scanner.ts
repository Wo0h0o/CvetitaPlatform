import { fetchWithTimeout } from "./fetch-utils";
import { logger } from "./logger";
import { extractMarketsFromHtml } from "./competitor-markets";
import { canonicalProductName, scoreRelevance } from "./competitor-keywords";

// ---------- Types ----------

export interface ScannedProduct {
  name: string;
  price: number;
  currency: string;
  inStock: boolean;
  url: string;
}

export interface ScanResult {
  products: ScannedProduct[];
  urlsFound: number;
  urlsScanned: number;
  markets: string[];
  sisterDomains: string[];
}

// ---------- Gemini Text Call ----------

const GEMINI_MODEL = "gemini-2.5-flash";

async function geminiExtract(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      }),
    },
    30_000
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = (data as any).candidates?.[0]?.content?.parts || [];
  return parts.map((p: { text?: string }) => p.text || "").join("");
}

// ---------- Sitemap Discovery ----------

/**
 * Sitemap-based product URL discovery. Walks the full sitemap index (no longer
 * caps at "first 3 sub-sitemaps") and returns every product-like URL it finds.
 * Caller is responsible for ranking / capping with `scoreRelevance`.
 */
export async function discoverProductUrls(domain: string): Promise<string[]> {
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  const urls: string[] = [];
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; CvetitaBot/1.0)" };

  try {
    const res = await fetchWithTimeout(`${baseUrl}/sitemap.xml`, { headers }, 8000);
    if (res.ok) {
      const xml = await res.text();
      const allLocs = (xml.match(/<loc>([^<]+)<\/loc>/g) || [])
        .map((m) => m.replace(/<\/?loc>/g, ""));

      const isSitemapIndex = xml.includes("<sitemapindex") || allLocs.some((u) => u.endsWith(".xml"));

      if (isSitemapIndex) {
        // Walk every sub-sitemap. Skip ones that are obviously NOT products
        // (blogs, pages, authors), but otherwise be permissive — many shops
        // name them generically.
        const subSitemaps = allLocs.filter((u) =>
          u.endsWith(".xml") &&
          !/sitemap[-_](blog|article|news|author|page|tag|category|collection)s?[-_.]/i.test(u)
        );
        // Hard cap at 10 sub-sitemaps to prevent runaway scans
        for (const subUrl of subSitemaps.slice(0, 10)) {
          try {
            const subRes = await fetchWithTimeout(subUrl, { headers }, 10000);
            if (!subRes.ok) continue;
            const subXml = await subRes.text();
            const subLocs = (subXml.match(/<loc>([^<]+)<\/loc>/g) || [])
              .map((m) => m.replace(/<\/?loc>/g, ""));
            for (const loc of subLocs) {
              if (isProductUrl(loc)) urls.push(loc);
            }
          } catch { /* skip failed sub-sitemap */ }
        }
      } else {
        for (const loc of allLocs) {
          if (isProductUrl(loc)) urls.push(loc);
        }
      }
    }
  } catch {
    logger.info("Sitemap fetch failed", { domain });
  }

  return [...new Set(urls)];
}

/**
 * Harvest product anchors from a single category / collection / search page.
 * Used when admin has seeded `competitor.seed_urls` with specific shelves
 * (e.g. /collections/active-sport) — much higher precision than sitemap walk.
 */
export async function harvestProductUrlsFromPage(pageUrl: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CvetitaBot/1.0)",
        "Accept": "text/html",
      },
    }, 12000);
    if (!res.ok) return [];
    const html = await res.text();
    const base = new URL(pageUrl);

    const hrefs = new Set<string>();
    const anchorRegex = /<a[^>]+href=["']([^"'#]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = anchorRegex.exec(html))) {
      try {
        const abs = new URL(m[1], pageUrl).toString();
        const u = new URL(abs);
        // Only same-host, product-shaped paths
        if (u.host !== base.host) continue;
        if (!isProductUrl(abs)) continue;
        hrefs.add(abs.split(/[?#]/)[0]);
      } catch {
        /* malformed href */
      }
    }
    return [...hrefs];
  } catch (err) {
    logger.error("Harvest from page failed", { pageUrl, error: String(err) });
    return [];
  }
}

function isProductUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Common e-commerce non-product paths
  if (/\.(jpg|jpeg|png|webp|gif|svg|css|js|pdf|xml|json)(?:\?|$)/i.test(lower)) return false;
  if (/\/(cart|checkout|account|login|register|signup|blog|news|article|about|contact|policy|terms|faq|search|wishlist|compare|sitemap|robots)\b/i.test(lower)) return false;
  // Pure category/listing paths (no specific product slug)
  if (/\/(category|categories|collection|collections|brand|brands|page|pages|tag|tags|author|categoria)s?\/?$/i.test(lower)) return false;
  // Positive signals
  if (/\/products?\/[a-z0-9]/i.test(lower)) return true;
  if (/\.html$/i.test(lower)) return true;
  if (/\/p\/[a-z0-9]/i.test(lower)) return true;
  try {
    const path = new URL(url).pathname;
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return false;
    const last = segments[segments.length - 1];
    // Last segment must look like a slug (has a hyphen or unicode letters + length >= 4)
    if (last.length < 4) return false;
    if (last.includes("-")) return true;
    // Latin-only single word slug must be at least 6 chars (avoid /shop, /sale)
    if (/^[a-z0-9]+$/.test(last)) return last.length >= 8;
    return /[а-я]/.test(last); // BG slug without hyphens
  } catch {
    return false;
  }
}

// ---------- Product Extraction (JSON-LD first, Gemini fallback) ----------

export async function extractProductFromHtml(
  html: string,
  url: string
): Promise<ScannedProduct | null> {
  // Strategy 1: JSON-LD structured data (fast, free, reliable)
  const jsonLdProduct = extractFromJsonLd(html);
  if (jsonLdProduct) {
    return { ...jsonLdProduct, url };
  }

  // Strategy 2: Meta tags (og:price, product:price)
  const metaProduct = extractFromMeta(html);
  if (metaProduct) {
    return { ...metaProduct, url };
  }

  // Strategy 3: Gemini AI fallback (slow, costs tokens)
  return extractWithGemini(html, url);
}

function extractFromJsonLd(html: string): Omit<ScannedProduct, "url"> | null {
  const matches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || [];

  for (const match of matches) {
    try {
      const json = match.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
      const parsed = JSON.parse(json);
      const items = parsed["@graph"] || [parsed];

      for (const item of items) {
        if (item["@type"] !== "Product") continue;

        const offers = item.offers || {};
        const price = Number(offers.lowPrice || offers.price || offers.offers?.[0]?.price);
        const currency = offers.priceCurrency || offers.offers?.[0]?.priceCurrency || "BGN";
        const availability = String(offers.availability || offers.offers?.[0]?.availability || "");
        const inStock = availability.includes("InStock");
        const name = String(item.name || "").split("|")[0].trim();

        if (!name || !price || isNaN(price)) return null;

        return { name, price, currency, inStock };
      }
    } catch { /* skip invalid JSON-LD */ }
  }
  return null;
}

function extractFromMeta(html: string): Omit<ScannedProduct, "url"> | null {
  const priceMatch = html.match(/<meta[^>]+property="product:price:amount"[^>]+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="product:price:amount"/i);
  const currMatch = html.match(/<meta[^>]+property="product:price:currency"[^>]+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="product:price:currency"/i);
  const titleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    || html.match(/<title[^>]*>([^<]+)<\/title>/i);

  const price = priceMatch ? parseFloat(priceMatch[1]) : null;
  const name = titleMatch?.[1]?.split("|")[0].trim();

  if (!price || !name || isNaN(price)) return null;

  return {
    name,
    price,
    currency: currMatch?.[1] || "BGN",
    inStock: !html.toLowerCase().includes("outofstock") && !html.toLowerCase().includes("изчерпан"),
  };
}

async function extractWithGemini(html: string, url: string): Promise<ScannedProduct | null> {
  // Only use Gemini if JSON-LD and meta both failed
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
  const metas = (html.match(/<meta[^>]+>/gi) || []).slice(0, 20).join("\n");
  const trimmed = `Title: ${title}\n${metas}`.slice(0, 4000);

  const prompt = `Extract product info from this page. URL: ${url}\n\n${trimmed}\n\nReturn ONLY JSON: {"name":"...","price":29.99,"currency":"BGN","inStock":true}\nIf no price found, return null`;

  try {
    const response = await geminiExtract(prompt);
    const cleaned = response.trim().replace(/```json\n?/g, "").replace(/```/g, "").trim();
    if (cleaned === "null" || !cleaned.startsWith("{")) return null;
    const parsed = JSON.parse(cleaned);
    if (!parsed.name || typeof parsed.price !== "number") return null;
    return { name: parsed.name, price: parsed.price, currency: parsed.currency || "BGN", inStock: parsed.inStock !== false, url };
  } catch (err) {
    logger.error("Gemini extraction failed", { url, error: String(err) });
    return null;
  }
}

// ---------- Full Scan Pipeline ----------

async function detectMarkets(domain: string): Promise<{ markets: string[]; sisterDomains: string[] }> {
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  try {
    const res = await fetchWithTimeout(baseUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CvetitaBot/1.0)",
        "Accept": "text/html",
      },
    }, 8000);
    if (!res.ok) return { markets: [], sisterDomains: [] };
    const html = await res.text();
    return extractMarketsFromHtml(html, domain);
  } catch (err) {
    logger.error("Market detection failed", { domain, error: String(err) });
    return { markets: [], sisterDomains: [] };
  }
}

export interface ScanOptions {
  /** Final cap on scraped products after relevance + dedup. Default 100. */
  limit?: number;
  /**
   * Admin-curated category/collection URLs to harvest product links from.
   * If empty, scanner falls back to sitemap.xml discovery.
   */
  seedUrls?: string[];
  /**
   * Cvetita-catalog-derived keyword set. If provided, candidate URLs and
   * extracted product names are scored against it; only relevance > 0 kept.
   */
  relevanceKeywords?: Set<string>;
}

export async function scanCompetitor(
  domain: string,
  opts: ScanOptions = {}
): Promise<ScanResult> {
  const limit = opts.limit ?? 100;

  // ---- Step 0: markets + URL discovery (parallel) ----
  const [marketsInfo, discoveredUrls] = await Promise.all([
    detectMarkets(domain),
    discoverCandidateUrls(domain, opts.seedUrls),
  ]);

  // ---- Step 1: relevance ranking ----
  const ranked = rankCandidates(discoveredUrls, opts.relevanceKeywords);
  // Over-fetch 2× the limit so dedup losses don't starve the final list
  const toFetch = ranked.slice(0, limit * 2);

  logger.info("Candidate URLs ranked", {
    domain,
    discovered: discoveredUrls.length,
    relevant: ranked.length,
    toFetch: toFetch.length,
    markets: marketsInfo.markets,
    seeded: (opts.seedUrls?.length ?? 0) > 0,
  });

  if (toFetch.length === 0) {
    return { products: [], urlsFound: discoveredUrls.length, urlsScanned: 0, ...marketsInfo };
  }

  // ---- Step 2: fetch + extract (parallel, batch of 5) ----
  const products: ScannedProduct[] = [];
  const batchSize = 5;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const res = await fetchWithTimeout(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; CvetitaBot/1.0)",
            "Accept": "text/html",
          },
        }, 8000);
        if (!res.ok) return null;
        const html = await res.text();
        return extractProductFromHtml(html, url);
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) products.push(r.value);
    }
  }

  // ---- Step 3: second relevance pass (now we have the real name) ----
  let filtered = products;
  if (opts.relevanceKeywords) {
    filtered = products.filter(
      (p) => scoreRelevance({ url: p.url, name: p.name }, opts.relevanceKeywords!) > 0
    );
  }

  // ---- Step 4: dedup by canonical name (keep cheapest variant) ----
  const canonMap = new Map<string, ScannedProduct>();
  for (const p of filtered) {
    const key = canonicalProductName(p.name);
    const existing = canonMap.get(key);
    if (!existing || p.price < existing.price) {
      canonMap.set(key, p);
    }
  }
  const deduped = [...canonMap.values()].slice(0, limit);

  return {
    products: deduped,
    urlsFound: discoveredUrls.length,
    urlsScanned: toFetch.length,
    ...marketsInfo,
  };
}

/**
 * Resolve the candidate URL pool. Seed URLs win if present (admin-curated
 * shelves give much better precision); otherwise fall back to sitemap walk.
 */
async function discoverCandidateUrls(domain: string, seedUrls?: string[]): Promise<string[]> {
  if (seedUrls && seedUrls.length > 0) {
    const harvested = await Promise.all(seedUrls.map((u) => harvestProductUrlsFromPage(u)));
    return [...new Set(harvested.flat())];
  }
  return discoverProductUrls(domain);
}

/**
 * Score every candidate URL by Cvetita-keyword relevance. Returns the URLs
 * sorted by score desc. If no keywords provided, returns the raw list
 * (no filtering, no ordering).
 */
function rankCandidates(urls: string[], keywords?: Set<string>): string[] {
  if (!keywords || keywords.size === 0) return urls;
  const scored = urls
    .map((url) => ({ url, score: scoreRelevance({ url }, keywords) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((s) => s.url);
}
