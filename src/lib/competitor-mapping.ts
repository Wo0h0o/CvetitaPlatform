/**
 * AI-suggested product mapping: given a competitor product, find the top 3
 * most-likely matches in our Shopify catalog.
 *
 * Uses Claude Opus 4.7 with tool-use forcing JSON output + prompt caching on
 * the catalog payload (which barely changes between calls).
 */

import { logger } from "./logger";
import { stripHtml, type ShopifyProduct } from "./shopify";

export interface MappingSuggestion {
  shopifyId: string;
  handle: string;
  title: string;
  confidence: number; // 0..1
  reasoning: string;
}

interface CompactProduct {
  id: string;
  handle: string;
  title: string;
  type: string;
  tags: string;
  desc: string; // first 200 chars
}

function compactCatalog(catalog: ShopifyProduct[]): CompactProduct[] {
  return catalog.map((p) => ({
    id: String(p.id),
    handle: p.handle,
    title: p.title,
    type: p.product_type || "",
    tags: p.tags || "",
    desc: stripHtml(p.body_html || "").slice(0, 200),
  }));
}

const SYSTEM_PROMPT = `Ти си експерт-маркетолог за български пазар на хранителни добавки. Задачата ти е да намериш кой наш продукт е най-близкият еквивалент на даден чужд (на конкурент) продукт.

Принципи:
- Сравнявай по: тип продукт (магнезий, цинк, тестостерон-бустер, омега…), активна съставка, форма (капсула/таблетка/прах), доза, целеви ефект.
- НЕ се водиш само по име — превключи на функция/съставка.
- Ако нямаш точно съвпадение, върни най-близкото с по-ниска confidence.
- Връщай ТОЧНО 3 кандидата, сортирани по confidence (най-добрият първи).
- confidence е 0..1; 0.9+ = почти сигурно същия продукт; 0.5-0.7 = подобна категория; <0.4 = слабо съвпадение.
- reasoning е 1-2 кратки изречения на български.`;

const TOOL_DEF = {
  name: "submit_mappings",
  description: "Върни топ-3 най-вероятни съответствия от нашия каталог.",
  input_schema: {
    type: "object" as const,
    properties: {
      candidates: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            shopifyId: { type: "string", description: "id от каталога" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reasoning: { type: "string" },
          },
          required: ["shopifyId", "confidence", "reasoning"],
        },
      },
    },
    required: ["candidates"],
  },
};

interface AnthropicToolUseBlock {
  type: "tool_use";
  name: string;
  input: { candidates: Array<{ shopifyId: string; confidence: number; reasoning: string }> };
}

interface AnthropicResponse {
  content: Array<AnthropicToolUseBlock | { type: string }>;
  stop_reason: string;
}

export async function suggestProductMappings(
  competitorProduct: { name: string; url: string },
  catalog: ShopifyProduct[]
): Promise<MappingSuggestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const compact = compactCatalog(catalog);
  const lookup = new Map(compact.map((p) => [p.id, p]));

  // Catalog payload is large and stable across calls → enable prompt caching.
  const userMessage = [
    {
      type: "text",
      text:
        "Нашият каталог (JSON):\n" +
        JSON.stringify(compact) +
        "\n\nКонкурентен продукт:\n" +
        JSON.stringify({
          name: competitorProduct.name,
          url: competitorProduct.url,
        }) +
        "\n\nВърни 3 най-близки наши продукта чрез инструмента submit_mappings.",
      cache_control: { type: "ephemeral" as const },
    },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [TOOL_DEF],
      tool_choice: { type: "tool", name: "submit_mappings" },
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    logger.error("AI mapping suggest failed", { status: res.status, error: errText });
    throw new Error(`Claude API: ${res.status}`);
  }

  const data: AnthropicResponse = await res.json();
  const toolUse = data.content.find(
    (b): b is AnthropicToolUseBlock => b.type === "tool_use" && (b as AnthropicToolUseBlock).name === "submit_mappings"
  );
  if (!toolUse) {
    throw new Error("AI did not invoke submit_mappings tool");
  }

  const out: MappingSuggestion[] = [];
  for (const c of toolUse.input.candidates) {
    const p = lookup.get(c.shopifyId);
    if (!p) continue; // hallucination — skip
    out.push({
      shopifyId: p.id,
      handle: p.handle,
      title: p.title,
      confidence: Math.max(0, Math.min(1, c.confidence)),
      reasoning: c.reasoning,
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}
