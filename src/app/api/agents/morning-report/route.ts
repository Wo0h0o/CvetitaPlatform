import { NextRequest, NextResponse } from "next/server";
import { fetchBusinessContext, formatContextForPrompt } from "@/lib/agent-context";
import { getUserContext } from "@/lib/user-role";
import { rateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sofiaDate } from "@/lib/sofia-date";
import { logger } from "@/lib/logger";

export const maxDuration = 120;

function buildPrompt(businessContext: string): string {
  const today = new Date().toLocaleDateString("bg-BG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Sofia" });

  return `Ти си старши бизнес анализатор на Цветита Хербал — водеща българска марка за хранителни добавки с 15 години история, собствено производство и над 1 милион клиенти.

${businessContext}

Генерирай СУТРЕШЕН ДОКЛАД за ${today}. Базирай го ИЗЦЯЛО на реалните данни по-горе.

Структура (спазвай точно):

## Обзор
Кратко резюме на бизнеса в 2-3 изречения. Общ приход, поръчки, рекламен ROAS.

## Продажби
Анализ на ВЧЕРАШНИТЕ Shopify данни — приходи, AOV, топ продукти. Сравни с очакванията (среден дневен приход ~364 EUR).

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

/**
 * GET — today's cached report, or { report: null } if none exists yet.
 *
 * Degrades gracefully: if the morning_reports table has not been migrated
 * yet (or the query fails), this returns { report: null } so the page just
 * falls back to generating a fresh one — no crash.
 */
export async function GET(req: NextRequest) {
  const userCtx = await getUserContext(req);
  if (!userCtx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("morning_reports")
    .select("content, data_snapshot, created_at")
    .eq("organization_id", userCtx.organizationId)
    .eq("report_date", sofiaDate())
    .maybeSingle();

  if (error) {
    // Table missing / transient — treat as cache miss, never block the page.
    logger.error("morning report cache read failed", { error: error.message });
    return NextResponse.json({ report: null });
  }

  return NextResponse.json({ report: data ?? null });
}

export async function POST(req: NextRequest) {
  const userCtx = await getUserContext(req);
  if (!userCtx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimit(req, { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return new Response("CLAUDE_API_KEY not configured", { status: 500 });
  }

  const baseUrl = req.nextUrl.origin;
  const cookie = req.headers.get("cookie") || "";

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseChunk(data));
      let fullText = "";

      try {
        send({ t: "status", msg: "Зареждам бизнес данните..." });

        const ctx = await fetchBusinessContext(baseUrl, { shopifyDay: "yesterday", cookie });
        const businessContext = formatContextForPrompt(ctx, { shopifyLabel: "продажби вчера" });
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
                fullText += evt.delta.text;
                send({ t: "text", d: evt.delta.text });
              }
            } catch { /* skip */ }
          }
        }

        // Persist once per Sofia day so subsequent opens load instantly and
        // for free. Failure here never reaches the user — they already have
        // the streamed report; the cache is the only thing lost.
        if (fullText.trim()) {
          const { error: persistErr } = await supabaseAdmin
            .from("morning_reports")
            .upsert(
              {
                organization_id: userCtx.organizationId,
                report_date: sofiaDate(),
                content: fullText,
                data_snapshot: ctx,
              },
              { onConflict: "organization_id,report_date" }
            );
          if (persistErr) {
            logger.error("morning report persist failed", { error: persistErr.message });
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
