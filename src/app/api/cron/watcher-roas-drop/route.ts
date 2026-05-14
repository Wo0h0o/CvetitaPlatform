import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { resolveAllHomeMarkets } from "@/lib/store-market-resolver";

export const maxDuration = 60;

/**
 * GET /api/cron/watcher-roas-drop
 *
 * For every active market, compare today's ROAS to the trailing 14-day
 * median (excluding today). If today's ROAS dropped >= the threshold AND
 * the baseline was actually healthy AND today's spend is above the noise
 * floor, insert an inbox card for the org.
 *
 * Idempotent: one card per (organization, for_date, target_type='market',
 * target_id=market_code). The partial unique index on agent_briefs
 * ensures re-running within the same Sofia day is a no-op.
 *
 * Why intraday (every 30 min) instead of daily: ROAS can collapse within
 * hours when a budget gets re-allocated to a bad ad set. Waiting until
 * tomorrow's morning report wastes a day of spend.
 */

const LOOKBACK_DAYS = 14;
const MIN_BASELINE_DAYS = 10;       // need enough days to trust the median
const MIN_TODAY_SPEND_EUR = 5;      // ignore micro-spend noise
const MIN_HEALTHY_BASELINE_ROAS = 1.0; // not a "drop" if baseline was already <1
const RED_THRESHOLD = 0.4;          // today < 0.4× median → red
const AMBER_THRESHOLD = 0.6;        // today < 0.6× median → amber

interface MetaRow {
  date: string;
  spend: number | string | null;
}

interface ShopifyRow {
  date: string;
  total_revenue: number | string | null;
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function sofiaToday(): string {
  // Sofia is UTC+2/+3. Use Intl.DateTimeFormat to avoid DST math.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
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

export async function GET(req: Request) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  const startedAt = Date.now();
  const today = sofiaToday();
  const baselineEnd = shiftDate(today, -1);
  const baselineStart = shiftDate(today, -LOOKBACK_DAYS);

  const markets = await resolveAllHomeMarkets();

  // organization_id isn't on ResolvedMarket — pull it once for all stores.
  const storeIds = markets.map((m) => m.storeId);
  const { data: storeRows } = await supabaseAdmin
    .from("stores")
    .select("id, organization_id")
    .in("id", storeIds);
  const orgIdByStore = new Map<string, string>(
    (storeRows ?? []).map((r) => [r.id as string, r.organization_id as string])
  );

  const results: Array<{
    market: string;
    todaySpend: number;
    todayRevenue: number;
    todayRoas: number;
    baselineMedian: number;
    baselineDays: number;
    decision: "card_inserted" | "no_drop" | "below_min_spend" | "weak_baseline" | "not_enough_days";
    severity?: "red" | "amber";
  }> = [];

  let inserted = 0;
  let skipped = 0;

  for (const m of markets) {
    const market = m.marketCode;
    const storeSchema = `store_${market}`;

    // --- Pull 14 days of Meta spend across all bindings (primary + legacy +
    // secondary) for this store. meta_insights_by_store already sums them.
    const { data: metaRows, error: metaErr } = await supabaseAdmin
      .from("meta_insights_by_store")
      .select("date, spend")
      .eq("store_id", m.storeId)
      .eq("level", "account")
      .gte("date", baselineStart)
      .lte("date", today);

    if (metaErr) {
      logger.error("watcher-roas-drop: meta fetch failed", {
        market,
        error: metaErr.message,
      });
      skipped++;
      continue;
    }

    // --- Pull 14 days of Shopify revenue from the per-store schema. Empty
    // schemas (e.g. HU placeholder) just return zero rows — handled fine.
    const allDates = lastNDates(LOOKBACK_DAYS + 1, today);
    const { data: shopifyRows, error: shopErr } = await supabaseAdmin.rpc(
      "read_store_daily_aggregates",
      { p_schema: storeSchema, p_dates: allDates }
    );

    if (shopErr) {
      // Empty schemas (HU placeholder) shouldn't even get this far because
      // they have no meta spend yet — but log defensively and move on.
      logger.warn("watcher-roas-drop: shopify fetch failed", {
        market,
        schema: storeSchema,
        error: shopErr.message,
      });
      skipped++;
      continue;
    }

    const spendByDate = new Map<string, number>();
    for (const r of (metaRows ?? []) as MetaRow[]) {
      const existing = spendByDate.get(r.date) ?? 0;
      spendByDate.set(r.date, existing + num(r.spend));
    }

    const revenueByDate = new Map<string, number>();
    for (const r of (shopifyRows ?? []) as ShopifyRow[]) {
      revenueByDate.set(r.date, num(r.total_revenue));
    }

    const todaySpend = spendByDate.get(today) ?? 0;
    const todayRevenue = revenueByDate.get(today) ?? 0;
    const todayRoas = todaySpend > 0 ? todayRevenue / todaySpend : 0;

    // --- Baseline: per-day ROAS for the previous 14 days where both spend
    // AND revenue are reported. A day with 0 spend is excluded (no ROAS).
    const baselineRoas: number[] = [];
    for (const d of allDates) {
      if (d === today) continue;
      const s = spendByDate.get(d) ?? 0;
      if (s < MIN_TODAY_SPEND_EUR) continue;
      const r = revenueByDate.get(d) ?? 0;
      baselineRoas.push(r / s);
    }

    const baselineMedian = median(baselineRoas);

    // --- Decision tree
    if (todaySpend < MIN_TODAY_SPEND_EUR) {
      results.push({
        market,
        todaySpend,
        todayRevenue,
        todayRoas,
        baselineMedian,
        baselineDays: baselineRoas.length,
        decision: "below_min_spend",
      });
      continue;
    }
    if (baselineRoas.length < MIN_BASELINE_DAYS) {
      results.push({
        market,
        todaySpend,
        todayRevenue,
        todayRoas,
        baselineMedian,
        baselineDays: baselineRoas.length,
        decision: "not_enough_days",
      });
      continue;
    }
    if (baselineMedian < MIN_HEALTHY_BASELINE_ROAS) {
      results.push({
        market,
        todaySpend,
        todayRevenue,
        todayRoas,
        baselineMedian,
        baselineDays: baselineRoas.length,
        decision: "weak_baseline",
      });
      continue;
    }

    const ratio = todayRoas / baselineMedian;
    let severity: "red" | "amber" | null = null;
    if (ratio < RED_THRESHOLD) severity = "red";
    else if (ratio < AMBER_THRESHOLD) severity = "amber";

    if (!severity) {
      results.push({
        market,
        todaySpend,
        todayRevenue,
        todayRoas,
        baselineMedian,
        baselineDays: baselineRoas.length,
        decision: "no_drop",
      });
      continue;
    }

    const organizationId = orgIdByStore.get(m.storeId);
    if (!organizationId) {
      logger.error("watcher-roas-drop: missing organization_id", { market });
      skipped++;
      continue;
    }

    // --- Insert / upsert the inbox card. Idempotent by partial unique idx
    // on (organization_id, for_date, target_type='market', target_id).
    const dropPct = Math.round((1 - ratio) * 100);
    const card = {
      organization_id: organizationId,
      integration_account_id: null,
      for_date: today,
      severity,
      title: `${m.storeName}: ROAS −${dropPct}% днес`,
      why:
        `Днешен ROAS ${todayRoas.toFixed(2)} срещу 14-дневен медиан ${baselineMedian.toFixed(2)}. ` +
        `Spend €${todaySpend.toFixed(2)} → revenue €${todayRevenue.toFixed(2)}. ` +
        `Препоръчвам да прегледаш активните ad set-ове за този пазар и да pause-неш underperformer-ите.`,
      target_type: "market",
      target_id: market,
      target_name: m.storeName,
      actions: ["review", "dismiss"],
      source_agent: "watcher-roas-drop",
      store_id: m.storeId,
      outcome_status: "pending",
      outcome_metric: "roas",
      outcome_baseline_value: Number(baselineMedian.toFixed(4)),
      outcome_current_value: Number(todayRoas.toFixed(4)),
      outcome_revisit_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      payload: {
        watcher: "roas-drop",
        thresholds: {
          red: RED_THRESHOLD,
          amber: AMBER_THRESHOLD,
          min_today_spend: MIN_TODAY_SPEND_EUR,
          min_healthy_baseline: MIN_HEALTHY_BASELINE_ROAS,
          min_baseline_days: MIN_BASELINE_DAYS,
        },
        baseline_days: baselineRoas.length,
        today_spend: todaySpend,
        today_revenue: todayRevenue,
        today_roas: todayRoas,
        baseline_median_roas: baselineMedian,
        ratio,
      },
    };

    const { error: insErr } = await supabaseAdmin
      .from("agent_briefs")
      .upsert(card, {
        onConflict: "organization_id,for_date,target_type,target_id",
        ignoreDuplicates: false,
      });

    if (insErr) {
      logger.error("watcher-roas-drop: insert failed", {
        market,
        error: insErr.message,
      });
      skipped++;
      continue;
    }

    inserted++;
    results.push({
      market,
      todaySpend,
      todayRevenue,
      todayRoas,
      baselineMedian,
      baselineDays: baselineRoas.length,
      decision: "card_inserted",
      severity,
    });
  }

  const durationMs = Date.now() - startedAt;
  logger.info("watcher-roas-drop completed", {
    durationMs,
    marketsScanned: markets.length,
    cardsInserted: inserted,
    skipped,
  });

  return NextResponse.json({
    ok: true,
    durationMs,
    today,
    marketsScanned: markets.length,
    cardsInserted: inserted,
    skipped,
    results,
  });
}
