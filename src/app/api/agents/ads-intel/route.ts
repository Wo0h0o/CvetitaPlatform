import { NextRequest } from "next/server";
import { fetchBusinessContext, formatContextForPrompt } from "@/lib/agent-context";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  getMetaOverview,
  getMetaCampaignInsights,
  getMetaAdInsights,
  getMetaAdCreatives,
  getMetaAdSetInsights,
  fetchAdSetsMeta,
  actionVal,
} from "@/lib/meta";
import type { MetaAdSetInsightRow } from "@/lib/meta";
import { parseAdRow, scoreAd, computeAccountMeans } from "@/lib/meta-scoring";

export const maxDuration = 60;

const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
};

interface AdsOverview {
  spend: number; revenue: number; roas: number; purchases: number; cpa: number;
  ctr: number; impressions: number; linkClicks: number; landingPageViews: number;
  addToCart: number; initiateCheckout: number;
}

interface Campaign {
  name: string; status: string; spend: number; revenue: number; roas: number; purchases: number;
}

interface AdItem {
  name: string; campaignName: string; adsetName: string; status: string; isVideo: boolean;
  spend: number; revenue: number; roas: number; purchases: number; cpa: number;
  ctr: number; cvr: number; frequency: number; score: number;
  scoreBreakdown: { hook: number; engage: number; convert: number; freshness: number };
}

interface AccountAverages {
  roas: number; cpa: number; ctr: number; cvr: number; frequency: number;
}

function buildAdsContext(
  overview: AdsOverview,
  campaigns: Campaign[],
  ads: AdItem[],
  averages: AccountAverages
): string {
  const fmt = (n: number) => n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtI = (n: number) => Math.round(n).toLocaleString("bg-BG");

  const lines: string[] = [
    "=== META ADS ДАННИ (последните 7 дни) ===",
    "",
    "OVERVIEW:",
    `  Spend: ${fmt(overview.spend)} EUR | Revenue: ${fmt(overview.revenue)} EUR | ROAS: ${fmt(overview.roas)}x`,
    `  Покупки: ${fmtI(overview.purchases)} | CPA: ${fmt(overview.cpa)} EUR | CTR: ${fmt(overview.ctr)}%`,
    "",
    "РЕКЛАМНА ФУНИЯ:",
    `  Impressions: ${fmtI(overview.impressions)}`,
    `  → Link Clicks: ${fmtI(overview.linkClicks)} (${overview.impressions > 0 ? ((overview.linkClicks / overview.impressions) * 100).toFixed(1) : 0}%)`,
    `  → Landing Pages: ${fmtI(overview.landingPageViews)} (${overview.linkClicks > 0 ? ((overview.landingPageViews / overview.linkClicks) * 100).toFixed(1) : 0}%)`,
    `  → Add to Cart: ${fmtI(overview.addToCart)} (${overview.landingPageViews > 0 ? ((overview.addToCart / overview.landingPageViews) * 100).toFixed(1) : 0}%)`,
    `  → Checkout: ${fmtI(overview.initiateCheckout)} (${overview.addToCart > 0 ? ((overview.initiateCheckout / overview.addToCart) * 100).toFixed(1) : 0}%)`,
    `  → Purchases: ${fmtI(overview.purchases)} (${overview.initiateCheckout > 0 ? ((overview.purchases / overview.initiateCheckout) * 100).toFixed(1) : 0}%)`,
    "",
    "СРЕДНИ СТОЙНОСТИ НА АКАУНТА:",
    `  ROAS: ${fmt(averages.roas)}x | CPA: ${fmt(averages.cpa)} EUR | CTR: ${fmt(averages.ctr)}% | CVR: ${fmt(averages.cvr)}% | Frequency: ${fmt(averages.frequency)}`,
    "",
  ];

  // Campaigns
  if (campaigns.length > 0) {
    lines.push("КАМПАНИИ:");
    campaigns.forEach((c) => {
      lines.push(`  [${c.status}] ${c.name}: spend ${fmt(c.spend)} EUR, revenue ${fmt(c.revenue)} EUR, ROAS ${fmt(c.roas)}x, ${fmtI(c.purchases)} покупки`);
    });
    lines.push("");
  }

  // Top ads
  const sorted = [...ads].sort((a, b) => b.score - a.score);
  const top5 = sorted.slice(0, 5);
  const bottom5 = sorted.slice(-5).reverse();

  if (top5.length > 0) {
    lines.push("ТОП 5 РЕКЛАМИ (по score):");
    top5.forEach((a) => {
      const type = a.isVideo ? "Video" : "Image";
      lines.push(`  Score ${a.score} [${a.status}] [${type}] "${a.name}" (${a.campaignName})`);
      lines.push(`    Spend: ${fmt(a.spend)} EUR, Revenue: ${fmt(a.revenue)} EUR, ROAS: ${fmt(a.roas)}x, CTR: ${fmt(a.ctr)}%, CPA: ${fmt(a.cpa)} EUR, Freq: ${fmt(a.frequency)}`);
      lines.push(`    Diagnostics: Hook=${a.scoreBreakdown.hook}, Engage=${a.scoreBreakdown.engage}, Convert=${a.scoreBreakdown.convert}, Freshness=${a.scoreBreakdown.freshness}`);
    });
    lines.push("");
  }

  if (bottom5.length > 0 && ads.length > 5) {
    lines.push("ДЪНО 5 РЕКЛАМИ (по score):");
    bottom5.forEach((a) => {
      const type = a.isVideo ? "Video" : "Image";
      lines.push(`  Score ${a.score} [${a.status}] [${type}] "${a.name}" (${a.campaignName})`);
      lines.push(`    Spend: ${fmt(a.spend)} EUR, Revenue: ${fmt(a.revenue)} EUR, ROAS: ${fmt(a.roas)}x, CTR: ${fmt(a.ctr)}%, CPA: ${fmt(a.cpa)} EUR, Freq: ${fmt(a.frequency)}`);
      lines.push(`    Diagnostics: Hook=${a.scoreBreakdown.hook}, Engage=${a.scoreBreakdown.engage}, Convert=${a.scoreBreakdown.convert}, Freshness=${a.scoreBreakdown.freshness}`);
    });
    lines.push("");
  }

  // Video vs Image comparison
  const videoAds = ads.filter((a) => a.isVideo);
  const imageAds = ads.filter((a) => !a.isVideo);
  if (videoAds.length > 0 && imageAds.length > 0) {
    const avgScore = (arr: AdItem[]) => arr.reduce((s, a) => s + a.score, 0) / arr.length;
    const avgCtr = (arr: AdItem[]) => arr.reduce((s, a) => s + a.ctr, 0) / arr.length;
    const avgRoas = (arr: AdItem[]) => {
      const totalSpend = arr.reduce((s, a) => s + a.spend, 0);
      const totalRev = arr.reduce((s, a) => s + a.revenue, 0);
      return totalSpend > 0 ? totalRev / totalSpend : 0;
    };
    lines.push("VIDEO vs IMAGE СРАВНЕНИЕ:");
    lines.push(`  Video (${videoAds.length} бр.): avg score ${avgScore(videoAds).toFixed(0)}, avg CTR ${avgCtr(videoAds).toFixed(2)}%, ROAS ${avgRoas(videoAds).toFixed(2)}x`);
    lines.push(`  Image (${imageAds.length} бр.): avg score ${avgScore(imageAds).toFixed(0)}, avg CTR ${avgCtr(imageAds).toFixed(2)}%, ROAS ${avgRoas(imageAds).toFixed(2)}x`);
    lines.push("");
  }

  lines.push(`Общо реклами: ${ads.length} (Active: ${ads.filter((a) => a.status === "ACTIVE").length}, Paused: ${ads.filter((a) => a.status === "PAUSED").length})`);

  return lines.join("\n");
}

function buildSystemPrompt(adsContext: string, businessContext: string): string {
  return `Ти си Рекламен Стратег — специализиран AI агент на Цветита Хербал за анализ и оптимизация на рекламни кампании.

== КОМПАНИЯТА ==
Цветита Хербал е водеща българска марка за хранителни добавки:
• 15 години на пазара, над 1 милион клиенти
• Собствено българско производство
• Онлайн магазин, доставки в България и ЕС
• Валута: EUR
• Месечен рекламен бюджет: над 15 000 лв (Meta Ads)

${adsContext}

${businessContext}

== SCORING СИСТЕМА v2 (Bayesian) ==
Всяка реклама получава 4 ДИАГНОСТИЧНИ ОЦЕНКИ + 1 ОБЩА:

ДИАГНОСТИКИ (казват КЪДЕ е проблемът):
• Hook (15%) — грабва ли вниманието? CTR нормализиран по тип (video vs static имат различни benchmark-ове)
• Engage/Фуния (15%) — LP→ATC→Checkout→Purchase drop-off rates. Показва къде се губят хората
• Convert/Конверсия (45%) — приход с Bayesian shrinkage (ROAS се дърпа към средното при малко данни) + CPA ефективност
• Freshness/Свежест (25%) — impression-based decay по формулата на Meta (N+1)^(-0.43) + frequency penalty

ОБЩА ОЦЕНКА: weighted composite × confidence (пълен confidence чак при 30 конверсии)

DATA GATES: Реклами с <5 конверсии, <2000 impressions или <€20 spend получават статус "Gathering Data" вместо score.

BAYESIAN SHRINKAGE: Реклама с 2 конверсии и ROAS 8x → Adjusted ROAS ~2.5x (дърпа се към средното). Реклама с 100 конверсии и ROAS 3x → Adjusted ROAS ~2.95x (запазва си стойността).

Score под 40 = слаба. Score над 70 = силна. null = недостатъчно данни.

== ТВОЯТА МИСИЯ ==
Анализираш рекламните данни и даваш конкретни, приложими препоръки за оптимизация.
Разполагаш с инструмент за РЕАЛНО търсене в интернет — използвай го за конкурентно проучване на реклами.

== ПРАВИЛА ==
1. Отговаряй САМО на български
2. Базирай всичко на РЕАЛНИТЕ данни по-горе — цитирай конкретни числа
3. Когато препоръчваш pause/scale, посочвай ТОЧНО коя реклама/кампания
4. Обяснявай ЗАЩО нещо работи или не работи (score breakdown)
5. Сравнявай с account averages — "CTR 2.1% е над средните 1.4%"
6. Анализирай фунията — къде точно се губят хората
7. При въпроси за конкуренти, търси реално в интернет
8. ВИНАГИ завършвай с раздел "## ▶ Действия" с 3 конкретни стъпки`;
}

function sseChunk(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const limited = rateLimit(req, { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const { messages } = (await req.json()) as {
    messages: { role: string; content: string }[];
  };

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return new Response("CLAUDE_API_KEY not configured", { status: 500 });
  }

  const baseUrl = req.nextUrl.origin;
  const cookie = req.headers.get("cookie") || "";

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseChunk(data));

      try {
        // 1. Fetch ads data + business context in parallel
        send({ t: "status", msg: "Зареждам рекламните данни..." });

        if (!process.env.META_ACCESS_TOKEN) {
          send({ t: "error", msg: "Meta Ads не е конфигуриран. Добави META_ACCESS_TOKEN в настройките." });
          controller.close();
          return;
        }

        // Call Meta API directly (no self-referential HTTP — avoids cold start timeouts)
        // fetchBusinessContext is fire-and-forget — it makes self-referential HTTP calls
        // that may timeout, but we don't want it to block Meta data loading
        const ctxPromise = fetchBusinessContext(baseUrl, { cookie }).catch(() => null);

        const [overview, campaigns, adRows, adSetRows, adSetsMeta] = await Promise.all([
          getMetaOverview("last_7d"),
          getMetaCampaignInsights("last_7d"),
          getMetaAdInsights("last_7d"),
          getMetaAdSetInsights("last_7d"),
          fetchAdSetsMeta(),
        ]);

        // Await business context after Meta data is ready (may be null if timed out)
        const ctx = await ctxPromise;

        // Score ads
        const parsedAds = adRows.map(parseAdRow);
        const means = computeAccountMeans(parsedAds);
        const adIds = parsedAds.map((a) => a.id).filter(Boolean);
        const creatives = await getMetaAdCreatives(adIds);

        const scoredAds = parsedAds.map((ad) => {
          const creative = creatives.get(ad.id);
          const isVideo = creative?.isVideo || false;
          const scoring = scoreAd(ad, isVideo, { roas: means.roas, cpa: means.cpa });
          return {
            ...ad,
            status: creative?.effective_status || "UNKNOWN",
            isVideo,
            score: scoring.score ?? 0,
            scoringStatus: scoring.status,
            scoreBreakdown: scoring.scoreBreakdown,
          };
        }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

        const accountAverages = {
          roas: Math.round(means.roas * 100) / 100,
          cpa: Math.round(means.cpa * 100) / 100,
          ctr: Math.round(means.ctr * 100) / 100,
          cvr: Math.round(means.cvr * 100) / 100,
          frequency: Math.round(means.frequency * 100) / 100,
        };

        // Parse ad sets
        const adSetMetaMap = new Map(adSetsMeta.map((m) => [m.id, m]));
        const parseAdSetRow = (r: MetaAdSetInsightRow) => {
          const spend = parseFloat(r.spend);
          const revenue = actionVal(r.action_values, "omni_purchase");
          const meta = adSetMetaMap.get(r.adset_id || "");
          const dailyBudget = meta?.daily_budget ? parseFloat(meta.daily_budget) / 100 : null;
          const lifetimeBudget = meta?.lifetime_budget ? parseFloat(meta.lifetime_budget) / 100 : null;
          return {
            name: r.adset_name || "Unknown",
            campaignName: r.campaign_name || "",
            status: meta?.effective_status || "UNKNOWN",
            spend,
            revenue,
            roas: spend > 0 ? revenue / spend : 0,
            frequency: parseFloat(r.frequency || "0"),
            budget: dailyBudget ? `€${dailyBudget.toFixed(2)}/day` : lifetimeBudget ? `€${lifetimeBudget.toFixed(2)} lifetime` : "—",
          };
        };
        const adsets = adSetRows.map(parseAdSetRow).sort((a, b) => b.spend - a.spend);

        const adsContext = buildAdsContext(
          { ...overview, cpa: overview.cpa ?? 0 } as AdsOverview,
          campaigns,
          scoredAds as AdItem[],
          accountAverages
        );

        const ads = scoredAds as AdItem[];
        let adsetContext = "";
        if (adsets.length > 0) {
          const fmt2 = (n: number) => n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const lines: string[] = ["", "AD SETS (йерархия Campaign → Ad Set → Ads):"];
          for (const adset of adsets.slice(0, 15)) {
            const adsetAds = ads.filter((a: AdItem) => a.adsetName === adset.name);
            const activeAds = adsetAds.filter((a: AdItem) => a.status === "ACTIVE").length;
            const pausedAds = adsetAds.filter((a: AdItem) => a.status !== "ACTIVE").length;
            lines.push(`  [${adset.status}] "${adset.name}" (${adset.campaignName})`);
            lines.push(`    Budget: ${adset.budget} | Spend: ${fmt2(adset.spend)} EUR | Revenue: ${fmt2(adset.revenue)} EUR | ROAS: ${fmt2(adset.roas)}x | Freq: ${fmt2(adset.frequency)}`);
            lines.push(`    Реклами: ${adsetAds.length} total (${activeAds} active, ${pausedAds} paused/other)`);
            if (adsetAds.length > 0) {
              const topAd = adsetAds.sort((a: AdItem, b: AdItem) => b.score - a.score)[0];
              const worstAd = adsetAds[adsetAds.length - 1];
              lines.push(`    Best ad: "${topAd.name}" score ${topAd.score} | Worst: "${worstAd.name}" score ${worstAd.score}`);
            }
          }
          adsetContext = lines.join("\n");
        }

        const businessContext = ctx ? formatContextForPrompt(ctx) : "(Бизнес контекстът не е достъпен в момента)";
        const systemPrompt = buildSystemPrompt(adsContext + adsetContext, businessContext);

        send({ t: "status", msg: "Анализирам рекламите..." });

        // 2. Call Claude with streaming + web search
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
              max_tokens: 16384,
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
          send({ t: "error", msg: `Claude API грешка: ${anthropicRes.status} — ${err}` });
          controller.close();
          return;
        }

        // 3. Parse streaming SSE
        const reader = anthropicRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const blockTypes: Record<number, string> = {};
        const blockAccumulator: Record<number, string> = {};

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

            if (evtType === "content_block_stop") {
              const idx = evt.index as number;
              const blockType = blockTypes[idx];
              const accumulated = blockAccumulator[idx] || "";

              if (blockType === "tool_use") {
                try {
                  const input = JSON.parse(accumulated);
                  if (input.query) send({ t: "search", q: input.query });
                } catch { /* ignore */ }
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

            if (evtType === "message_stop") {
              send({ t: "done" });
            }
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
