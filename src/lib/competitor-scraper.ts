import { tavilySearch, type TavilyResult } from "./tavily";
import { logger } from "./logger";

// ---------- Types ----------

export interface CompetitorIntelResult {
  title: string;
  summary: string;
  url: string;
  sentiment: "positive" | "negative" | "neutral";
  relevanceScore: number;
  source: string;
}

// ---------- Competitor Intelligence (Tavily) ----------

export async function searchCompetitorIntel(
  competitorName: string,
  industry = "хранителни добавки"
): Promise<CompetitorIntelResult[]> {
  try {
    const currentYear = new Date().getFullYear();
    const query = `${competitorName} ${industry} новини промоции ${currentYear}`;
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
