import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fetchDailyInsights,
  actionVal,
  type DailyInsightRow,
  type InsightsLevel,
} from "@/lib/meta";
import { decide, sleepForThrottle, type BucUsage } from "@/lib/meta-rate-limit";
import { logger } from "@/lib/logger";
import { sofiaDate, shiftDate } from "@/lib/sofia-date";

// Vercel Pro tier — 60s headroom for the whole fan-out. Promise.allSettled
// parallelism keeps us well under this for 5 active accounts × 2 levels each.
export const maxDuration = 60;

// Sync window: last 3 days (inclusive). Catches late-attributed conversions
// without re-fetching settled history every night.
const SYNC_DAYS_BACK_NIGHTLY = 3;

// Intraday mode: today only. Collapses 3 Graph calls × N levels to 1 ×
// N — safe to run every 15 minutes without exhausting BUC budgets.
const SYNC_DAYS_BACK_INTRADAY = 1;

const SYNC_LEVELS: InsightsLevel[] = ["account", "campaign"];

interface IntegrationAccountRow {
  id: string;
  external_id: string;
  display_name: string;
  currency: string | null;
  status: string;
}

interface UpsertRow {
  integration_account_id: string;
  date: string;
  level: InsightsLevel;
  object_id: string;
  object_name: string | null;
  parent_campaign_id: string | null;
  parent_adset_id: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  reach: number;
  frequency: number;
  purchases: number;
  revenue: number;
  add_to_cart: number;
  initiate_checkout: number;
  landing_page_views: number;
  actions: Record<string, number>;
  currency: string;
  fetched_at: string;
}

interface AccountResult {
  integrationAccountId: string;
  externalId: string;
  rowsUpserted: number;
  levelsCompleted: InsightsLevel[];
  peakUsagePct: number;
  error: string | null;
  skipped: boolean;
  throttled: boolean;
}

// ============================================================
// Row transformation (Meta API → meta_insights_daily schema)
// ============================================================

function toUpsertRow(
  r: DailyInsightRow,
  level: InsightsLevel,
  integrationAccountId: string,
  externalId: string,
  currency: string
): UpsertRow {
  // Collapse the raw actions array into the typed columns + a kept-jsonb tail
  const actionsJson: Record<string, number> = {};
  for (const a of r.actions || []) {
    actionsJson[a.action_type] = parseFloat(a.value);
  }

  let objectId: string;
  let objectName: string | null = null;
  let parentCampaign: string | null = null;
  let parentAdset: string | null = null;

  if (level === "account") {
    objectId = externalId; // use 'act_...' as the sentinel
    objectName = null;
  } else if (level === "campaign") {
    objectId = r.campaign_id || "";
    objectName = r.campaign_name || null;
  } else if (level === "adset") {
    objectId = r.adset_id || "";
    objectName = r.adset_name || null;
    parentCampaign = r.campaign_id || null;
  } else {
    // ad
    objectId = r.ad_id || "";
    objectName = r.ad_name || null;
    parentCampaign = r.campaign_id || null;
    parentAdset = r.adset_id || null;
  }

  return {
    integration_account_id: integrationAccountId,
    date: r.date_start,
    level,
    object_id: objectId,
    object_name: objectName,
    parent_campaign_id: parentCampaign,
    parent_adset_id: parentAdset,
    spend: parseFloat(r.spend || "0"),
    impressions: parseInt(r.impressions || "0"),
    clicks: parseInt(r.clicks || "0"),
    link_clicks: actionVal(r.actions, "link_click"),
    reach: parseInt(r.reach || "0"),
    frequency: parseFloat(r.frequency || "0"),
    purchases: actionVal(r.actions, "omni_purchase"),
    revenue: actionVal(r.action_values, "omni_purchase"),
    add_to_cart: actionVal(r.actions, "omni_add_to_cart"),
    initiate_checkout: actionVal(r.actions, "omni_initiated_checkout"),
    landing_page_views: actionVal(r.actions, "landing_page_view"),
    actions: actionsJson,
    currency,
    fetched_at: new Date().toISOString(),
  };
}

// ============================================================
// Single-account sync
// ============================================================

async function syncOneAccount(
  account: IntegrationAccountRow,
  since: string,
  until: string
): Promise<AccountResult> {
  const result: AccountResult = {
    integrationAccountId: account.id,
    externalId: account.external_id,
    rowsUpserted: 0,
    levelsCompleted: [],
    peakUsagePct: 0,
    error: null,
    skipped: false,
    throttled: false,
  };

  const currency = account.currency || "EUR";
  let peakUsage: BucUsage | null = null;

  for (const level of SYNC_LEVELS) {
    try {
      const { rows, peakUsage: levelPeak } = await fetchDailyInsights(
        level,
        since,
        until,
        account.id
      );

      if (levelPeak && (!peakUsage || levelPeak.peakPct > peakUsage.peakPct)) {
        peakUsage = levelPeak;
      }

      if (rows.length > 0) {
        const upsertRows = rows.map((r) =>
          toUpsertRow(r, level, account.id, account.external_id, currency)
        );
        const { error: upsertErr } = await supabaseAdmin
          .from("meta_insights_daily")
          .upsert(upsertRows, {
            onConflict: "integration_account_id,date,level,object_id",
          });
        if (upsertErr) {
          throw new Error(`Upsert (${level}) failed: ${upsertErr.message}`);
        }
        result.rowsUpserted += upsertRows.length;
      }
      result.levelsCompleted.push(level);

      // Per-level throttle check — cooperates with the hour-budget
      const decision = decide(peakUsage ?? undefined);
      if (decision === "stop") {
        result.throttled = true;
        break;
      }
      if (decision === "throttle" && peakUsage) {
        await sleepForThrottle(peakUsage);
      }
    } catch (e) {
      result.error = (e as Error).message;
      break;
    }
  }

  result.peakUsagePct = peakUsage?.peakPct ?? 0;

  // Record per-account sync state back to integration_accounts.
  // On error, leave last_synced_at untouched (don't regress to NULL) so a
  // transient 502 doesn't flip FreshnessDot to red when yesterday's sync
  // succeeded. Only overwrite when the run actually produced fresh data.
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("integration_accounts")
    .update({
      ...(result.error ? {} : { last_synced_at: now }),
      last_sync_error: result.error,
      // Don't flip status to 'rate_limited' on a soft throttle — only hard stops
      ...(result.throttled && result.peakUsagePct >= 95
        ? { status: "rate_limited" }
        : {}),
    })
    .eq("id", account.id);

  return result;
}

// ============================================================
// Cron entrypoint
// ============================================================

export async function GET(request: Request) {
  const cronError = requireCronSecret(request);
  if (cronError) return cronError;

  const startedAt = Date.now();

  // `?window=today` collapses the sync window to today only. Vercel cron
  // schedules `*/15 * * * *` to this URL for intraday freshness; the nightly
  // `0 3 * * *` hits the bare URL and gets the 3-day backfill for late
  // attribution.
  const url = new URL(request.url);
  // Case- and whitespace-tolerant — Vercel cron URLs are authored by hand,
  // and a capital T or trailing space should not silently demote an intraday
  // run to the 3-day nightly backfill.
  const windowParam = (url.searchParams.get("window") ?? "").trim().toLowerCase();
  const daysBack =
    windowParam === "today" ? SYNC_DAYS_BACK_INTRADAY : SYNC_DAYS_BACK_NIGHTLY;

  // Date window: today - daysBack + 1 .. today, anchored to Europe/Sofia (the
  // business operating timezone). UTC-based math here would shift the window
  // 1-3h near midnight Sofia and create gaps vs dashboard reads.
  const untilStr = sofiaDate();
  const sinceStr = shiftDate(untilStr, daysBack - 1);

  // Load all active meta_ads integration accounts
  const { data: accounts, error: loadErr } = await supabaseAdmin
    .from("integration_accounts")
    .select("id, external_id, display_name, currency, status")
    .eq("service", "meta_ads")
    .eq("status", "active");

  if (loadErr) {
    logger.error("meta-sync: failed to load accounts", { error: loadErr.message });
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({
      ok: true,
      accountCount: 0,
      message: "No active meta_ads accounts to sync.",
    });
  }

  // Fan out. Promise.allSettled — one bad account never kills the run.
  const results = await Promise.allSettled(
    (accounts as IntegrationAccountRow[]).map((a) =>
      syncOneAccount(a, sinceStr, untilStr)
    )
  );

  // Shape results for the response body
  const summary = results.map((r, i): AccountResult => {
    if (r.status === "fulfilled") return r.value;
    return {
      integrationAccountId: accounts[i].id,
      externalId: accounts[i].external_id,
      rowsUpserted: 0,
      levelsCompleted: [],
      peakUsagePct: 0,
      error: String(r.reason),
      skipped: false,
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

  const durationMs = Date.now() - startedAt;

  logger.info("meta-sync completed", {
    durationMs,
    accountCount: accounts.length,
    mode: windowParam === "today" ? "intraday" : "nightly",
    ...totals,
    window: { since: sinceStr, until: untilStr },
  });

  return NextResponse.json({
    ok: true,
    durationMs,
    mode: windowParam === "today" ? "intraday" : "nightly",
    window: { since: sinceStr, until: untilStr },
    accountCount: accounts.length,
    totals,
    perAccount: summary,
  });
}
