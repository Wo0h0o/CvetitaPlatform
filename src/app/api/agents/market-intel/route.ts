import { NextRequest } from "next/server";
import { fetchBusinessContext, formatContextForPrompt } from "@/lib/agent-context";

export const maxDuration = 60;

// Anthropic's built-in web search tool — no external API needed
// Docs: https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
};

function buildSystemPrompt(businessContext: string): string {
  return `Ти си Пазарен Разузнавач — специализиран AI агент на Цветита Хербал.

== КОМПАНИЯТА ==
Цветита Хербал е водеща българска марка за хранителни добавки:
• 15 години на пазара
• Над 1 милион доволни клиенти
• Собствено българско производство
• Онлайн магазин, доставки в България и ЕС
• Валута: EUR

${businessContext}

== КОНКУРЕНТИ (БГ пазар) ==
• Ina Essentials — етерични масла, козметика, натурална козметика
• Bioherba — билки, фитотерапия, традиционни добавки
• Naturalico — спортни добавки, протеини, витамини
• Pharmanova — фармацевтични добавки, масов пазар
• Bulgarian Rose — розово масло, козметика с локален произход

== ТВОЯТА МИСИЯ ==
Анализираш пазара на хранителни добавки и помагаш за вземане на по-добри бизнес решения.
Разполагаш с инструмент за РЕАЛНО търсене в интернет — използвай го АКТИВНО за всичко актуално.

== ПРАВИЛА ==
1. Отговаряй САМО на български
2. Търси в интернет за ВСИЧКО, което изисква актуални данни — цени, новини, конкуренти, тенденции
3. Подкрепяй твърденията с конкретни данни от търсенето или от бизнес контекста
4. Бъди директен — без маркетинг говор, без общи приказки
5. Структурирай с ясни заглавия (##)
6. Когато цитираш конкурент или тенденция, посочи откъде идва информацията
7. ВИНАГИ завършвай с раздел "## ▶ Следващи стъпки" с 3 конкретни, приложими действия за Цветита Хербал`;
}

function sseChunk(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as {
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
        // 1. Fetch business context
        send({ t: "status", msg: "Зареждам бизнес данните..." });
        const ctx = await fetchBusinessContext(baseUrl);
        const systemPrompt = buildSystemPrompt(formatContextForPrompt(ctx));

        send({ t: "status", msg: "Свързвам се с агента..." });

        // 2. Call Anthropic API with streaming + built-in web search
        const anthropicRes = await fetch(
          "https://api.anthropic.com/v1/messages",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "anthropic-beta": "web-search-2025-03-05",
            },
            body: JSON.stringify({
              model: "claude-opus-4-6",
              max_tokens: 4000,
              stream: true,
              system: systemPrompt,
              messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              tools: [WEB_SEARCH_TOOL],
            }),
          }
        );

        if (!anthropicRes.ok) {
          const err = await anthropicRes.text();
          send({
            t: "error",
            msg: `Claude API грешка: ${anthropicRes.status} — ${err}`,
          });
          controller.close();
          return;
        }

        // 3. Parse the streaming SSE response from Anthropic
        const reader = anthropicRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Track content blocks by index
        const blockTypes: Record<number, string> = {};
        const blockAccumulator: Record<number, string> = {};
        let currentSearchQuery = "";

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
            try {
              evt = JSON.parse(rawData);
            } catch {
              continue;
            }

            const evtType = evt.type as string;

            // New content block starting
            if (evtType === "content_block_start") {
              const idx = evt.index as number;
              const block = evt.content_block as Record<string, unknown>;
              const blockType = block.type as string;
              blockTypes[idx] = blockType;
              blockAccumulator[idx] = "";

              if (blockType === "tool_use" && block.name === "web_search") {
                send({ t: "status", msg: "Търся в интернет..." });
              }
            }

            // Content block delta
            if (evtType === "content_block_delta") {
              const idx = evt.index as number;
              const delta = evt.delta as Record<string, unknown>;
              const blockType = blockTypes[idx];

              // Text streaming
              if (blockType === "text" && delta.type === "text_delta") {
                const text = delta.text as string;
                send({ t: "text", d: text });
              }

              // Tool use input accumulation (web_search query)
              if (blockType === "tool_use" && delta.type === "input_json_delta") {
                blockAccumulator[idx] =
                  (blockAccumulator[idx] || "") +
                  ((delta.partial_json as string) || "");
              }

              // Tool result content accumulation (search results)
              if (blockType === "tool_result" && delta.type === "text_delta") {
                blockAccumulator[idx] =
                  (blockAccumulator[idx] || "") + ((delta.text as string) || "");
              }
            }

            // Content block complete
            if (evtType === "content_block_stop") {
              const idx = evt.index as number;
              const blockType = blockTypes[idx];
              const accumulated = blockAccumulator[idx] || "";

              // Extract and emit the search query
              if (blockType === "tool_use") {
                try {
                  const input = JSON.parse(accumulated);
                  currentSearchQuery = input.query || "";
                  if (currentSearchQuery) {
                    send({ t: "search", q: currentSearchQuery });
                  }
                } catch {
                  // ignore parse errors
                }
              }

              // Extract sources from tool_result
              if (blockType === "tool_result") {
                try {
                  // Anthropic web search results come as JSON array
                  const results = JSON.parse(accumulated);
                  if (Array.isArray(results)) {
                    const sources = results
                      .filter(
                        (r: Record<string, unknown>) =>
                          r.type === "web_search_result" || r.url
                      )
                      .slice(0, 5)
                      .map((r: Record<string, unknown>) => ({
                        title: (r.title as string) || (r.url as string) || "",
                        url: (r.url as string) || "",
                      }));
                    if (sources.length > 0) {
                      send({ t: "sources", results: sources });
                    }
                  }
                } catch {
                  // Tool result might not be JSON — ignore
                }
              }
            }

            // Message complete
            if (evtType === "message_stop") {
              send({ t: "done" });
            }
          }
        }

        // Ensure done is sent
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
