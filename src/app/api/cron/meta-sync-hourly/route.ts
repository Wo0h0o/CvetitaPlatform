import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fetchHourlyInsights,
  parseMetaHour,
  actionVal,
  type HourlyInsightRow,
} from "@/lib/meta";
import { decide, sleepForThrottle, type BucUsage } from "@/lib/meta-rate-limit";
import { logger } from "@/lib/logger";
import { sofiaDate, shiftDate } from "@/lib/sofia-date";

// Vercel Pro tier — 60s headroom for the whole fan-out. Hourly is a single
// breakdown query per account, so this stays well under 10s in practice.
export const maxDuration = 60;

// Sync window: today + yesterday for the intraday cron. Catches late-attributed
// purchases that flip from "0" to "1" on prior-day hours after the conversion
// window closes. Backfill mode (`?daysBack=N`) widens the window for one-off
// historical fills + the nightly catch-up tick (clamped to the retention
// horizon so we never write rows the prune step is about to delete).
const SYNC_DAYS_BACK_INTRADAY = 2;
const MAX_BACKFILL_DAYS = 30;

// Retention: prune rows older than 30 days.
//
// Why 30, not the earlier 14: the home dashboard's typical-day baseline
// for "Днес"/"Вчера" averages 4 same-weekdays prior, which lands the
// oldest needed date 28 days back (7+14+21+28). A 14-day retention left
// 3 of the 4 priors empty → averageHourly was dividing by 4 anyway and
// silently dragging the typical baseline to ~25% of real (the source
// of the "20% типична атрибуция vs 58% днес" false alarm). 30 days
// covers the baseline window with a 2-day buffer.
//
// Cost: 30 × 24 × 6 active accounts ≈ 4.3k rows. Still tiny.
const RETENTION_DAYS = 30;

interface IntegrationAccountRow {
  id: string;
  external_id: string;
  display_name: string;
  currency: string | null;
  status: string;
}

interface HourlyUpsertRow {
  integration_account_id: string;
  date: string;
  hour: number;
  level: "account";
  object_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  purchases: number;
  revenue: number;
  currency: string;
  fetched_at: string;
}

interface AccountResult {
  integrationAccountId: string;
  externalId: string;
  rowsUpserted: number;
  peakUsagePct: number;
  error: string | null;
  throttled: boolean;
}

function toHourlyUpsertRow(
  r: HourlyInsightRow,
  hour: number,
  integrationAccountId: string,
  externalId: string,
  currency: string
): HourlyUpsertRow {
  return {
    integration_account_id: integrationAccountId,
    date: r.date_start,
    hour,
    level: "account",
    object_id: externalId, // 'act_...' sentinel matches meta_insights_daily
    spend: parseFloat(r.spend || "0"),
    impressions: parseInt(r.impressions || "0"),
    clicks: parseInt(r.clicks || "0"),
    link_clicks: actionVal(r.actions, "link_click"),
    purchases: actionVal(r.actions, "omni_purchase"),
    revenue: actionVal(r.action_values, "omni_purchase"),
    currency,
    fetched_at: new Date().toISOString(),
  };
}

async function syncOneAccount(
  account: IntegrationAccountRow,
  since: string,
  until: string
): Promise<AccountResult> {
  const result: AccountResult = {
    integrationAccountId: account.id,
    externalId: account.external_id,
    rowsUpserted: 0,
    peakUsagePct: 0,
    error: null,
    throttled: false,
  };

  const currency = account.currency || "EUR";
  let peakUsage: BucUsage | null = null;

  try {
    const { rows, peakUsage: levelPeak } = await fetchHourlyInsights(
      since,
      until,
      account.id
    );
    peakUsage = levelPeak;

    const upsertRows: HourlyUpsertRow[] = [];
    for (const r of rows) {
      const hour = parseMetaHour(r.hourly_stats_aggregated_by_advertiser_time_zone);
      // Defensive: skip rows where Meta returned a malformed bucket string
      // rather than write hour=NULL or guess. Same principle as the daily
      // sync rejecting rows without a date_start.
      if (hour === null) continue;
      upsertRows.push(
        toHourlyUpsertRow(r, hour, account.id, account.external_id, currency)
      );
    }

    if (upsertRows.length > 0) {
      const { error: upsertErr } = await supabaseAdmin
        .from("meta_insights_hourly")
        .upsert(upsertRows, {
          onConflict: "integration_account_id,date,hour,level,object_id",
        });
      if (upsertErr) throw new Error(`Hourly upsert failed: ${upsertErr.message}`);
      result.rowsUpserted = upsertRows.length;
    }

    const decision = decide(peakUsage ?? undefined);
    if (decision === "stop") {
      result.throttled = true;
    } else if (decision === "throttle" && peakUsage) {
      await sleepForThrottle(peakUsage);
    }
  } catch (e) {
    result.error = (e as Error).message;
  }

  result.peakUsagePct = peakUsage?.peakPct ?? 0;
  return result;
}

/**
 * Retention prune — drop rows older than RETENTION_DAYS. Runs after the
 * sync write so a transient API error doesn't both fail the sync AND wipe
 * useful history. Best-effort — failures here log but never fail the cron.
 */
async function pruneOldRows(retentionDays: number): Promise<number> {
  const cutoff = shiftDate(sofiaDate(), retentionDays);
  const { error, count } = await supabaseAdmin
    .from("meta_insights_hourly")
    .delete({ count: "exact" })
    .lt("date", cutoff);
  if (error) {
    logger.error("meta-sync-hourly: prune failed", { error: error.message, cutoff });
    return 0;
  }
  return count ?? 0;
}

export async function GET(request: Request) {
  const cronError = requireCronSecret(request);
  if (cronError) return cronError;

  const startedAt = Date.now();

  // Optional `?daysBack=N` for manual backfills. Clamped to MAX_BACKFILL_DAYS
  // so a typo can't blow the BUC budget or pull data older than retention.
  const url = new URL(request.url);
  const daysBackParam = parseInt(url.searchParams.get("daysBack") ?? "", 10);
  const daysBack =
    Number.isFinite(daysBackParam) && daysBackParam > 0
      ? Math.min(daysBackParam, MAX_BACKFILL_DAYS)
      : SYNC_DAYS_BACK_INTRADAY;

  const untilStr = sofiaDate();
  const sinceStr = shiftDate(untilStr, daysBack - 1);

  const { data: accounts, error: loadErr } = await supabaseAdmin
    .from("integration_accounts")
    .select("id, external_id, display_name, currency, status")
    .eq("service", "meta_ads")
    .eq("status", "active");

  if (loadErr) {
    logger.error("meta-sync-hourly: failed to load accounts", { error: loadErr.message });
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({
      ok: true,
      accountCount: 0,
      message: "No active meta_ads accounts to sync.",
    });
  }

  const results = await Promise.allSettled(
    (accounts as IntegrationAccountRow[]).map((a) =>
      syncOneAccount(a, sinceStr, untilStr)
    )
  );

  const summary = results.map((r, i): AccountResult => {
    if (r.status === "fulfilled") return r.value;
    return {
      integrationAccountId: accounts[i].id,
      externalId: accounts[i].external_id,
      rowsUpserted: 0,
      peakUsagePct: 0,
      error: String(r.reason),
      throttled: false,
    };
  });

  const totals = summary.reduce(
    (acc, r) => {
      acc.rowsUpserted += r.rowsUpserted;
      if (r.error) acc.errors++;
      if (r.throttled) acc.throttled++;
      return acc;
    },
    { rowsUpserted: 0, errors: 0, throttled: 0 }
  );

  const pruned = await pruneOldRows(RETENTION_DAYS);
  const durationMs = Date.now() - startedAt;

  logger.info("meta-sync-hourly completed", {
    durationMs,
    accountCount: accounts.length,
    window: { since: sinceStr, until: untilStr },
    ...totals,
    pruned,
  });

  return NextResponse.json({
    ok: true,
    durationMs,
    window: { since: sinceStr, until: untilStr },
    accountCount: accounts.length,
    totals,
    pruned,
    perAccount: summary,
  });
}
