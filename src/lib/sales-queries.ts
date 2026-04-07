import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { StoreRow } from "@/types/store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoreSchema {
  storeId: string;
  schemaName: string;
  name: string;
  marketCode: string;
}

export interface KpiMetric {
  value: number;
  change: number | null;
}

export interface SalesKpis {
  revenue: KpiMetric;
  orders: KpiMetric;
  aov: KpiMetric;
  refunded: KpiMetric;
  customers: KpiMetric;
}

export interface TrendPoint {
  date: string;
  revenue: number;
  orders: number;
}

// ---------------------------------------------------------------------------
// Store resolution
// ---------------------------------------------------------------------------

export async function fetchActiveStores(): Promise<StoreRow[]> {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("id, organization_id, name, market_code, platform, domain, is_active, settings, created_at, updated_at")
    .eq("is_active", true)
    .order("name");

  if (error) {
    logger.error("Failed to fetch active stores", { error: error.message });
    throw new Error("Failed to fetch active stores");
  }

  return data as StoreRow[];
}

export async function resolveStoreSchemas(
  storesParam: string
): Promise<StoreSchema[]> {
  const allStores = await fetchActiveStores();

  if (allStores.length === 0) {
    throw new Error("No active stores found");
  }

  let filtered: StoreRow[];

  if (storesParam === "all") {
    filtered = allStores;
  } else {
    const ids = storesParam.split(",").map((s) => s.trim());
    filtered = allStores.filter((s) => ids.includes(s.id));
    if (filtered.length === 0) {
      throw new Error("No matching active stores for the provided IDs");
    }
  }

  return filtered.map((s) => ({
    storeId: s.id,
    schemaName: `store_${s.market_code}`,
    name: s.name,
    marketCode: s.market_code,
  }));
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

interface AggRow {
  total_revenue: number;
  total_orders: number;
  avg_order_value: number;
  total_refunded: number;
  unique_customers: number;
}

async function fetchAggregatesForPeriod(
  schema: StoreSchema,
  from: string,
  to: string
): Promise<AggRow[]> {
  const { data, error } = await supabaseAdmin
    .schema(schema.schemaName)
    .from("daily_aggregates")
    .select(
      "total_revenue, total_orders, avg_order_value, total_refunded, unique_customers"
    )
    .gte("order_date", from)
    .lte("order_date", to);

  if (error) {
    logger.error("Failed to fetch aggregates", {
      schema: schema.schemaName,
      from,
      to,
      error: error.message,
    });
    return [];
  }

  return (data ?? []) as AggRow[];
}

function sumAggRows(rows: AggRow[]): {
  revenue: number;
  orders: number;
  refunded: number;
  customers: number;
} {
  let revenue = 0;
  let orders = 0;
  let refunded = 0;
  let customers = 0;

  for (const r of rows) {
    revenue += Number(r.total_revenue);
    orders += Number(r.total_orders);
    refunded += Number(r.total_refunded);
    customers += Number(r.unique_customers);
  }

  return { revenue, orders, refunded, customers };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export async function fetchSalesKpis(
  schemas: StoreSchema[],
  from: string,
  to: string,
  compFrom: string,
  compTo: string
): Promise<SalesKpis> {
  // Fan-out: fetch current + comparison period for all schemas in parallel
  const [currentRows, compRows] = await Promise.all([
    Promise.all(schemas.map((s) => fetchAggregatesForPeriod(s, from, to))),
    Promise.all(schemas.map((s) => fetchAggregatesForPeriod(s, compFrom, compTo))),
  ]);

  const current = sumAggRows(currentRows.flat());
  const comp = sumAggRows(compRows.flat());

  const currentAov = current.orders > 0 ? current.revenue / current.orders : 0;
  const compAov = comp.orders > 0 ? comp.revenue / comp.orders : 0;

  return {
    revenue: { value: current.revenue, change: pctChange(current.revenue, comp.revenue) },
    orders: { value: current.orders, change: pctChange(current.orders, comp.orders) },
    aov: { value: currentAov, change: pctChange(currentAov, compAov) },
    refunded: { value: current.refunded, change: pctChange(current.refunded, comp.refunded) },
    customers: { value: current.customers, change: pctChange(current.customers, comp.customers) },
  };
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

interface DailyRow {
  order_date: string;
  total_revenue: number;
  total_orders: number;
}

export async function fetchSalesTrend(
  schemas: StoreSchema[],
  from: string,
  to: string,
  granularity: "day" | "week" | "month" = "day"
): Promise<TrendPoint[]> {
  // Fetch daily rows from all schemas in parallel
  const allResults = await Promise.all(
    schemas.map(async (s) => {
      const { data, error } = await supabaseAdmin
        .schema(s.schemaName)
        .from("daily_aggregates")
        .select("order_date, total_revenue, total_orders")
        .gte("order_date", from)
        .lte("order_date", to)
        .order("order_date", { ascending: true });

      if (error) {
        logger.error("Failed to fetch trend data", {
          schema: s.schemaName,
          error: error.message,
        });
        return [];
      }

      return (data ?? []) as DailyRow[];
    })
  );

  // Merge all stores by date
  const byDate = new Map<string, { revenue: number; orders: number }>();

  for (const rows of allResults) {
    for (const r of rows) {
      const key = r.order_date;
      const existing = byDate.get(key) ?? { revenue: 0, orders: 0 };
      existing.revenue += Number(r.total_revenue);
      existing.orders += Number(r.total_orders);
      byDate.set(key, existing);
    }
  }

  // Sort by date
  const daily: TrendPoint[] = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, revenue: vals.revenue, orders: vals.orders }));

  if (granularity === "day") return daily;

  // Group by week or month
  return groupTrend(daily, granularity);
}

function groupTrend(
  daily: TrendPoint[],
  granularity: "week" | "month"
): TrendPoint[] {
  const grouped = new Map<string, { revenue: number; orders: number }>();

  for (const point of daily) {
    const key = granularity === "week" ? weekKey(point.date) : monthKey(point.date);
    const existing = grouped.get(key) ?? { revenue: 0, orders: 0 };
    existing.revenue += point.revenue;
    existing.orders += point.orders;
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, revenue: vals.revenue, orders: vals.orders }));
}

function weekKey(dateStr: string): string {
  // ISO week start (Monday)
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setUTCDate(diff);
  return monday.toISOString().split("T")[0];
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01"; // YYYY-MM-01
}

// ---------------------------------------------------------------------------
// Top Products (cross-store, aggregated from daily_aggregates.top_products)
// ---------------------------------------------------------------------------

export interface TopProduct {
  title: string;
  quantity: number;
  revenue: number;
}

export async function fetchTopProducts(
  schemas: StoreSchema[],
  from: string,
  to: string,
  limit: number = 10
): Promise<TopProduct[]> {
  const allResults = await Promise.all(
    schemas.map(async (s) => {
      const { data, error } = await supabaseAdmin
        .schema(s.schemaName)
        .from("daily_aggregates")
        .select("top_products")
        .gte("order_date", from)
        .lte("order_date", to);

      if (error) {
        logger.error("Failed to fetch top products", {
          schema: s.schemaName,
          error: error.message,
        });
        return [];
      }

      return (data ?? []) as { top_products: TopProduct[] | null }[];
    })
  );

  // Merge by title across all days and stores
  const byTitle = new Map<string, { quantity: number; revenue: number }>();

  for (const rows of allResults) {
    for (const row of rows) {
      if (!row.top_products) continue;
      for (const p of row.top_products) {
        const existing = byTitle.get(p.title) ?? { quantity: 0, revenue: 0 };
        existing.quantity += Number(p.quantity);
        existing.revenue += Number(p.revenue);
        byTitle.set(p.title, existing);
      }
    }
  }

  return Array.from(byTitle.entries())
    .map(([title, vals]) => ({ title, ...vals }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Store Performance (per-store KPIs for multi-store comparison table)
// ---------------------------------------------------------------------------

export interface StorePerformance {
  storeId: string;
  storeName: string;
  marketCode: string;
  revenue: number;
  orders: number;
  aov: number;
  revenueChange: number | null;
  ordersChange: number | null;
}

export async function fetchStorePerformance(
  schemas: StoreSchema[],
  from: string,
  to: string,
  compFrom: string,
  compTo: string
): Promise<StorePerformance[]> {
  const results = await Promise.all(
    schemas.map(async (s) => {
      const [currentRows, compRows] = await Promise.all([
        fetchAggregatesForPeriod(s, from, to),
        fetchAggregatesForPeriod(s, compFrom, compTo),
      ]);

      const current = sumAggRows(currentRows);
      const comp = sumAggRows(compRows);
      const aov = current.orders > 0 ? current.revenue / current.orders : 0;

      return {
        storeId: s.storeId,
        storeName: s.name,
        marketCode: s.marketCode,
        revenue: current.revenue,
        orders: current.orders,
        aov,
        revenueChange: pctChange(current.revenue, comp.revenue),
        ordersChange: pctChange(current.orders, comp.orders),
      };
    })
  );

  return results.sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// Store Detail: Orders list (latest state per order)
// ---------------------------------------------------------------------------

export interface OrderRow {
  shopify_order_id: number;
  shopify_order_number: string;
  email: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: number;
  total_refunded: number;
  shopify_created_at: string;
}

export async function fetchStoreOrders(
  schema: StoreSchema,
  from: string,
  to: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ orders: OrderRow[]; total: number }> {
  // Count total orders in range (latest state only, non-cancelled)
  // We use a raw RPC approach since DISTINCT ON isn't directly supported by PostgREST.
  // Instead we fetch orders ordered by received_at DESC and deduplicate client-side.
  const { data: rawOrders, error } = await supabaseAdmin
    .schema(schema.schemaName)
    .from("orders")
    .select(
      "shopify_order_id, shopify_order_number, email, financial_status, fulfillment_status, total_price, total_refunded, shopify_created_at, received_at"
    )
    .gte("shopify_created_at", `${from}T00:00:00`)
    .lte("shopify_created_at", `${to}T23:59:59`)
    .order("received_at", { ascending: false });

  if (error) {
    logger.error("Failed to fetch store orders", {
      schema: schema.schemaName,
      error: error.message,
    });
    return { orders: [], total: 0 };
  }

  // Deduplicate: keep only the latest entry per shopify_order_id
  const seen = new Set<number>();
  const deduped: OrderRow[] = [];
  for (const row of rawOrders ?? []) {
    const r = row as OrderRow & { received_at: string };
    if (seen.has(r.shopify_order_id)) continue;
    seen.add(r.shopify_order_id);
    deduped.push({
      shopify_order_id: r.shopify_order_id,
      shopify_order_number: r.shopify_order_number,
      email: r.email,
      financial_status: r.financial_status,
      fulfillment_status: r.fulfillment_status,
      total_price: Number(r.total_price),
      total_refunded: Number(r.total_refunded),
      shopify_created_at: r.shopify_created_at,
    });
  }

  // Sort by created date descending
  deduped.sort(
    (a, b) =>
      new Date(b.shopify_created_at).getTime() -
      new Date(a.shopify_created_at).getTime()
  );

  return {
    orders: deduped.slice(offset, offset + limit),
    total: deduped.length,
  };
}

// ---------------------------------------------------------------------------
// Store Detail: Connections / metadata
// ---------------------------------------------------------------------------

export async function fetchStoreConnections(storeId: string) {
  const { data: store, error: storeError } = await supabaseAdmin
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .single();

  if (storeError || !store) {
    throw new Error("Store not found");
  }

  const { data: creds, error: credsError } = await supabaseAdmin
    .from("store_credentials")
    .select("service, status, connected_at")
    .eq("store_id", storeId);

  if (credsError) {
    logger.error("Failed to fetch store credentials", {
      storeId,
      error: credsError.message,
    });
  }

  return {
    store: store as StoreRow,
    connections: (creds ?? []).map((c: { service: string; status: string; connected_at: string }) => ({
      service: c.service,
      status: c.status,
      connectedAt: c.connected_at,
    })),
  };
}
