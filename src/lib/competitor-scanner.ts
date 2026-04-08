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

  logger.info("Product URL discovery complete", { domain, found: urls.length });
  return [...new Set(urls)].slice(0, limit);
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

// ---------- AI Product Extraction ----------

export async function extractProductFromHtml(
  html: string,
  url: string
): Promise<ScannedProduct | null> {
  // Trim HTML to essential parts (reduce token usage)
  const trimmed = trimHtml(html);
  if (trimmed.length < 50) return null;

  const prompt = `Анализирай този HTML от продуктова страница и извлечи информацията.

URL: ${url}

HTML (съкратен):
${trimmed}

Отговори САМО с JSON в този формат, без markdown, без обяснения:
{"name":"Име на продукта","price":29.99,"currency":"BGN","inStock":true}

Правила:
- name: пълното име на продукта
- price: числова стойност (без валутен символ)
- currency: BGN, EUR, RON и т.н.
- inStock: true/false
- Ако не можеш да извлечеш цена, върни null`;

  try {
    const response = await geminiExtract(prompt);
    const cleaned = response.trim().replace(/```json\n?/g, "").replace(/```/g, "").trim();

    if (cleaned === "null" || !cleaned.startsWith("{")) return null;

    const parsed = JSON.parse(cleaned);
    if (!parsed.name || typeof parsed.price !== "number") return null;

    return {
      name: parsed.name,
      price: parsed.price,
      currency: parsed.currency || "BGN",
      inStock: parsed.inStock !== false,
      url,
    };
  } catch (err) {
    logger.error("AI product extraction failed", { url, error: String(err) });
    return null;
  }
}

function trimHtml(html: string): string {
  // Remove scripts, styles, SVGs, comments
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "");

  // Remove excessive whitespace
  clean = clean.replace(/\s+/g, " ");

  // Keep only the most relevant parts (title, price areas, meta tags)
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[0] || "";
  const metas = (html.match(/<meta[^>]+>/gi) || []).join("\n");
  const jsonLd = (html.match(/<script type="application\/ld\+json"[\s\S]*?<\/script>/gi) || []).join("\n");

  // If we have structured data, prefer it
  if (jsonLd.length > 50) {
    return `${title}\n${metas}\n${jsonLd}`.slice(0, 8000);
  }

  // Otherwise send trimmed HTML body
  return `${title}\n${metas}\n${clean}`.slice(0, 8000);
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
