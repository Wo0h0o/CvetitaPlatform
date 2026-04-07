import { fetchWithTimeout } from "./fetch-utils";
import { tavilySearch, type TavilyResult } from "./tavily";
import { logger } from "./logger";

// ---------- Types ----------

export interface CompetitorPriceResult {
  productName: string;
  productUrl: string;
  price: number;
  currency: string;
  inStock: boolean;
}

export interface CompetitorAdResult {
  adId: string;
  adText: string;
  creativeUrl: string | null;
  startedAt: string | null;
  isActive: boolean;
}

export interface CompetitorIntelResult {
  title: string;
  summary: string;
  url: string;
  sentiment: "positive" | "negative" | "neutral";
  relevanceScore: number;
  source: string;
}

// ---------- Meta Ad Library (public API, no auth) ----------

export async function fetchMetaAdLibrary(
  pageName: string,
  country = "BG"
): Promise<CompetitorAdResult[]> {
  try {
    // Meta Ad Library API — public, no token needed
    const params = new URLSearchParams({
      ad_type: "POLITICAL_AND_ISSUE_ADS",
      search_terms: pageName,
      ad_reached_countries: country,
      limit: "10",
    });

    // The public Ad Library API has limited access without token.
    // We use search-based approach via Tavily as fallback.
    const searchQuery = `site:facebook.com/ads/library "${pageName}" active ads ${country}`;
    const results = await tavilySearch(searchQuery);

    return results.results.slice(0, 5).map((r, i) => ({
      adId: `meta-${pageName}-${i}`,
      adText: r.content.slice(0, 500),
      creativeUrl: null,
      startedAt: null,
      isActive: true,
    }));
  } catch (err) {
    logger.error("Meta Ad Library fetch failed", { pageName, error: String(err) });
    return [];
  }
}

// ---------- Price Scraping ----------

export async function scrapeProductPrices(
  domain: string,
  productUrls: string[]
): Promise<CompetitorPriceResult[]> {
  const results: CompetitorPriceResult[] = [];

  for (const url of productUrls.slice(0, 10)) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; CvetitaBot/1.0)",
          "Accept": "text/html",
        },
      }, 8000);

      if (!res.ok) continue;
      const html = await res.text();

      // Extract price using common patterns
      const price = extractPrice(html);
      const title = extractTitle(html);
      const inStock = !html.toLowerCase().includes("out of stock") &&
                      !html.toLowerCase().includes("изчерпан");

      if (price && title) {
        results.push({
          productName: title,
          productUrl: url,
          price,
          currency: detectCurrency(html),
          inStock,
        });
      }
    } catch (err) {
      logger.error("Price scrape failed", { url, error: String(err) });
    }
  }

  return results;
}

function extractPrice(html: string): number | null {
  // Common price patterns in Bulgarian/EU e-commerce
  const patterns = [
    /(?:price|цена|Price)[^0-9]*?(\d+[.,]\d{2})/i,
    /"price"\s*:\s*"?(\d+[.,]\d{2})"?/i,
    /class="[^"]*price[^"]*"[^>]*>[\s\S]*?(\d+[.,]\d{2})/i,
    /(\d+[.,]\d{2})\s*(?:лв|BGN|EUR|€)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return parseFloat(match[1].replace(",", "."));
    }
  }
  return null;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)</i);
  if (match?.[1]) {
    return match[1].trim().split("|")[0].split("-")[0].trim().slice(0, 200);
  }
  return null;
}

function detectCurrency(html: string): string {
  if (/EUR|€/.test(html)) return "EUR";
  if (/лв|BGN/.test(html)) return "BGN";
  if (/RON|lei/i.test(html)) return "RON";
  return "BGN";
}

// ---------- Competitor Intelligence (Tavily) ----------

export async function searchCompetitorIntel(
  competitorName: string,
  industry = "хранителни добавки"
): Promise<CompetitorIntelResult[]> {
  try {
    const query = `${competitorName} ${industry} новини промоции 2024 2025`;
    const response = await tavilySearch(query);

    return response.results.map((r: TavilyResult) => ({
      title: r.title,
      summary: r.content.slice(0, 500),
      url: r.url,
      sentiment: detectSentiment(r.content),
      relevanceScore: r.score,
      source: "tavily",
    }));
  } catch (err) {
    logger.error("Competitor intel search failed", { competitorName, error: String(err) });
    return [];
  }
}

function detectSentiment(text: string): "positive" | "negative" | "neutral" {
  const lower = text.toLowerCase();
  const positive = ["growth", "ръст", "нов продукт", "успех", "expansion", "award", "launch"];
  const negative = ["проблем", "recall", "lawsuit", "спад", "decline", "complaint", "issue"];

  const posCount = positive.filter((w) => lower.includes(w)).length;
  const negCount = negative.filter((w) => lower.includes(w)).length;

  if (posCount > negCount) return "positive";
  if (negCount > posCount) return "negative";
  return "neutral";
}
