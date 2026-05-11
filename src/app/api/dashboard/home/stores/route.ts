import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  resolveAllHomeMarkets,
  type ResolvedMarket,
} from "@/lib/store-market-resolver";
import { sofiaDate, lastNDates } from "@/lib/sofia-date";
// Canonical BorderLevel lives in StoreCard — the route's payload is what
// that component renders, so the type must stay in sync.
import type { BorderLevel } from "@/components/dashboard/StoreCard";

// ============================================================
// Types
// ============================================================

interface StoreCardPayload {
  /** Store UUID — used as the card-tap target (/sales/store/[storeId]). */
  storeId: string;
  marketCode: string;
  name: string;
  /** 14 values, oldest first, one per day. Zero-filled for missing days. */
  sparkline14d: number[];
  /**
   * Today's spend in EUR. Frontend uses this to distinguish "campaigns
   * paused" (todaySpend === 0) from "spend going but no conversions yet"
   * (todaySpend > 0, roasLast24h === 0) — two states that previously
   * collapsed into a single amber "леко под нормата" label.
   */
  todaySpend: number;
  /** Today's revenue in EUR (Meta-attributed). */
  todayRevenue: number;
  /**
   * Today's Shopify revenue for this store. Drives the "real revenue" column
   * in StoresTable so the row composes with the top-strip business block.
   */
  shopifyTodayRevenue: number;
  /** Today's Shopify orders count for this store. */
  shopifyTodayOrders: number;
  /** Today's ROAS (revenue / spend). 0 when spend is 0 or no data yet. */
  roasLast24h: number;
  /** Median of the prior 13 days' daily ROAS. Days with spend=0 are skipped. */
  roasMedian14d: number;
  borderLevel: BorderLevel;
  /** Most recent sync across all bound integration_accounts. ISO timestamp. */
  lastSyncedAt: string | null;
  /**
   * MAX(created_at) across all bound integration_accounts. FreshnessDot uses
   * this to distinguish "freshly bound, cron hasn't fired yet" (amber) from
   * "never synced, something is broken" (red).
   */
  accountCreatedAt: string | null;
}

interface StoresResponse {
  stores: StoreCardPayload[];
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

const num = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
};

async function buildStoreCard(
  market: ResolvedMarket,
  todayIso: string
): Promise<StoreCardPayload> {
  const dates14 = lastNDates(14, todayIso);
  const oldest = dates14[0];

  // Parallel: 14-day Meta insights + last_synced_at + today's Shopify
  // daily_aggregates for this specific store's schema (store_bg /
  // store_gr / store_ro). The Shopify row gives the row in StoresTable
  // a real "приходи днес" column that composes with the top-strip
  // business block.
  const storeSchema = `store_${market.marketCode}`;
  const [insightsRes, accountsRes, shopifyTodayRes] = await Promise.all([
    supabaseAdmin
      .from("meta_insights_by_store")
      .select("date, spend, revenue")
      .eq("store_id", market.storeId)
      .eq("level", "account")
      .gte("date", oldest)
      .lte("date", todayIso),
    supabaseAdmin
      .from("integration_accounts")
      .select("last_synced_at, created_at")
      .in("id", market.allIntegrationAccountIds),
    supabaseAdmin
      .schema(storeSchema)
      .from("daily_aggregates")
      .select("total_revenue, total_orders")
      .eq("order_date", todayIso)
      .maybeSingle(),
  ]);

  if (insightsRes.error) throw new Error(insightsRes.error.message);
  if (accountsRes.error) throw new Error(accountsRes.error.message);
  // Don't throw on Shopify miss — a brand-new store with no daily_aggregates
  // row yet shouldn't break the whole stores endpoint.
  if (shopifyTodayRes.error) {
    logger.error("stores: shopify daily_aggregates fetch failed", {
      storeSchema,
      error: shopifyTodayRes.error.message,
    });
  }

  const rows = (insightsRes.data ?? []) as InsightRow[];
  const byDate = new Map<string, { spend: number; revenue: number }>();
  // The view returns one row per (date, object_id) at level=account, so a
  // BG-style store with multiple active bindings (Cvetita primary +
  // ProteinBar + legacy) yields several rows per date. Accumulate instead
  // of overwriting so the card reflects the total business, not just the
  // last row Postgres returned.
  for (const r of rows) {
    const existing = byDate.get(r.date) ?? { spend: 0, revenue: 0 };
    byDate.set(r.date, {
      spend: existing.spend + num(r.spend),
      revenue: existing.revenue + num(r.revenue),
    });
  }

  // Sparkline: revenue per day, zero-filled. (Footnote in 08-week3-plan.md
  // §2b: v1 uses Meta-reported revenue for internal consistency with the
  // ROAS ratio; may swap to Shopify-actual in W4/W5.)
  const sparkline14d = dates14.map((d) => byDate.get(d)?.revenue ?? 0);

  const todayRow = byDate.get(todayIso);
  const todaySpend = Number((todayRow?.spend ?? 0).toFixed(2));
  const todayRevenue = Number((todayRow?.revenue ?? 0).toFixed(2));

  const shopifyToday = shopifyTodayRes.data as {
    total_revenue: number | string | null;
    total_orders: number | string | null;
  } | null;
  const shopifyTodayRevenue = Number(num(shopifyToday?.total_revenue).toFixed(2));
  const shopifyTodayOrders = num(shopifyToday?.total_orders);
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
  // MAX(created_at) pairs with MAX(last_synced_at): if the newest binding
  // was just added, FreshnessDot enters its grace window.
  const accountRows = (accountsRes.data ?? []) as Array<{
    last_synced_at: string | null;
    created_at: string | null;
  }>;
  const syncTimes = accountRows
    .map((r) => r.last_synced_at)
    .filter((t): t is string => !!t);
  const createdTimes = accountRows
    .map((r) => r.created_at)
    .filter((t): t is string => !!t);
  const lastSyncedAt =
    syncTimes.length > 0 ? syncTimes.reduce((a, b) => (a > b ? a : b)) : null;
  const accountCreatedAt =
    createdTimes.length > 0 ? createdTimes.reduce((a, b) => (a > b ? a : b)) : null;

  return {
    storeId: market.storeId,
    marketCode: market.marketCode,
    name: market.storeName,
    sparkline14d,
    todaySpend,
    todayRevenue,
    shopifyTodayRevenue,
    shopifyTodayOrders,
    roasLast24h,
    roasMedian14d,
    borderLevel,
    lastSyncedAt,
    accountCreatedAt,
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
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
