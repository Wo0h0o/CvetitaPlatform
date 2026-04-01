import { NextRequest } from "next/server";

export const maxDuration = 120;

// ---- Tool definitions for Claude ----

const TOOL_LABELS: Record<string, string> = {
  get_sales: "Продажби (Shopify)",
  get_product_analytics: "Продуктова аналитика",
  get_traffic: "Трафик (GA4)",
  get_email: "Имейли (Klaviyo)",
  get_ads_overview: "Реклами (Meta)",
  get_ads_detail: "Детайлни реклами",
};

const CUSTOM_TOOLS = [
  {
    name: "get_sales",
    description: "Получава днешните продажби от Shopify — приходи, брой поръчки, среден чек (AOV) и топ 5 продукти. Също сравнява с вчерашния ден.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "get_product_analytics",
    description: "Получава продуктова аналитика за период — всички продукти с приходи, количества, upsell rate, топ комбинации и дневен тренд. По подразбиране последните 30 дни.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: { type: "string", description: "Начална дата (YYYY-MM-DD). По подразбиране 30 дни назад." },
        to: { type: "string", description: "Крайна дата (YYYY-MM-DD). По подразбиране днес." },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_traffic",
    description: "Получава трафик данни от Google Analytics за последните 30 дни — сесии, потребители, engagement rate, канали (Organic, Direct, Paid, etc.), топ страници и устройства.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "get_email",
    description: "Получава имейл маркетинг данни от Klaviyo — приходи от кампании и flows, open/click rates, топ flows по приход, списък кампании.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["7d", "30d", "90d"], description: "Период. По подразбиране 30d." },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_ads_overview",
    description: "Получава обзор на Meta Ads рекламите — spend, revenue, ROAS, покупки, CPA, CTR, фуния (impressions → purchases), и списък кампании с метрики.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "7d", "14d", "30d"], description: "Период. По подразбиране 7d." },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_ads_detail",
    description: "Получава детайлна информация за всички индивидуални реклами — score (0-100), ROAS, CPA, CTR, CVR, frequency, тип (video/image), score breakdown. Включва account averages за сравнение.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: { type: "string", enum: ["today", "7d", "14d", "30d"], description: "Период. По подразбиране 7d." },
      },
      required: [] as string[],
    },
  },
];

const WEB_SEARCH_TOOL = {
  type: "web_search_20250305" as const,
  name: "web_search",
};

const SYSTEM_PROMPT = `Ти си Команден Чат — централен AI бизнес асистент на Цветита Хербал.

== КОМПАНИЯТА ==
Цветита Хербал е водеща българска марка за хранителни добавки:
• 15 години на пазара, над 1 милион клиенти
• Собствено българско производство
• Онлайн магазин, доставки в България и ЕС
• Валута: EUR
• Месечен рекламен бюджет: над 15 000 лв

== КОНКУРЕНТИ ==
• Ina Essentials, Bioherba, Naturalico, Pharmanova, Bulgarian Rose
• Gymbeam, Myprotein, iHerb, Superlab, аптечни вериги

== ТВОИТЕ ИНСТРУМЕНТИ ==
Разполагаш с инструменти за достъп до РЕАЛНИ бизнес данни:
• get_sales — продажби, поръчки, AOV (Shopify)
• get_product_analytics — продуктов анализ с период
• get_traffic — трафик канали, страници, устройства (GA4)
• get_email — имейл кампании, flows, приходи (Klaviyo)
• get_ads_overview — рекламен обзор, кампании, фуния (Meta Ads)
• get_ads_detail — детайлни реклами със scores
• web_search — реално търсене в интернет

== ПРАВИЛА ==
1. Отговаряй САМО на български
2. ВИНАГИ използвай инструментите за актуални данни — НИКОГА не измисляй числа
3. Цитирай КОНКРЕТНИ метрики от данните (числа, проценти, имена)
4. При въпроси, които изискват повече контекст — извикай няколко инструмента
5. Бъди директен — без маркетинг говор, без общи приказки
6. Структурирай с ясни заглавия (##)
7. ВИНАГИ завършвай с раздел "## ▶ Препоръки" с 2-3 конкретни действия
8. При въпроси за конкуренти или тенденции, търси РЕАЛНО в интернет`;

// ---- Tool execution ----

async function executeTool(
  name: string,
  input: Record<string, string>,
  baseUrl: string
): Promise<string> {
  try {
    switch (name) {
      case "get_sales": {
        const [kpis, products] = await Promise.all([
          fetch(`${baseUrl}/api/dashboard/kpis`).then((r) => r.json()),
          fetch(`${baseUrl}/api/dashboard/top-products`).then((r) => r.json()),
        ]);
        return JSON.stringify({ kpis, topProducts: products });
      }
      case "get_product_analytics": {
        const now = new Date();
        const from = input.from || new Date(now.getTime() - 30 * 86400000).toISOString().split("T")[0];
        const to = input.to || now.toISOString().split("T")[0];
        const data = await fetch(`${baseUrl}/api/dashboard/products-analytics?from=${from}&to=${to}`).then((r) => r.json());
        return JSON.stringify(data);
      }
      case "get_traffic": {
        const data = await fetch(`${baseUrl}/api/dashboard/traffic`).then((r) => r.json());
        return JSON.stringify(data);
      }
      case "get_email": {
        const period = input.period || "30d";
        const data = await fetch(`${baseUrl}/api/dashboard/email?preset=${period}`).then((r) => r.json());
        return JSON.stringify(data);
      }
      case "get_ads_overview": {
        const period = input.period || "7d";
        const data = await fetch(`${baseUrl}/api/dashboard/ads?preset=${period}`).then((r) => r.json());
        return JSON.stringify(data);
      }
      case "get_ads_detail": {
        const period = input.period || "7d";
        const data = await fetch(`${baseUrl}/api/dashboard/ads/individual?preset=${period}`).then((r) => r.json());
        return JSON.stringify(data);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: `Tool execution failed: ${String(err)}` });
  }
}

// ---- SSE helpers ----

function sseChunk(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// ---- Streaming response parser ----

interface ContentBlock {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface StreamResult {
  contentBlocks: ContentBlock[];
  stopReason: string;
}

async function streamClaudeResponse(
  apiKey: string,
  messages: ContentBlock[],
  send: (data: object) => void
): Promise<StreamResult> {
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      stream: true,
      system: SYSTEM_PROMPT,
      messages,
      tools: [
        ...CUSTOM_TOOLS.map((t) => ({ type: "custom" as const, ...t })),
        WEB_SEARCH_TOOL,
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text();
    throw new Error(`Claude API: ${anthropicRes.status} — ${err}`);
  }

  const reader = anthropicRes.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const blockTypes: Record<number, string> = {};
  const blockAccumulator: Record<number, string> = {};
  const blockNames: Record<number, string> = {};
  const blockIds: Record<number, string> = {};
  const contentBlocks: ContentBlock[] = [];
  let stopReason = "end_turn";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const rawData = line.slice(6);
      if (rawData === "[DONE]") continue;

      let evt: Record<string, unknown>;
      try { evt = JSON.parse(rawData); } catch { continue; }
      const evtType = evt.type as string;

      // Content block start
      if (evtType === "content_block_start") {
        const idx = evt.index as number;
        const block = evt.content_block as Record<string, unknown>;
        const blockType = block.type as string;
        blockTypes[idx] = blockType;
        blockAccumulator[idx] = "";

        if (blockType === "tool_use") {
          blockNames[idx] = block.name as string;
          blockIds[idx] = block.id as string;
          const label = TOOL_LABELS[block.name as string];
          if (label) {
            send({ t: "tool", name: block.name, label });
            send({ t: "status", msg: `Зареждам: ${label}...` });
          } else if (block.name === "web_search") {
            send({ t: "status", msg: "Търся в интернет..." });
          }
        }
      }

      // Content block delta
      if (evtType === "content_block_delta") {
        const idx = evt.index as number;
        const delta = evt.delta as Record<string, unknown>;
        const blockType = blockTypes[idx];

        if (blockType === "text" && delta.type === "text_delta") {
          send({ t: "text", d: delta.text as string });
        }
        if (blockType === "tool_use" && delta.type === "input_json_delta") {
          blockAccumulator[idx] = (blockAccumulator[idx] || "") + ((delta.partial_json as string) || "");
        }
        if (blockType === "tool_result" && delta.type === "text_delta") {
          blockAccumulator[idx] = (blockAccumulator[idx] || "") + ((delta.text as string) || "");
        }
      }

      // Content block stop
      if (evtType === "content_block_stop") {
        const idx = evt.index as number;
        const blockType = blockTypes[idx];
        const accumulated = blockAccumulator[idx] || "";

        if (blockType === "text") {
          contentBlocks.push({ type: "text", text: accumulated });
        }

        if (blockType === "tool_use") {
          let input = {};
          try { input = JSON.parse(accumulated); } catch { /* empty input */ }

          const toolName = blockNames[idx];
          if (toolName === "web_search") {
            const searchInput = input as Record<string, string>;
            if (searchInput.query) send({ t: "search", q: searchInput.query });
          }

          contentBlocks.push({
            type: "tool_use",
            id: blockIds[idx],
            name: toolName,
            input,
          });
        }

        if (blockType === "tool_result") {
          try {
            const results = JSON.parse(accumulated);
            if (Array.isArray(results)) {
              const sources = results
                .filter((r: Record<string, unknown>) => r.type === "web_search_result" || r.url)
                .slice(0, 5)
                .map((r: Record<string, unknown>) => ({
                  title: (r.title as string) || (r.url as string) || "",
                  url: (r.url as string) || "",
                }));
              if (sources.length > 0) send({ t: "sources", results: sources });
            }
          } catch { /* ignore */ }
        }
      }

      // Message delta with stop reason
      if (evtType === "message_delta") {
        const delta = evt.delta as Record<string, unknown>;
        if (delta.stop_reason) stopReason = delta.stop_reason as string;
      }
    }
  }

  return { contentBlocks, stopReason };
}

// ---- Main route ----

export async function POST(req: NextRequest) {
  const { messages: clientMessages } = (await req.json()) as {
    messages: { role: string; content: string }[];
  };

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return new Response("CLAUDE_API_KEY not configured", { status: 500 });
  }

  const baseUrl = req.nextUrl.origin;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseChunk(data));

      try {
        // Build message history
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messages: any[] = clientMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const MAX_TOOL_ROUNDS = 5;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const result = await streamClaudeResponse(apiKey, messages, send);

          if (result.stopReason === "end_turn" || result.stopReason !== "tool_use") {
            break;
          }

          // Tool use round — execute custom tools
          const toolUseBlocks = result.contentBlocks.filter((b) => b.type === "tool_use");
          const customToolUses = toolUseBlocks.filter(
            (b) => b.name !== "web_search" && TOOL_LABELS[b.name]
          );

          if (customToolUses.length === 0) break;

          // Execute all tools in parallel
          const toolResults = await Promise.all(
            customToolUses.map(async (toolUse) => {
              const toolResult = await executeTool(toolUse.name, toolUse.input || {}, baseUrl);
              return {
                type: "tool_result" as const,
                tool_use_id: toolUse.id,
                content: toolResult,
              };
            })
          );

          // Append assistant turn + tool results for next round
          messages.push({ role: "assistant", content: result.contentBlocks });
          messages.push({ role: "user", content: toolResults });
        }

        send({ t: "done" });
      } catch (err) {
        send({ t: "error", msg: `Грешка: ${String(err)}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
