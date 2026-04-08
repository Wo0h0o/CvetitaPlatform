import { fetchWithTimeout } from "./fetch-utils";
import { logger } from "./logger";

// ---------- Types ----------

export interface ScannedProduct {
  name: string;
  price: number;
  currency: string;
  inStock: boolean;
  url: string;
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

export async function discoverProductUrls(domain: string, limit = 30): Promise<string[]> {
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  const urls: string[] = [];
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; CvetitaBot/1.0)" };

  // Step 1: Fetch sitemap.xml
  try {
    const res = await fetchWithTimeout(`${baseUrl}/sitemap.xml`, { headers }, 8000);
    if (res.ok) {
      const xml = await res.text();
      const allLocs = (xml.match(/<loc>([^<]+)<\/loc>/g) || [])
        .map((m) => m.replace(/<\/?loc>/g, ""));

      // Detect: is this a sitemap INDEX (contains links to other .xml files)?
      const isSitemapIndex = xml.includes("<sitemapindex") || allLocs.some((u) => u.endsWith(".xml"));

      if (isSitemapIndex) {
        // It's an index — find sub-sitemaps with product-related names
        const productSitemaps = allLocs
          .filter((u) => u.endsWith(".xml") && /product|item|catalog/i.test(u))
          .slice(0, 3);

        // If no product-specific sitemap, take all sub-sitemaps (some sites use generic names)
        const sitemapsToFetch = productSitemaps.length > 0
          ? productSitemaps
          : allLocs.filter((u) => u.endsWith(".xml")).slice(0, 3);

        for (const subUrl of sitemapsToFetch) {
          if (urls.length >= limit) break;
          try {
            const subRes = await fetchWithTimeout(subUrl, { headers }, 10000);
            if (!subRes.ok) continue;
            const subXml = await subRes.text();
            const subLocs = (subXml.match(/<loc>([^<]+)<\/loc>/g) || [])
              .map((m) => m.replace(/<\/?loc>/g, ""));
            for (const loc of subLocs) {
              if (isProductUrl(loc)) {
                urls.push(loc);
                if (urls.length >= limit) break;
              }
            }
          } catch { /* skip failed sub-sitemap */ }
        }
      } else {
        // Regular sitemap — extract product URLs directly
        for (const loc of allLocs) {
          if (isProductUrl(loc)) {
            urls.push(loc);
            if (urls.length >= limit) break;
          }
        }
      }
    }
  } catch {
    logger.info("Sitemap fetch failed", { domain });
  }

  // Take a spread sample (not just first N — old products tend to be discontinued)
  const unique = [...new Set(urls)];
  if (unique.length <= limit) return unique;

  // Sample evenly across the list
  const step = Math.floor(unique.length / limit);
  const sampled: string[] = [];
  for (let i = 0; i < unique.length && sampled.length < limit; i += step) {
    sampled.push(unique[i]);
  }

  logger.info("Product URL discovery complete", { domain, total: unique.length, sampled: sampled.length });
  return sampled;
}

function isProductUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Common e-commerce product URL patterns
  if (/\.(jpg|png|gif|css|js|pdf|xml)$/i.test(lower)) return false;
  if (/\/(cart|checkout|account|login|register|blog|about|contact|policy|terms|faq)/i.test(lower)) return false;
  if (/\/(category|collection|collections|brand|page|tag)s?\/?$/i.test(lower)) return false;
  // Positive signals
  if (/\/product[s]?\//i.test(lower)) return true;
  if (/\.html$/i.test(lower)) return true;
  if (/\/p\/\d/i.test(lower)) return true;
  // URLs with slugs that look like products (has hyphens, no trailing slash for categories)
  const path = new URL(url).pathname;
  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 1 && segments[segments.length - 1].includes("-")) return true;
  return false;
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

export async function scanCompetitor(
  domain: string,
  limit = 30
): Promise<{ products: ScannedProduct[]; urlsFound: number; urlsScanned: number }> {
  // Step 1: Discover URLs
  const urls = await discoverProductUrls(domain, limit);
  logger.info("Product URLs discovered", { domain, count: urls.length });

  if (urls.length === 0) {
    return { products: [], urlsFound: 0, urlsScanned: 0 };
  }

  // Step 2: Fetch & extract products (parallel, max 5 at a time)
  const products: ScannedProduct[] = [];
  const batchSize = 5;

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
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

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        products.push(result.value);
      }
    }
  }

  return { products, urlsFound: urls.length, urlsScanned: urls.length };
}
