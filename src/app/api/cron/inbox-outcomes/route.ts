import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const maxDuration = 60;

/**
 * GET /api/cron/inbox-outcomes
 *
 * Re-evaluates inbox cards whose `outcome_revisit_at` has passed and marks
 * them succeeded / failed / inconclusive. This is the learning loop that
 * tells us which agent recommendations actually worked — without it, the
 * inbox is a one-way wall of suggestions with no feedback.
 *
 * For now we support outcome_metric='roas' (market-level cards from
 * watcher-roas-drop). Other metrics will plug in here as more watchers ship.
 *
 * Decision rule (for ROAS):
 *   - current >= baseline × 0.9  → succeeded   (recovered to within 10%)
 *   - current <= baseline × 0.5  → failed      (stayed below half-baseline)
 *   - otherwise                  → inconclusive
 */

const ROAS_LOOKBACK_DAYS = 7;

interface MetaRow {
  date: string;
  spend: number | string | null;
  revenue: number | string | null;
}

interface ShopifyAggRow {
  date: string;
  total_revenue: number | string | null;
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lastNDates(n: number, endInclusive: string): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftDate(endInclusive, -i));
  return out;
}

function sofiaToday(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

interface AgentBrief {
  id: string;
  for_date: string;
  target_type: string;
  target_id: string;
  store_id: string | null;
  outcome_metric: string | null;
  outcome_baseline_value: number | string | null;
  source_agent: string | null;
  status: string;
}

async function evaluateRoasCard(brief: AgentBrief): Promise<{
  current: number;
  status: "succeeded" | "failed" | "inconclusive";
  summary: string;
}> {
  if (!brief.store_id) {
    return {
      current: 0,
      status: "inconclusive",
      summary: "Outcome не може да бъде измерен (липсва store_id).",
    };
  }

  const today = sofiaToday();
  const dates = lastNDates(ROAS_LOOKBACK_DAYS, today);
  const since = dates[0];

  // Get the store-market mapping
  const { data: storeRow } = await supabaseAdmin
    .from("stores")
    .select("market_code, name")
    .eq("id", brief.store_id)
    .single();

  if (!storeRow) {
    return { current: 0, status: "inconclusive", summary: "Магазинът не е намерен." };
  }

  const [metaRes, shopRes] = await Promise.all([
    supabaseAdmin
      .from("meta_insights_by_store")
      .select("date, spend, revenue")
      .eq("store_id", brief.store_id)
      .eq("level", "account")
      .gte("date", since)
      .lte("date", today),
    supabaseAdmin.rpc("read_store_daily_aggregates", {
      p_schema: `store_${storeRow.market_code}`,
      p_dates: dates,
    }),
  ]);

  const spendByDate = new Map<string, number>();
  for (const r of (metaRes.data ?? []) as MetaRow[]) {
    spendByDate.set(r.date, (spendByDate.get(r.date) ?? 0) + num(r.spend));
  }
  const revenueByDate = new Map<string, number>();
  for (const r of (shopRes.data ?? []) as ShopifyAggRow[]) {
    revenueByDate.set(r.date, num(r.total_revenue));
  }

  let spendSum = 0;
  let revSum = 0;
  for (const d of dates) {
    spendSum += spendByDate.get(d) ?? 0;
    revSum += revenueByDate.get(d) ?? 0;
  }
  const currentRoas = spendSum > 0 ? revSum / spendSum : 0;
  const baseline = num(brief.outcome_baseline_value);

  if (baseline <= 0) {
    return {
      current: currentRoas,
      status: "inconclusive",
      summary: "Липсва валиден baseline.",
    };
  }

  const ratio = currentRoas / baseline;
  let status: "succeeded" | "failed" | "inconclusive";
  let summaryHead: string;
  if (ratio >= 0.9) {
    status = "succeeded";
    summaryHead = `ROAS се възстанови до ${currentRoas.toFixed(2)} (baseline ${baseline.toFixed(2)})`;
  } else if (ratio <= 0.5) {
    status = "failed";
    summaryHead = `ROAS остана нисък — ${currentRoas.toFixed(2)} срещу baseline ${baseline.toFixed(2)}`;
  } else {
    status = "inconclusive";
    summaryHead = `ROAS ${currentRoas.toFixed(2)} срещу baseline ${baseline.toFixed(2)} — частично възстановяване`;
  }

  return {
    current: currentRoas,
    status,
    summary: `${summaryHead} за ${ROAS_LOOKBACK_DAYS} дни (spend €${spendSum.toFixed(2)}, revenue €${revSum.toFixed(2)}).`,
  };
}

export async function GET(req: Request) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  const startedAt = Date.now();
  const now = new Date().toISOString();

  const { data: due, error } = await supabaseAdmin
    .from("agent_briefs")
    .select(
      "id, for_date, target_type, target_id, store_id, outcome_metric, outcome_baseline_value, source_agent, status"
    )
    .in("outcome_status", ["pending", "measuring"])
    .not("outcome_revisit_at", "is", null)
    .lte("outcome_revisit_at", now)
    .limit(50);

  if (error) {
    logger.error("inbox-outcomes: failed to load due briefs", { error: error.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const evaluated: Array<{
    id: string;
    metric: string;
    status: string;
    current: number;
  }> = [];
  let evaluated_n = 0;
  let skipped_n = 0;

  for (const brief of (due ?? []) as AgentBrief[]) {
    let result: Awaited<ReturnType<typeof evaluateRoasCard>> | null = null;

    if (brief.outcome_metric === "roas") {
      try {
        result = await evaluateRoasCard(brief);
      } catch (e) {
        logger.error("inbox-outcomes: roas eval threw", {
          briefId: brief.id,
          error: e instanceof Error ? e.message : String(e),
        });
        skipped_n++;
        continue;
      }
    } else {
      // Unsupported metric — mark NA so we don't keep retrying.
      const { error: updErr } = await supabaseAdmin
        .from("agent_briefs")
        .update({
          outcome_status: "na",
          outcome_summary: `Не поддържан outcome_metric: ${brief.outcome_metric ?? "null"}.`,
          outcome_evaluated_at: now,
        })
        .eq("id", brief.id);
      if (updErr) {
        logger.error("inbox-outcomes: na-mark failed", {
          briefId: brief.id,
          error: updErr.message,
        });
      }
      skipped_n++;
      continue;
    }

    const { error: updErr } = await supabaseAdmin
      .from("agent_briefs")
      .update({
        outcome_status: result.status,
        outcome_current_value: Number(result.current.toFixed(4)),
        outcome_summary: result.summary,
        outcome_evaluated_at: now,
      })
      .eq("id", brief.id);

    if (updErr) {
      logger.error("inbox-outcomes: update failed", {
        briefId: brief.id,
        error: updErr.message,
      });
      skipped_n++;
      continue;
    }

    evaluated_n++;
    evaluated.push({
      id: brief.id,
      metric: brief.outcome_metric ?? "unknown",
      status: result.status,
      current: result.current,
    });
  }

  const durationMs = Date.now() - startedAt;
  logger.info("inbox-outcomes completed", {
    durationMs,
    candidates: due?.length ?? 0,
    evaluated: evaluated_n,
    skipped: skipped_n,
  });

  return NextResponse.json({
    ok: true,
    durationMs,
    candidates: due?.length ?? 0,
    evaluated: evaluated_n,
    skipped: skipped_n,
    results: evaluated,
  });
}
