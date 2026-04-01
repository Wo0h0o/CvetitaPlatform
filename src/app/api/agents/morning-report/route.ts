import { NextRequest } from "next/server";
import { fetchBusinessContext, formatContextForPrompt } from "@/lib/agent-context";

export const maxDuration = 30;

function buildPrompt(businessContext: string): string {
  const today = new Date().toLocaleDateString("bg-BG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return `Ти си старши бизнес анализатор на Цветита Хербал — водеща българска марка за хранителни добавки с 15 години история, собствено производство и над 1 милион клиенти.

${businessContext}

Генерирай СУТРЕШЕН ДОКЛАД за ${today}. Базирай го ИЗЦЯЛО на реалните данни по-горе.

Структура (спазвай точно):

## Обзор
Кратко резюме на бизнеса в 2-3 изречения. Общ приход, поръчки, рекламен ROAS.

## Продажби
Анализ на Shopify данните — приходи, AOV, топ продукти. Сравни с очакванията.

## Реклама
Meta Ads performance — spend, ROAS, CPA. Кои кампании работят, кои не. Фуния анализ — къде се губят хората.

## Трафик
GA4 канали — кой канал носи най-много, engagement rate, конверсии. Устройства.

## Имейли
Klaviyo performance — приход от имейли, open/click rates, топ flows.

## Притеснения
2-3 неща, които изискват внимание (ниски метрики, аномалии, рискове).

## ▶ 3 Действия за днес
Конкретни, приложими стъпки с обяснение ЗАЩО. Базирай ги на данните.

ПРАВИЛА:
- Отговаряй САМО на български
- Цитирай КОНКРЕТНИ числа от данните
- Бъди директен — без маркетинг говор
- Ако някои данни липсват, посочи го`;
}

function sseChunk(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return new Response("CLAUDE_API_KEY not configured", { status: 500 });
  }

  const baseUrl = req.nextUrl.origin;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseChunk(data));

      try {
        send({ t: "status", msg: "Зареждам бизнес данните..." });

        const ctx = await fetchBusinessContext(baseUrl);
        const businessContext = formatContextForPrompt(ctx);
        const prompt = buildPrompt(businessContext);

        send({ t: "status", msg: "Генерирам сутрешния доклад..." });

        const anthropicRes = await fetch(
          "https://api.anthropic.com/v1/messages",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 8192,
              stream: true,
              messages: [{ role: "user", content: prompt }],
            }),
          }
        );

        if (!anthropicRes.ok) {
          const err = await anthropicRes.text();
          send({ t: "error", msg: `Claude API грешка: ${anthropicRes.status} — ${err}` });
          controller.close();
          return;
        }

        const reader = anthropicRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

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

            try {
              const evt = JSON.parse(rawData);
              if (evt.type === "content_block_delta" && evt.delta?.text) {
                send({ t: "text", d: evt.delta.text });
              }
              if (evt.type === "message_stop") {
                send({ t: "done" });
              }
            } catch { /* skip */ }
          }
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
