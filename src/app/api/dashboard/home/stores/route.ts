import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  resolveAllHomeMarkets,
  type ResolvedMarket,
} from "@/lib/store-market-resolver";
import {
  lastNDates,
  resolveDateWindow,
  shiftDate,
  type DateWindow,
} from "@/lib/sofia-date";
// Canonical BorderLevel lives in store-state — the route's payload is what
// the home dashboard renders, so the type must stay in sync.
import type { BorderLevel } from "@/components/dashboard/store-state";
import { fetchGoogleAdsByDate, sumGoogleAds } from "@/lib/google-ads-by-date";
import { getGA4PropertyForMarket } from "@/lib/google-ads-markets";

// ============================================================
// Types
//
// Field names stay anchored on "today" for backwards compatibility (the
// TopBarStoreSwitcher and `deriveDisplayState` consume them). When the
// dashboard filter selects a range, these fields carry the SUM over that
// range — semantics are documented per-field.
// ============================================================

interface StoreCardPayload {
  storeId: string;
  marketCode: string;
  name: string;
  /**
   * 14 values, oldest first, one per day. Anchored to the trailing 14
   * days ending at `window.to` so the sparkline stays a stable visual
   * baseline regardless of the selected window.
   */
  sparkline14d: number[];
  /**
   * Meta spend over the selected window (EUR). Frontend uses 0 to mean
   * "campaigns paused / no activity in this window".
   */
  todaySpend: number;
  /** Meta-attributed revenue over the selected window (EUR). */
  todayRevenue: number;
  /** Shopify revenue over the selected window (EUR). */
  shopifyTodayRevenue: number;
  /** Shopify orders count over the selected window. */
  shopifyTodayOrders: number;
  /** ROAS over the window = revenue / spend. 0 when spend is 0. */
  roasLast24h: number;
  /**
   * Median ROAS of the trailing 14 days ending at `window.to`, excluding
   * the window itself (so the baseline isn't compared against itself).
   */
  roasMedian14d: number;
  borderLevel: BorderLevel;
  lastSyncedAt: string | null;
  accountCreatedAt: string | null;
  /**
   * Google Ads totals over the selected window. Null when this market has
   * no GA4 property bound (see GA4_BOUND_MARKETS) — UI renders "—".
   */
  googleAds: {
    spend: number;
    revenue: number;
    roas: number;
    purchases: number;
  } | null;
}

interface StoresResponse {
  window: {
    from: string;
    to: string;
    preset: DateWindow["preset"];
    days: number;
  };
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

function deriveBorder(current: number, medianRoas: number): BorderLevel {
  if (medianRoas === 0 || current === 0) return "amber";
  const ratio = current / medianRoas;
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

/** Inclusive ISO date range expanded forward. Capped at 366 days. */
function expandRange(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let cursor = fromIso;
  let guard = 0;
  while (cursor <= toIso && guard < 366) {
    out.push(cursor);
    cursor = shiftDate(cursor, -1);
    guard++;
  }
  return out;
}

async function buildStoreCard(
  market: ResolvedMarket,
  windowSpec: DateWindow
): Promise<StoreCardPayload> {
  // Sparkline anchor: trailing 14 days ending at window.to. Stable
  // visual baseline regardless of selected window.
  const dates14 = lastNDates(14, windowSpec.to);
  const windowDates = expandRange(windowSpec.from, windowSpec.to);

  // Baseline for the median ROAS comparison: the 14 days immediately
  // preceding the selected window. Using "trailing 14d ending at
  // window.to" instead would shrink to 0 for 14d+ ranges (every day
  // would be inside the window) and the border would always be amber.
  const baselineEnd = shiftDate(windowSpec.from, 1); // day before window
  const baselineDates = lastNDates(14, baselineEnd);

  // Union of dates we need to query Meta for: sparkline + window +
  // baseline. Deduped because they overlap for short windows.
  const insightsDates = Array.from(
    new Set<string>([...dates14, ...windowDates, ...baselineDates])
  );
  const oldestInsight = insightsDates.reduce(
    (acc, d) => (acc < d ? acc : d),
    insightsDates[0]
  );
  const newestInsight = insightsDates.reduce(
    (acc, d) => (acc > d ? acc : d),
    insightsDates[0]
  );

  const storeSchema = `store_${market.marketCode}`;
  // Google Ads only for markets with a GA4 property bound — currently BG + GR.
  // getGA4PropertyForMarket returns null for unbound markets; we resolve them
  // with an empty map so the rest of the pipeline doesn't branch on
  // conditional types, and the final payload is null.
  const ga4PropertyId = getGA4PropertyForMarket(market.marketCode);

  const [insightsRes, accountsRes, shopifyWindowRes, googleAdsByDate] = await Promise.all([
    supabaseAdmin
      .from("meta_insights_by_store")
      .select("date, spend, revenue")
      .eq("store_id", market.storeId)
      .eq("level", "account")
      .gte("date", oldestInsight)
      .lte("date", newestInsight),
    supabaseAdmin
      .from("integration_accounts")
      .select("last_synced_at, created_at")
      .in("id", market.allIntegrationAccountIds),
    // Shopify aggregates over the SELECTED window (sums into the store's
    // "приходи" cell). Sparkline stays on Meta, so we don't ask Shopify
    // for the 14d trail.
    supabaseAdmin.rpc("read_store_daily_aggregates", {
      p_schema: storeSchema,
      p_dates: windowDates,
    }),
    ga4PropertyId
      ? fetchGoogleAdsByDate(windowDates, ga4PropertyId)
      : Promise.resolve(new Map<string, { spend: number; revenue: number; purchases: number }>()),
  ]);

  if (insightsRes.error) throw new Error(insightsRes.error.message);
  if (accountsRes.error) throw new Error(accountsRes.error.message);
  if (shopifyWindowRes.error) {
    logger.error("stores: shopify daily_aggregates fetch failed", {
      storeSchema,
      error: shopifyWindowRes.error.message,
    });
  }

  const rows = (insightsRes.data ?? []) as InsightRow[];
  const byDate = new Map<string, { spend: number; revenue: number }>();
  // Multiple bindings per store (e.g. BG: Cvetita + ProteinBar + legacy)
  // produce multiple rows per date at level=account. Accumulate, don't
  // overwrite.
  for (const r of rows) {
    const existing = byDate.get(r.date) ?? { spend: 0, revenue: 0 };
    byDate.set(r.date, {
      spend: existing.spend + num(r.spend),
      revenue: existing.revenue + num(r.revenue),
    });
  }

  // Sparkline: always Meta-revenue per day across the trailing 14d.
  const sparkline14d = dates14.map((d) => byDate.get(d)?.revenue ?? 0);

  // Aggregate Meta over the selected window.
  let windowSpend = 0;
  let windowRevenue = 0;
  for (const d of windowDates) {
    const row = byDate.get(d);
    if (!row) continue;
    windowSpend += row.spend;
    windowRevenue += row.revenue;
  }
  const todaySpend = Number(windowSpend.toFixed(2));
  const todayRevenue = Number(windowRevenue.toFixed(2));
  const roasLast24h =
    windowSpend > 0 ? Number((windowRevenue / windowSpend).toFixed(2)) : 0;

  // Shopify totals over window.
  const shopifyRows = (shopifyWindowRes.data ?? []) as Array<{
    order_date: string;
    total_revenue: number | string | null;
    total_orders: number | string | null;
  }>;
  let shopifyRevenueSum = 0;
  let shopifyOrdersSum = 0;
  for (const r of shopifyRows) {
    shopifyRevenueSum += num(r.total_revenue);
    shopifyOrdersSum += num(r.total_orders);
  }
  const shopifyTodayRevenue = Number(shopifyRevenueSum.toFixed(2));
  const shopifyTodayOrders = shopifyOrdersSum;

  // Median ROAS over the 14 days immediately BEFORE the selected window.
  // Skip days with spend=0. Baseline is independent of window length so
  // a 30d/90d window still has a meaningful comparison anchor.
  const priorRoas: number[] = [];
  for (const d of baselineDates) {
    const row = byDate.get(d);
    if (!row || row.spend === 0) continue;
    priorRoas.push(row.revenue / row.spend);
  }
  const roasMedian14d = Number(median(priorRoas).toFixed(2));

  const borderLevel = deriveBorder(roasLast24h, roasMedian14d);

  // Freshness: MAX across all bound accounts.
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
    createdTimes.length > 0
      ? createdTimes.reduce((a, b) => (a > b ? a : b))
      : null;

  // Google Ads payload — null for markets without a GA4 property. The map
  // is empty for those (resolved above), so calling sumGoogleAds is safe;
  // we just gate the assembly so the UI gets a clean "no data" signal.
  let googleAds: StoreCardPayload["googleAds"] = null;
  if (ga4PropertyId) {
    const ga = sumGoogleAds(googleAdsByDate, windowDates);
    if (ga.spend > 0 || ga.revenue > 0 || ga.purchases > 0) {
      googleAds = {
        spend: Number(ga.spend.toFixed(2)),
        revenue: Number(ga.revenue.toFixed(2)),
        roas: ga.spend > 0 ? Number((ga.revenue / ga.spend).toFixed(2)) : 0,
        purchases: ga.purchases,
      };
    }
  }

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
    googleAds,
  };
}

// ============================================================
// Route
// ============================================================

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const window = resolveDateWindow(req.nextUrl.searchParams);
    const markets = await resolveAllHomeMarkets();
    const stores = await Promise.all(
      markets.map((m) => buildStoreCard(m, window))
    );

    const response: StoresResponse = {
      window: {
        from: window.from,
        to: window.to,
        preset: window.preset,
        days: window.days,
      },
      stores,
    };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/dashboard/home/stores failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
