export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilyResponse {
  answer?: string;
  results: TavilyResult[];
  query: string;
}

export async function tavilySearch(query: string): Promise<TavilyResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    // Return mock data if no API key — don't crash the agent
    return {
      query,
      results: [],
      answer: `[Tavily API key не е конфигуриран. Добавете TAVILY_API_KEY в environment variables.]`,
    };
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      include_answer: true,
      include_raw_content: false,
      max_results: 5,
      include_domains: [],
      exclude_domains: [],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tavily error ${res.status}: ${err}`);
  }

  return res.json();
}

export function formatSearchResults(response: TavilyResponse): string {
  const lines: string[] = [];

  if (response.answer) {
    lines.push(`Резюме: ${response.answer}`);
    lines.push("");
  }

  response.results.forEach((r, i) => {
    lines.push(`[${i + 1}] ${r.title}`);
    lines.push(`URL: ${r.url}`);
    lines.push(`${r.content.slice(0, 600)}...`);
    lines.push("");
  });

  return lines.join("\n");
}
