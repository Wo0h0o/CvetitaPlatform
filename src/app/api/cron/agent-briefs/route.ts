import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { sofiaDate, shiftDate } from "@/lib/sofia-date";
import { resolveAllHomeMarkets } from "@/lib/store-market-resolver";

// Vercel Hobby hard limit on serverless functions. 5 parallel Claude calls
// at ~10-15s each fit well inside 60s; sequential would not.
export const maxDuration = 60;

// ============================================================
// Types
// ============================================================

interface IntegrationAccountRow {
  id: string;
  organization_id: string;
  external_id: string;
  display_name: string;
  currency: string | null;
}

interface InsightRow {
  date: string;
  level: "ad" | "adset" | "campaign";
  object_id: string;
  object_name: string | null;
  spend: number | string | null;
  revenue: number | string | null;
  purchases: number | string | null;
  frequency: number | string | null;
}

type ObjectKey = string; // `${level}:${object_id}`

interface Aggregate {
  level: "ad" | "adset" | "campaign";
  target_id: string;
  target_name: string;
  spend_14d: number;
  revenue_14d: number;
  purchases_14d: number;
  frequency_sum: number;
  frequency_days: number;
  daily_roas: number[]; // one entry per day with spend > 0
  last_3d_spend: number;
  last_3d_revenue: number;
}

interface Candidate {
  target_type: "ad" | "adset" | "campaign";
  target_id: string;
  target_name: string;
  metrics: {
    spend_14d: number;
    revenue_14d: number;
    roas_14d: number;
    cpa_14d: number;
    median_daily_roas: number;
    last_3d_roas: number;
    frequency_avg: number;
    purchases_14d: number;
  };
  flagged_as: "red" | "amber" | "green";
}

interface BriefCard {
  severity: "red" | "amber" | "green";
  title: string;
  why: string;
  target_type: "ad" | "adset" | "campaign";
  target_id: string;
  target_name: string;
  actions: string[];
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
// System prompt (Bulgarian)
// ============================================================

const SYSTEM_PROMPT = `Ти си Meta Ads анализатор за Cvetita — българска билкова козметика с магазини в БГ, ГР и РО.

Задача: прегледай подадените кандидати от последните 14 дни и избери 2-4 от тях за които да
предложиш действие. Пиши стегнато, на български, директно към собственика.

ПРАВИЛА:
- ЗАДЪЛЖИТЕЛНО използвай инструмента generate_action_cards — никакъв свободен текст извън инструмента.
- Max 4 карти, min 0. Ако всичко изглежда здраво, върни празен масив { "cards": [] }.
- severity трябва точно да съвпадне с flagged_as от входа (red/amber/green).
- title: кратко действие + името в кавички. Примери: "Пауза на \\"BG-TOF-Video3\\"", "Скалирай \\"RO-Cold\\"".
- why: 1-2 изречения с конкретни цифри от метриките. Пример: "CPA 18€, +140% спрямо 14д медиана. Frequency 4.2 — публиката е изчерпана."
- target_type, target_id, target_name: копирай ТОЧНО от входа.
- actions (според flagged_as):
  * "red"   → ["pause", "dismiss"]
  * "amber" → ["review", "dismiss"]
  * "green" → ["scale", "dismiss"]

НЕ ПРАВИ:
- Не измисляй числа, които не са във входа.
- Не използвай „незабавно“, „веднага“, „критично“. Тонът е спокоен и експертен.
- Не препоръчвай действия за target_type="campaign" с action="pause" — спирането на цели кампании е извън W4.`;

// ============================================================
// Tool definition for Claude's forced-JSON output
// ============================================================

const ACTION_CARDS_TOOL = {
  name: "generate_action_cards",
  description:
    "Emit 0-4 action cards for the Owner Home Action Row, based on the provided candidates.",
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
            target_type: { type: "string" as const, enum: ["ad", "adset", "campaign"] },
            target_id: { type: "string" as const },
            target_name: { type: "string" as const },
            actions: {
              type: "array" as const,
              items: {
                type: "string" as const,
                enum: ["pause", "scale", "review", "dismiss"],
              },
              minItems: 1,
            },
          },
          required: [
            "severity",
            "title",
            "why",
            "target_type",
            "target_id",
            "target_name",
            "actions",
          ],
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
// Candidate selection — pre-filter outliers before sending to Claude
// ============================================================

function pickCandidates(rows: InsightRow[], todayIso: string): Candidate[] {
  const last3dStart = shiftDate(todayIso, 2); // inclusive of today+yesterday+day-before
  const byKey = new Map<ObjectKey, Aggregate>();

  for (const r of rows) {
    const key: ObjectKey = `${r.level}:${r.object_id}`;
    let a = byKey.get(key);
    if (!a) {
      a = {
        level: r.level,
        target_id: r.object_id,
        target_name: r.object_name ?? "(без име)",
        spend_14d: 0,
        revenue_14d: 0,
        purchases_14d: 0,
        frequency_sum: 0,
        frequency_days: 0,
        daily_roas: [],
        last_3d_spend: 0,
        last_3d_revenue: 0,
      };
      byKey.set(key, a);
    }
    const s = num(r.spend);
    const rev = num(r.revenue);
    const p = num(r.purchases);
    const f = num(r.frequency);
    a.spend_14d += s;
    a.revenue_14d += rev;
    a.purchases_14d += p;
    if (f > 0) {
      a.frequency_sum += f;
      a.frequency_days += 1;
    }
    if (s > 0) a.daily_roas.push(rev / s);
    if (r.date >= last3dStart) {
      a.last_3d_spend += s;
      a.last_3d_revenue += rev;
    }
  }

  const candidates: Candidate[] = [];
  for (const a of byKey.values()) {
    // Noise floor — skip objects with less than €10 total spend in 14d.
    if (a.spend_14d < 10) continue;

    const roas_14d = a.spend_14d > 0 ? a.revenue_14d / a.spend_14d : 0;
    const cpa_14d = a.purchases_14d > 0 ? a.spend_14d / a.purchases_14d : 0;
    const median_daily_roas = median(a.daily_roas);
    const last_3d_roas = a.last_3d_spend > 0 ? a.last_3d_revenue / a.last_3d_spend : 0;
    const frequency_avg = a.frequency_days > 0 ? a.frequency_sum / a.frequency_days : 0;

    let flagged: "red" | "amber" | "green" | null = null;
    if (median_daily_roas > 0) {
      const ratio = last_3d_roas / median_daily_roas;
      if (ratio < 0.7) flagged = "red";
      else if (ratio < 0.9) flagged = "amber";
      else if (ratio > 1.3 && a.spend_14d > 30) flagged = "green";
    }
    // Secondary red triggers.
    if (!flagged && frequency_avg > 3.5) flagged = "red";
    if (!flagged && a.spend_14d > 50 && a.purchases_14d === 0) flagged = "red";

    if (!flagged) continue;

    candidates.push({
      target_type: a.level,
      target_id: a.target_id,
      target_name: a.target_name,
      metrics: {
        spend_14d: Math.round(a.spend_14d * 100) / 100,
        revenue_14d: Math.round(a.revenue_14d * 100) / 100,
        roas_14d: Math.round(roas_14d * 100) / 100,
        cpa_14d: Math.round(cpa_14d * 100) / 100,
        median_daily_roas: Math.round(median_daily_roas * 100) / 100,
        last_3d_roas: Math.round(last_3d_roas * 100) / 100,
        frequency_avg: Math.round(frequency_avg * 100) / 100,
        purchases_14d: Math.round(a.purchases_14d),
      },
      flagged_as: flagged,
    });
  }

  // Cap to keep token budget sane — 20 is plenty; Claude picks 2-4.
  return candidates.slice(0, 20);
}

// ============================================================
// Per-account pipeline
// ============================================================

async function buildBriefsForAccount(
  account: IntegrationAccountRow,
  marketCode: string | null,
  forDate: string,
  apiKey: string
): Promise<{ accountId: string; cardCount: number; skipped?: string }> {
  // Load last 14d of per-object insights.
  const oldest = shiftDate(forDate, 13);
  const { data: rowsRaw, error: rowsErr } = await supabaseAdmin
    .from("meta_insights_daily")
    .select("date, level, object_id, object_name, spend, revenue, purchases, frequency")
    .eq("integration_account_id", account.id)
    .in("level", ["ad", "adset", "campaign"])
    .gte("date", oldest)
    .lte("date", forDate);

  if (rowsErr) {
    logger.error("agent-briefs: insights fetch failed", {
      accountId: account.id,
      error: rowsErr.message,
    });
    return { accountId: account.id, cardCount: 0, skipped: "insights fetch failed" };
  }

  const rows = (rowsRaw ?? []) as InsightRow[];
  const candidates = pickCandidates(rows, forDate);

  if (candidates.length === 0) {
    // Everything looks healthy — no need to spend an LLM call.
    return { accountId: account.id, cardCount: 0, skipped: "no candidates" };
  }

  // Call Claude Sonnet 4.6 with forced tool_choice — guarantees structured output.
  const userPayload = {
    account: {
      name: account.display_name,
      external_id: account.external_id,
      currency: account.currency ?? "EUR",
      market_code: marketCode ?? null,
    },
    period: {
      from: oldest,
      to: forDate,
      days: 14,
    },
    candidates,
  };

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(userPayload) }],
      tools: [ACTION_CARDS_TOOL],
      tool_choice: { type: "tool", name: "generate_action_cards" },
    }),
  });

  if (!anthropicRes.ok) {
    await anthropicRes.text();
    logger.error("agent-briefs: Claude API error", {
      accountId: account.id,
      status: anthropicRes.status,
    });
    return { accountId: account.id, cardCount: 0, skipped: "claude api error" };
  }

  const body = (await anthropicRes.json()) as ClaudeResponse;
  const toolBlock = body.content?.find(
    (c): c is ClaudeToolUseBlock => c.type === "tool_use" && c.name === "generate_action_cards"
  );
  const cards = (toolBlock?.input?.cards ?? []) as BriefCard[];

  if (cards.length === 0) {
    return { accountId: account.id, cardCount: 0, skipped: "claude returned 0 cards" };
  }

  // Upsert into agent_briefs with ON CONFLICT DO NOTHING (idempotency on
  // integration_account_id, for_date, target_type, target_id).
  const candidateByTargetId = new Map(candidates.map((c) => [c.target_id, c]));
  const briefRows = cards
    // Sanity-filter: drop cards whose target_id isn't in our candidate list
    // (Claude should copy verbatim but we don't trust it blindly).
    .filter((card) => candidateByTargetId.has(card.target_id))
    .map((card) => {
      const cand = candidateByTargetId.get(card.target_id);
      return {
        organization_id: account.organization_id,
        integration_account_id: account.id,
        for_date: forDate,
        severity: card.severity,
        title: card.title,
        why: card.why,
        target_type: card.target_type,
        target_id: card.target_id,
        target_name: card.target_name,
        actions: card.actions,
        payload: {
          metrics: cand?.metrics,
          flagged_as: cand?.flagged_as,
          model: "claude-sonnet-4-6",
          stop_reason: body.stop_reason,
          input_tokens: body.usage?.input_tokens,
          output_tokens: body.usage?.output_tokens,
        },
      };
    });

  if (briefRows.length === 0) {
    return { accountId: account.id, cardCount: 0, skipped: "all cards filtered" };
  }

  const { error: upsertErr } = await supabaseAdmin
    .from("agent_briefs")
    .upsert(briefRows, {
      onConflict: "integration_account_id,for_date,target_type,target_id",
      ignoreDuplicates: true,
    });

  if (upsertErr) {
    logger.error("agent-briefs: upsert failed", {
      accountId: account.id,
      error: upsertErr.message,
    });
    return { accountId: account.id, cardCount: 0, skipped: "upsert failed" };
  }

  return { accountId: account.id, cardCount: briefRows.length };
}

// ============================================================
// GET — cron entrypoint
// ============================================================

export async function GET(req: Request) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    logger.error("agent-briefs: CLAUDE_API_KEY missing");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const startedAt = Date.now();
  const forDate = sofiaDate();

  // Active Meta accounts.
  const { data: accounts, error: accErr } = await supabaseAdmin
    .from("integration_accounts")
    .select("id, organization_id, external_id, display_name, currency")
    .eq("service", "meta_ads")
    .eq("status", "active");

  if (accErr) {
    logger.error("agent-briefs: failed to load accounts", { error: accErr.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const activeAccounts = (accounts ?? []) as IntegrationAccountRow[];

  // Map each account to its market code (for the LLM prompt context).
  // resolveAllHomeMarkets returns ResolvedMarket[] which has bindings; we
  // build an account→market map so BG's 3 accounts all know they're "bg".
  const markets = await resolveAllHomeMarkets();
  const marketByAccountId = new Map<string, string>();
  for (const m of markets) {
    for (const b of m.bindings) {
      marketByAccountId.set(b.integrationAccountId, m.marketCode);
    }
  }

  // Fan out — 60s serverless budget accommodates this comfortably in parallel.
  const results = await Promise.allSettled(
    activeAccounts.map((acc) =>
      buildBriefsForAccount(acc, marketByAccountId.get(acc.id) ?? null, forDate, apiKey)
    )
  );

  let cardsGenerated = 0;
  let succeeded = 0;
  const perAccount: Array<{ accountId: string; cardCount: number; skipped?: string; error?: string }> = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const acc = activeAccounts[i];
    if (r.status === "fulfilled") {
      cardsGenerated += r.value.cardCount;
      if (!r.value.skipped) succeeded++;
      perAccount.push({ accountId: acc.id, cardCount: r.value.cardCount, skipped: r.value.skipped });
    } else {
      perAccount.push({
        accountId: acc.id,
        cardCount: 0,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info("agent-briefs cron completed", {
    forDate,
    accountsProcessed: activeAccounts.length,
    succeeded,
    cardsGenerated,
    durationMs,
  });

  return NextResponse.json({
    ok: true,
    forDate,
    accountsProcessed: activeAccounts.length,
    succeeded,
    cardsGenerated,
    durationMs,
    perAccount,
  });
}
