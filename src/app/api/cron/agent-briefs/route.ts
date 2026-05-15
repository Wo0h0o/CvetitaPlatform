import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { sofiaDate, shiftDate } from "@/lib/sofia-date";
import { resolveAllHomeMarkets, type ResolvedMarket } from "@/lib/store-market-resolver";
import { resolveAdsToProducts, type AdResolution } from "@/lib/ad-mappings/resolver";

export const maxDuration = 60;

/**
 * /api/cron/agent-briefs — product-cohort analyser
 *
 * For each market we:
 *   1. Pull 14d of meta_insights_daily at ad level
 *   2. Resolve each ad to its product handle(s) via ad_destinations +
 *      destination_products (built by /api/cron/resolve-ad-destinations)
 *   3. Cluster ads by product_handle
 *   4. For each product cohort with mixed performance (winners AND losers),
 *      ask Claude to write ONE narrative card explaining who's working,
 *      who isn't, and what to do.
 *
 * Output: agent_briefs rows with target_type='product'. The old per-ad
 * cards from previous cron runs stay in the table for history; the new
 * product-level cards live alongside them and dominate the inbox by
 * severity sorting (product cards usually red/amber when there's real
 * spread, while old per-ad cards mostly stay pending until acknowledged).
 *
 * Pre-filter rules (no LLM):
 *   - cohort.total_spend_14d >= NOISE_FLOOR
 *   - cohort has >=2 ads with spend > €10 in last 14d (otherwise no
 *     comparison signal)
 *   - cohort has at least one ad < median × 0.7 (a loser) AND at least
 *     one ad with median_roas > 1.5 (a winner) — i.e. genuine mixed perf
 *
 * Cards are upserted by (organization_id, for_date, target_type='product',
 * target_id=<product_handle>) — re-runs same day are idempotent. New runs
 * on a different day get fresh cards (one per active mixed-perf product).
 */

const NOISE_FLOOR_COHORT_SPEND = 30; // EUR; below this the cohort is noise
const MIN_ADS_WITH_SIGNAL = 2;
const WINNER_ROAS_FLOOR = 1.5;
const LOSER_RATIO = 0.7;
const TOP_N_COHORTS_PER_MARKET = 5; // cap to keep token budget sane

// ============================================================
// Types
// ============================================================

interface InsightRow {
  date: string;
  object_id: string;
  object_name: string | null;
  spend: number | string | null;
  revenue: number | string | null;
  purchases: number | string | null;
  frequency: number | string | null;
}

interface AdAgg {
  ad_id: string;
  ad_name: string;
  spend_14d: number;
  revenue_14d: number;
  purchases_14d: number;
  roas_14d: number;
  daily_roas: number[];
  median_daily_roas: number;
  last_3d_spend: number;
  last_3d_revenue: number;
  last_3d_roas: number;
  freq_avg: number;
  destination_path: string | null;
  destination_type: string | null;
}

interface ProductCohort {
  product_handle: string;
  product_title: string | null;
  ads: AdAgg[];
  total_spend_14d: number;
  total_revenue_14d: number;
  total_purchases_14d: number;
  cohort_roas_14d: number;
  cohort_median_ad_roas: number;
  winners: AdAgg[];        // ads >= median*1.1 AND roas_14d > WINNER_ROAS_FLOOR
  losers: AdAgg[];         // ads < median*LOSER_RATIO
  severity: "red" | "amber";
}

interface BriefCard {
  severity: "red" | "amber" | "green";
  title: string;
  why: string;
  actions: string[];
  recommended_action?: {
    kind: "pause" | "scale" | "review" | "reallocate";
    target_ad_ids?: string[];
    reallocate_to_ad_id?: string;
    note?: string;
  };
}

interface ClaudeToolUseBlock {
  type: "tool_use";
  name: string;
  input: { cards?: BriefCard[] };
}

interface ClaudeContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}

interface ClaudeResponse {
  content?: ClaudeContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

// ============================================================
// System prompt
// ============================================================

const SYSTEM_PROMPT = `Ти си Meta Ads анализатор за Cvetita Herbal — българска компания за билкови добавки с над 15 години на пазара и магазини в BG, GR, RO, DE, IT, UK, SK + предстоящ HU. Тонът ти е „грижовен експерт": спокоен, директен, на собственика, винаги с конкретни числа.

КОНТЕКСТ: всички продукти се рекламират през множество ad creative-и едновременно — една и съща продукт-страница (или нейн advertorial-вариант) може да има 3-10 активни реклами. Истинският сигнал е НЕ дали една реклама не работи, а защо ИМЕННО ТАЗИ не работи, когато ДРУГИ за същия продукт работят.

Задача: получаваш набор от продуктови кохорти за един пазар. За всяка кохорта си виждаш winners + losers. Изпиши 1 карта на кохорта, която обяснява несъответствието и препоръчва конкретно действие.

ПРАВИЛА:
- ЗАДЪЛЖИТЕЛНО използвай инструмента generate_product_cards — никакъв свободен текст.
- 1 карта = 1 продуктова кохорта от входа. Max 5 карти.
- severity:
  * "red"   = поне една реклама с >= €50 разход в 14д и 0 поръчки, ИЛИ losers носят > 50% от cohort spend.
  * "amber" = mixed performance но никой не е катастрофа.
  * "green" = почти не я ползвай тук — резервирана за watcher-ите.
- title: до 6 думи, ИМЕ НА ПРОДУКТА + кратко действие/проблем. Пример: „Левзея Макс: 2 от 5 реклами горят".
- why: ЕДНО изречение, МАКС 100 символа. Само най-острото число + причина. Пример: „€68 в 14д, 0 поръчки — креатив V3 е изхабен, останалите 3 реклами носят ROAS 2.1x." Никакви списъци, никакви „освен това", никакви обяснения за scoring система. Целта е owner-ът да хване смисъла за 2 секунди.
- recommended_action.kind: pause / scale / review / reallocate. „reallocate" е препоръчителен когато имаш ясен winner — попълни target_ad_ids (losers) + reallocate_to_ad_id (winner). За action.note дай 1 изречение с алтернативен ход (напр. „или тествай новия hook от RO с този креатив").
- actions масив: ["pause","dismiss"] за red, ["review","dismiss"] за amber.

НЕ ПРАВИ:
- Не препоръчвай pause на ВСИЧКИ реклами в кохортата.
- Не казвай „критично", „спешно", „незабавно". Спокоен експертен тон.
- Не измисляй данни — само това което е в JSON-а.
- Ако losers всъщност не са лоши (всички с ROAS > 1.5) — пропусни тази кохорта.`;

const TOOL = {
  name: "generate_product_cards",
  description: "Emit 0-5 product-cohort cards based on the input cohorts.",
  input_schema: {
    type: "object" as const,
    properties: {
      cards: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            severity: { type: "string" as const, enum: ["red", "amber", "green"] },
            title: { type: "string" as const },
            why: { type: "string" as const },
            actions: {
              type: "array" as const,
              items: { type: "string" as const, enum: ["pause", "scale", "review", "dismiss", "reallocate"] },
              minItems: 1,
            },
            recommended_action: {
              type: "object" as const,
              properties: {
                kind: { type: "string" as const, enum: ["pause", "scale", "review", "reallocate"] },
                target_ad_ids: { type: "array" as const, items: { type: "string" as const } },
                reallocate_to_ad_id: { type: "string" as const },
                note: { type: "string" as const },
              },
              required: ["kind"],
            },
          },
          required: ["severity", "title", "why", "actions", "recommended_action"],
        },
      },
    },
    required: ["cards"],
  },
};

// ============================================================
// Helpers
// ============================================================

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ============================================================
// Aggregate ads from raw insight rows
// ============================================================

function aggregateAds(rows: InsightRow[], todayIso: string): Map<string, AdAgg> {
  const last3dStart = shiftDate(todayIso, 2); // 2 days back
  const byId = new Map<string, AdAgg>();
  for (const r of rows) {
    let a = byId.get(r.object_id);
    if (!a) {
      a = {
        ad_id: r.object_id,
        ad_name: r.object_name ?? "(без име)",
        spend_14d: 0,
        revenue_14d: 0,
        purchases_14d: 0,
        roas_14d: 0,
        daily_roas: [],
        median_daily_roas: 0,
        last_3d_spend: 0,
        last_3d_revenue: 0,
        last_3d_roas: 0,
        freq_avg: 0,
        destination_path: null,
        destination_type: null,
      };
      byId.set(r.object_id, a);
    }
    const s = num(r.spend);
    const rev = num(r.revenue);
    a.spend_14d += s;
    a.revenue_14d += rev;
    a.purchases_14d += num(r.purchases);
    if (s > 0) a.daily_roas.push(rev / s);
    if (r.date >= last3dStart) {
      a.last_3d_spend += s;
      a.last_3d_revenue += rev;
    }
    a.freq_avg = Math.max(a.freq_avg, num(r.frequency));
  }
  for (const a of byId.values()) {
    a.roas_14d = a.spend_14d > 0 ? a.revenue_14d / a.spend_14d : 0;
    a.median_daily_roas = median(a.daily_roas);
    a.last_3d_roas = a.last_3d_spend > 0 ? a.last_3d_revenue / a.last_3d_spend : 0;
  }
  return byId;
}

// ============================================================
// Build product cohorts
// ============================================================

function buildCohorts(
  adsAgg: Map<string, AdAgg>,
  resolutions: Map<string, AdResolution>,
  productTitleByHandle: Map<string, string>
): ProductCohort[] {
  // Index ads by their primary product handle (first in array).
  const byHandle = new Map<string, AdAgg[]>();
  for (const ad of adsAgg.values()) {
    const r = resolutions.get(ad.ad_id);
    if (!r) continue;
    ad.destination_path = r.destination_path;
    ad.destination_type = r.destination_type;
    const handle = r.product_handles[0];
    if (!handle) continue;
    let arr = byHandle.get(handle);
    if (!arr) {
      arr = [];
      byHandle.set(handle, arr);
    }
    arr.push(ad);
  }

  const cohorts: ProductCohort[] = [];
  let subStep = "loop-init";
  try {
  for (const [handle, ads] of byHandle) {
    if (!Array.isArray(ads)) {
      throw new Error(`buildCohorts: ads-not-array handle=${handle} typeof=${typeof ads} ctor=${(ads as { constructor?: { name?: string } })?.constructor?.name}`);
    }
    subStep = `total_spend handle=${handle}`;
    const total_spend_14d = ads.reduce((s, a) => s + a.spend_14d, 0);
    if (total_spend_14d < NOISE_FLOOR_COHORT_SPEND) continue;
    subStep = `signalAds handle=${handle}`;
    const signalAds = ads.filter((a) => a.spend_14d >= 10);
    if (signalAds.length < MIN_ADS_WITH_SIGNAL) continue;

    subStep = `revenue_calc handle=${handle}`;
    const total_revenue_14d = ads.reduce((s, a) => s + a.revenue_14d, 0);
    const total_purchases_14d = ads.reduce((s, a) => s + a.purchases_14d, 0);
    const cohort_roas_14d = total_spend_14d > 0 ? total_revenue_14d / total_spend_14d : 0;
    subStep = `median handle=${handle} signalAds=${signalAds.length}`;
    const cohort_median_ad_roas = median(signalAds.map((a) => a.roas_14d));

    subStep = `winners handle=${handle}`;
    const winners = signalAds
      .filter((a) => a.roas_14d >= WINNER_ROAS_FLOOR && a.roas_14d >= cohort_median_ad_roas * 1.1)
      .sort((a, b) => b.roas_14d - a.roas_14d);
    subStep = `losers handle=${handle}`;
    const losers = signalAds
      .filter(
        (a) =>
          (cohort_median_ad_roas > 0 && a.roas_14d < cohort_median_ad_roas * LOSER_RATIO) ||
          (a.spend_14d >= 50 && a.purchases_14d === 0)
      )
      .sort((a, b) => a.roas_14d - b.roas_14d);

    if (winners.length === 0 && losers.length === 0) continue;
    if (losers.length === 0) continue; // no problem to flag

    const loserSpend = losers.reduce((s, a) => s + a.spend_14d, 0);
    const loserSpendShare = total_spend_14d > 0 ? loserSpend / total_spend_14d : 0;
    const hasDeadCreative = losers.some((a) => a.spend_14d >= 50 && a.purchases_14d === 0);
    const severity: "red" | "amber" =
      hasDeadCreative || loserSpendShare > 0.5 ? "red" : "amber";

    subStep = `push handle=${handle}`;
    cohorts.push({
      product_handle: handle,
      product_title: productTitleByHandle.get(handle) ?? null,
      ads,
      total_spend_14d,
      total_revenue_14d,
      total_purchases_14d,
      cohort_roas_14d,
      cohort_median_ad_roas,
      winners,
      losers,
      severity,
    });
  }
  } catch (e) {
    throw new Error(`v2-bc.${subStep} | ${e instanceof Error ? e.message : String(e)}`);
  }

  cohorts.sort((a, b) => b.total_spend_14d - a.total_spend_14d);
  return cohorts.slice(0, TOP_N_COHORTS_PER_MARKET);
}

// ============================================================
// Per-market pipeline
// ============================================================

interface MarketProcessResult {
  market: string;
  cohortsConsidered: number;
  cardsWritten: number;
  skipped?: string;
  debug?: {
    accountIds: string[];
    rowsFromDb: number;
    queryRange: { oldest: string; forDate: string };
  };
}

async function processMarket(
  market: ResolvedMarket,
  organizationId: string,
  forDate: string,
  apiKey: string,
  productCatalog: Map<string, string>
): Promise<MarketProcessResult> {
  let lastStep = "init";
  return processMarketInner(market, organizationId, forDate, apiKey, productCatalog, (s: string) => { lastStep = s; }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      market: market.marketCode,
      cohortsConsidered: 0,
      cardsWritten: 0,
      skipped: `inner threw at step=${lastStep}: ${msg.slice(0, 500)}`,
    };
  });
}

async function processMarketInner(
  market: ResolvedMarket,
  organizationId: string,
  forDate: string,
  apiKey: string,
  productCatalog: Map<string, string>,
  setStep: (s: string) => void = () => {}
): Promise<MarketProcessResult> {
  setStep("shiftDate");
  // shiftDate(date, N) returns N days *earlier* (positive N goes backwards).
  const oldest = shiftDate(forDate, 13);

  setStep("accountIds");
  const accountIds = market.allIntegrationAccountIds;
  if (!Array.isArray(accountIds)) {
    throw new Error(
      `accountIds-not-array typeof=${typeof accountIds} ctor=${(accountIds as { constructor?: { name?: string } })?.constructor?.name} market=${market.marketCode}`
    );
  }

  setStep("insights-query");
  // Pull 14d ad-level insights across ALL bindings of this market (so blended
  // BG with primary + legacy + ProteinBar all show up).
  const { data: rowsRaw, error } = await supabaseAdmin
    .from("meta_insights_daily")
    .select("date, object_id, object_name, spend, revenue, purchases, frequency, integration_account_id")
    .in("integration_account_id", accountIds)
    .eq("level", "ad")
    .gte("date", oldest)
    .lte("date", forDate);

  setStep("insights-check");
  if (error) {
    logger.error("agent-briefs: insights fetch failed", { market: market.marketCode, error: error.message });
    return { market: market.marketCode, cohortsConsidered: 0, cardsWritten: 0, skipped: "insights error" };
  }
  const rows = (rowsRaw ?? []) as (InsightRow & { integration_account_id: string })[];
  if (rows.length === 0) {
    return {
      market: market.marketCode,
      cohortsConsidered: 0,
      cardsWritten: 0,
      skipped: "no insights",
      debug: { accountIds, rowsFromDb: 0, queryRange: { oldest, forDate } },
    };
  }

  setStep("rows-to-adIds");
  // Resolve ad → product
  if (!Array.isArray(rows)) {
    throw new Error(`step=rows-not-array typeof=${typeof rows} ctor=${(rows as { constructor?: { name?: string } })?.constructor?.name}`);
  }
  const adIds = [...new Set(rows.map((r) => r.object_id))];
  const storeIdByAccount = new Map<string, string>();
  for (const accId of accountIds) storeIdByAccount.set(accId, market.storeId);

  setStep("resolveAdsToProducts");
  const resolutions = await resolveAdsToProducts(adIds, storeIdByAccount);

  setStep("aggregateAds");
  const adsAgg = aggregateAds(rows, forDate);

  setStep("buildCohorts");
  const cohorts = buildCohorts(adsAgg, resolutions, productCatalog);

  if (cohorts.length === 0) {
    return { market: market.marketCode, cohortsConsidered: 0, cardsWritten: 0, skipped: "no mixed-perf cohorts" };
  }

  setStep("payload-build");
  // Imperative payload construction — earlier chained `.map()` versions
  // failed in production with a minified `<X>.map is not a function`
  // error that survived several rounds of guards. Building the array
  // explicitly with for-loops sidesteps whatever transform was breaking
  // the chained version and gives precise error messages if any nested
  // field is malformed.
  if (!Array.isArray(cohorts)) {
    throw new Error(`cohorts-not-array typeof=${typeof cohorts} ctor=${(cohorts as { constructor?: { name?: string } })?.constructor?.name}`);
  }
  const cohortsPayload: unknown[] = [];
  for (let i = 0; i < cohorts.length; i++) {
    const c = cohorts[i];
    if (!c) throw new Error(`cohort[${i}] is ${c}`);
    setStep(`payload-build/cohort[${i}].winners (n=${c.winners?.length})`);
    if (!Array.isArray(c.winners)) throw new Error(`cohort[${i}].winners not array typeof=${typeof c.winners}`);
    const winnersTop = c.winners.slice(0, 3);
    const winnersOut: unknown[] = [];
    for (let j = 0; j < winnersTop.length; j++) {
      const a = winnersTop[j];
      winnersOut.push({
        ad_id: a.ad_id,
        ad_name: a.ad_name,
        spend: Math.round(a.spend_14d * 100) / 100,
        roas: Math.round(a.roas_14d * 100) / 100,
        purchases: a.purchases_14d,
      });
    }
    setStep(`payload-build/cohort[${i}].losers (n=${c.losers?.length})`);
    if (!Array.isArray(c.losers)) throw new Error(`cohort[${i}].losers not array typeof=${typeof c.losers}`);
    const losersTop = c.losers.slice(0, 5);
    const losersOut: unknown[] = [];
    for (let j = 0; j < losersTop.length; j++) {
      const a = losersTop[j];
      losersOut.push({
        ad_id: a.ad_id,
        ad_name: a.ad_name,
        spend: Math.round(a.spend_14d * 100) / 100,
        roas: Math.round(a.roas_14d * 100) / 100,
        purchases: a.purchases_14d,
        freq: Math.round(a.freq_avg * 100) / 100,
      });
    }
    cohortsPayload.push({
      product_handle: c.product_handle,
      product_title: c.product_title,
      total_spend_14d: Math.round(c.total_spend_14d * 100) / 100,
      total_revenue_14d: Math.round(c.total_revenue_14d * 100) / 100,
      total_purchases_14d: c.total_purchases_14d,
      cohort_roas_14d: Math.round(c.cohort_roas_14d * 100) / 100,
      cohort_median_ad_roas: Math.round(c.cohort_median_ad_roas * 100) / 100,
      winners: winnersOut,
      losers: losersOut,
      precomputed_severity: c.severity,
    });
  }
  setStep("payload-build/done");
  const userPayload = {
    market: {
      code: market.marketCode,
      name: market.storeName,
    },
    period_days: 14,
    cohorts: cohortsPayload,
  };

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 3072,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(userPayload) }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "generate_product_cards" },
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    logger.error("agent-briefs: Claude API error", {
      market: market.marketCode,
      status: claudeRes.status,
      body: errText.slice(0, 300),
    });
    return { market: market.marketCode, cohortsConsidered: cohorts.length, cardsWritten: 0, skipped: "claude error" };
  }

  setStep("claude-response-parse");
  const body = (await claudeRes.json()) as ClaudeResponse;
  const tool = body.content?.find(
    (c): c is ClaudeToolUseBlock => c.type === "tool_use" && c.name === "generate_product_cards"
  );
  let rawCards = tool?.input?.cards;

  // Sonnet 4.6 occasionally hands us a JSON-encoded string instead of the
  // declared array (seen on BG with 3 cohorts, never on GR). Try once to
  // recover by parsing — if the result is an array we keep going.
  if (typeof rawCards === "string") {
    try {
      const parsed = JSON.parse(rawCards);
      if (Array.isArray(parsed)) {
        logger.info("agent-briefs: recovered cards from JSON string", {
          market: market.marketCode,
          stringLen: rawCards.length,
          parsedLen: parsed.length,
        });
        rawCards = parsed;
      }
    } catch {
      // Fall through to the not-array branch below for proper logging.
    }
  }

  if (!Array.isArray(rawCards)) {
    logger.error("agent-briefs: tool returned non-array cards", {
      market: market.marketCode,
      stop_reason: body.stop_reason,
      typeofCards: typeof rawCards,
      ctor: (rawCards as unknown as { constructor?: { name?: string } })?.constructor?.name,
      previewJson: JSON.stringify(rawCards).slice(0, 300),
    });
    return {
      market: market.marketCode,
      cohortsConsidered: cohorts.length,
      cardsWritten: 0,
      skipped: `cards-not-array typeof=${typeof rawCards} stop_reason=${body.stop_reason}`,
    };
  }

  const cards = rawCards as BriefCard[];
  if (cards.length === 0) {
    return { market: market.marketCode, cohortsConsidered: cohorts.length, cardsWritten: 0, skipped: "claude 0 cards" };
  }

  setStep("brief-rows-build");
  // Match each LLM card back to its cohort by product handle mentioned in title.
  // We rely on the prompt rule that the product name is in quotes. Fallback:
  // first cohort by spend.
  const briefRows = cards.map((card, idx) => {
    const cohort =
      cohorts.find((c) => c.product_title && card.title.includes(c.product_title)) ??
      cohorts.find((c) => card.title.toLowerCase().includes(c.product_handle.toLowerCase())) ??
      cohorts[Math.min(idx, cohorts.length - 1)];
    return {
      organization_id: organizationId,
      integration_account_id: null, // product-cohort cards aren't tied to one Meta account
      store_id: market.storeId,
      for_date: forDate,
      severity: card.severity,
      title: card.title,
      why: card.why,
      target_type: "product",
      target_id: cohort.product_handle,
      target_name: cohort.product_title ?? cohort.product_handle,
      actions: card.actions,
      source_agent: "agent-briefs-product",
      payload: {
        cohort_summary: {
          total_spend_14d: cohort.total_spend_14d,
          total_revenue_14d: cohort.total_revenue_14d,
          total_purchases_14d: cohort.total_purchases_14d,
          cohort_roas_14d: cohort.cohort_roas_14d,
          winners_count: cohort.winners.length,
          losers_count: cohort.losers.length,
        },
        recommended_action: card.recommended_action ?? null,
        model: "claude-sonnet-4-6",
        stop_reason: body.stop_reason,
        input_tokens: body.usage?.input_tokens,
        output_tokens: body.usage?.output_tokens,
      },
    };
  });

  // Delete-then-insert keeps the cron idempotent for today's run without
  // relying on PostgREST upserting against the partial UNIQUE INDEX (which
  // it can't target through `onConflict`).
  const { error: delErr } = await supabaseAdmin
    .from("agent_briefs")
    .delete()
    .eq("organization_id", organizationId)
    .eq("for_date", forDate)
    .eq("source_agent", "agent-briefs-product")
    .eq("store_id", market.storeId);
  if (delErr) {
    return {
      market: market.marketCode,
      cohortsConsidered: cohorts.length,
      cardsWritten: 0,
      skipped: `delete failed: ${delErr.message.slice(0, 200)}`,
    };
  }
  const { error: insertErr } = await supabaseAdmin.from("agent_briefs").insert(briefRows);
  if (insertErr) {
    return {
      market: market.marketCode,
      cohortsConsidered: cohorts.length,
      cardsWritten: 0,
      skipped: `insert failed: ${insertErr.message.slice(0, 200)}`,
    };
  }

  return { market: market.marketCode, cohortsConsidered: cohorts.length, cardsWritten: briefRows.length };
}

// ============================================================
// GET
// ============================================================

export async function GET(req: Request) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "CLAUDE_API_KEY missing" }, { status: 500 });
  }

  const startedAt = Date.now();
  const forDate = sofiaDate();
  const markets = await resolveAllHomeMarkets();

  // Pre-load product catalogs per market for title lookups (handle → title).
  const productTitleByMarket = new Map<string, Map<string, string>>();
  for (const m of markets) {
    const { data: prods } = await supabaseAdmin
      .schema(`store_${m.marketCode}` as never)
      .from("products")
      .select("handle, title")
      .eq("status", "active");
    const map = new Map<string, string>();
    for (const p of (prods ?? []) as Array<{ handle: string; title: string }>) {
      map.set(p.handle, p.title);
    }
    productTitleByMarket.set(m.marketCode, map);
  }

  // organization_id per market (resolveAllHomeMarkets doesn't carry it)
  const { data: storeOrgRows } = await supabaseAdmin
    .from("stores")
    .select("id, organization_id")
    .in("id", markets.map((m) => m.storeId));
  const orgByStore = new Map<string, string>(
    (storeOrgRows ?? []).map((r) => [r.id as string, r.organization_id as string])
  );

  const results = await Promise.allSettled(
    markets.map((m) => {
      const orgId = orgByStore.get(m.storeId);
      if (!orgId) {
        return Promise.resolve({
          market: m.marketCode,
          cohortsConsidered: 0,
          cardsWritten: 0,
          skipped: "no organization_id",
        } as MarketProcessResult);
      }
      return processMarket(m, orgId, forDate, apiKey, productTitleByMarket.get(m.marketCode) ?? new Map()).catch(
        (e: unknown): MarketProcessResult => {
          const msg = e instanceof Error ? `${e.message} | ${e.stack?.split("\n").slice(0, 3).join(" / ")}` : String(e);
          return {
            market: m.marketCode,
            cohortsConsidered: 0,
            cardsWritten: 0,
            skipped: `processMarket threw: ${msg.slice(0, 500)}`,
          };
        }
      );
    })
  );

  const perMarket: MarketProcessResult[] = [];
  let totalCards = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      perMarket.push(r.value);
      totalCards += r.value.cardsWritten;
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      logger.error("agent-briefs: market settle rejected", { reason });
      perMarket.push({
        market: markets[i]?.marketCode ?? "?",
        cohortsConsidered: 0,
        cardsWritten: 0,
        skipped: `rejected: ${reason.slice(0, 200)}`,
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info("agent-briefs cron completed", { forDate, totalCards, durationMs });

  return NextResponse.json({
    ok: true,
    forDate,
    totalCards,
    durationMs,
    perMarket,
  });
}
