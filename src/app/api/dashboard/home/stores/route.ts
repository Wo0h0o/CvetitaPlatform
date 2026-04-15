import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  resolveAllHomeMarkets,
  type ResolvedMarket,
} from "@/lib/store-market-resolver";

// ============================================================
// Types
// ============================================================

type BorderLevel = "red" | "amber" | "green";

interface StoreCardPayload {
  /** Store UUID — used as the card-tap target (/sales/store/[storeId]). */
  storeId: string;
  marketCode: string;
  name: string;
  flag: string;
  /** 14 values, oldest first, one per day. Zero-filled for missing days. */
  sparkline14d: number[];
  /** Today's ROAS (revenue / spend). 0 when spend is 0 or no data yet. */
  roasLast24h: number;
  /** Median of the prior 13 days' daily ROAS. Days with spend=0 are skipped. */
  roasMedian14d: number;
  borderLevel: BorderLevel;
  /** Most recent sync across all bound integration_accounts. ISO timestamp. */
  lastSyncedAt: string | null;
}

interface StoresResponse {
  stores: StoreCardPayload[];
}

// ============================================================
// Market → flag emoji
// ============================================================

const FLAG_BY_MARKET: Record<string, string> = {
  bg: "🇧🇬",
  gr: "🇬🇷",
  ro: "🇷🇴",
};

// ============================================================
// Sofia date helpers (duplicated from top-strip route — small enough
// that extracting a shared util would be premature)
// ============================================================

const SOFIA_TZ = "Europe/Sofia";

function sofiaDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SOFIA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** ISO dates for the last N days ending at today (oldest first). */
function lastNDates(n: number, todayIso: string): string[] {
  const [y, m, d] = todayIso.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(base - i * 86_400_000);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    out.push(`${yy}-${mm}-${dd}`);
  }
  return out;
}

// ============================================================
// Math
// ============================================================

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function deriveBorder(today: number, medianRoas: number): BorderLevel {
  if (medianRoas === 0 || today === 0) return "amber";
  const ratio = today / medianRoas;
  if (ratio < 0.7) return "red";
  if (ratio < 0.9) return "amber";
  return "green";
}

// ============================================================
// Per-store payload builder
// ============================================================

type InsightRow = {
  date: string;
  spend: number | string | null;
  revenue: number | string | null;
};

const num = (v: number | string | null | undefined): number =>
  v == null ? 0 : typeof v === "string" ? Number(v) : v;

async function buildStoreCard(
  market: ResolvedMarket,
  todayIso: string
): Promise<StoreCardPayload> {
  const dates14 = lastNDates(14, todayIso);
  const oldest = dates14[0];

  // Parallel: 14-day insights (level=account, pre-blended by the view) and
  // last_synced_at across all bound integration_accounts.
  const [insightsRes, accountsRes] = await Promise.all([
    supabaseAdmin
      .from("meta_insights_by_store")
      .select("date, spend, revenue")
      .eq("store_id", market.storeId)
      .eq("level", "account")
      .gte("date", oldest)
      .lte("date", todayIso),
    supabaseAdmin
      .from("integration_accounts")
      .select("last_synced_at")
      .in("id", market.allIntegrationAccountIds),
  ]);

  if (insightsRes.error) throw new Error(insightsRes.error.message);
  if (accountsRes.error) throw new Error(accountsRes.error.message);

  const rows = (insightsRes.data ?? []) as InsightRow[];
  const byDate = new Map<string, { spend: number; revenue: number }>();
  for (const r of rows) {
    byDate.set(r.date, { spend: num(r.spend), revenue: num(r.revenue) });
  }

  // Sparkline: revenue per day, zero-filled. (Footnote in 08-week3-plan.md
  // §2b: v1 uses Meta-reported revenue for internal consistency with the
  // ROAS ratio; may swap to Shopify-actual in W4/W5.)
  const sparkline14d = dates14.map((d) => byDate.get(d)?.revenue ?? 0);

  const todayRow = byDate.get(todayIso);
  const roasLast24h =
    todayRow && todayRow.spend > 0 ? Number((todayRow.revenue / todayRow.spend).toFixed(2)) : 0;

  // Median ROAS over the 13 days BEFORE today — that's the baseline we
  // compare today against. Skip days with spend=0 or missing data; today
  // is excluded so a partial day doesn't pull the baseline around.
  const priorRoas: number[] = [];
  for (const d of dates14) {
    if (d === todayIso) continue;
    const row = byDate.get(d);
    if (!row || row.spend === 0) continue;
    priorRoas.push(row.revenue / row.spend);
  }
  const roasMedian14d = Number(median(priorRoas).toFixed(2));

  const borderLevel = deriveBorder(roasLast24h, roasMedian14d);

  // "Is any of this data fresh?" — take MAX across bindings (not MIN).
  const syncTimes = (accountsRes.data ?? [])
    .map((r) => r.last_synced_at as string | null)
    .filter((t): t is string => !!t);
  const lastSyncedAt =
    syncTimes.length > 0 ? syncTimes.reduce((a, b) => (a > b ? a : b)) : null;

  return {
    storeId: market.storeId,
    marketCode: market.marketCode,
    name: market.storeName,
    flag: FLAG_BY_MARKET[market.marketCode] ?? "",
    sparkline14d,
    roasLast24h,
    roasMedian14d,
    borderLevel,
    lastSyncedAt,
  };
}

// ============================================================
// Route
// ============================================================

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const todayIso = sofiaDate(new Date());
    const markets = await resolveAllHomeMarkets();
    const stores = await Promise.all(markets.map((m) => buildStoreCard(m, todayIso)));

    const response: StoresResponse = { stores };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/dashboard/home/stores failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
