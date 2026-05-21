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
} {
  let revenue = 0;
  let orders = 0;
  let refunded = 0;

  for (const r of rows) {
    revenue += Number(r.total_revenue);
    orders += Number(r.total_orders);
    refunded += Number(r.total_refunded);
  }

  return { revenue, orders, refunded };
}

// Period-distinct unique customers — daily_aggregates.unique_customers is
// per-day, so summing across N days double-counts repeat buyers. We call
// period_unique_customers RPC per schema (a true COUNT(DISTINCT email)
// over the whole window) and then add the per-store counts. Cross-store
// double counting is not addressed here; for a single-store dashboard
// this is exact, and the multi-store sum is a slight upper bound.
async function sumPeriodCustomers(
  schemas: StoreSchema[],
  from: string,
  to: string
): Promise<number> {
  let total = 0;
  await Promise.all(
    schemas.map(async (s) => {
      const { data, error } = await supabaseAdmin.rpc("period_unique_customers", {
        p_schema: s.schemaName,
        p_from: from,
        p_to: to,
      });
      if (error) {
        logger.error("Failed period_unique_customers", { schema: s.schemaName, error: error.message });
        return;
      }
      total += Number(data ?? 0);
    })
  );
  return total;
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
  // Fan-out: revenue/orders/refunded come from daily_aggregates (additive,
  // exact); unique customers come from a period-distinct RPC (see comment
  // on sumPeriodCustomers).
  const [currentRows, compRows, currentCustomers, compCustomers] = await Promise.all([
    Promise.all(schemas.map((s) => fetchAggregatesForPeriod(s, from, to))),
    Promise.all(schemas.map((s) => fetchAggregatesForPeriod(s, compFrom, compTo))),
    sumPeriodCustomers(schemas, from, to),
    sumPeriodCustomers(schemas, compFrom, compTo),
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
    customers: { value: currentCustomers, change: pctChange(currentCustomers, compCustomers) },
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
  // Reads orders directly via top_products_for_period RPC. We previously
  // summed daily_aggregates.top_products, but that JSONB only retains the
  // top 5 products per day — long-tail products that never enter a daily
  // top-5 leak out, undercounting them across multi-day windows.
  // Per-store fetch limit is widened (limit * 5, min 50) so cross-store
  // merging has enough headroom before the final ranking + slice.
  const perSchemaLimit = Math.max(50, limit * 5);

  const allResults = await Promise.all(
    schemas.map(async (s) => {
      const { data, error } = await supabaseAdmin.rpc("top_products_for_period", {
        p_schema: s.schemaName,
        p_from: from,
        p_to: to,
        p_limit: perSchemaLimit,
      });

      if (error) {
        logger.error("Failed to fetch top products", {
          schema: s.schemaName,
          error: error.message,
        });
        return [] as TopProduct[];
      }

      return (data ?? []) as TopProduct[];
    })
  );

  // Merge by title across stores
  const byTitle = new Map<string, { quantity: number; revenue: number }>();
  for (const rows of allResults) {
    for (const p of rows) {
      const existing = byTitle.get(p.title) ?? { quantity: 0, revenue: 0 };
      existing.quantity += Number(p.quantity);
      existing.revenue += Number(p.revenue);
      byTitle.set(p.title, existing);
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
  total_price: number;          // EUR (normalised)
  total_refunded: number;       // EUR (normalised)
  shopify_created_at: string;
  // Original shop-currency values + rate, for the per-row tooltip on
  // non-EUR stores (RO/RON today). Always present, but UI only surfaces
  // them when currency !== 'EUR'.
  currency: string;
  total_price_shop: number;
  exchange_rate_to_eur: number;
}

export async function fetchStoreOrders(
  schema: StoreSchema,
  from: string,
  to: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ orders: OrderRow[]; total: number }> {
  const { data: rawOrders, error } = await supabaseAdmin
    .schema(schema.schemaName)
    .from("orders")
    .select(
      "shopify_order_id, shopify_order_number, email, financial_status, fulfillment_status, total_price, total_price_eur, total_refunded_eur, currency, exchange_rate_to_eur, shopify_created_at, received_at"
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
    const r = row as {
      shopify_order_id: number;
      shopify_order_number: string;
      email: string | null;
      financial_status: string;
      fulfillment_status: string | null;
      total_price: string | number;
      total_price_eur: string | number;
      total_refunded_eur: string | number;
      currency: string;
      exchange_rate_to_eur: string | number;
      shopify_created_at: string;
      received_at: string;
    };
    if (seen.has(r.shopify_order_id)) continue;
    seen.add(r.shopify_order_id);
    deduped.push({
      shopify_order_id: r.shopify_order_id,
      shopify_order_number: r.shopify_order_number,
      email: r.email,
      financial_status: r.financial_status,
      fulfillment_status: r.fulfillment_status,
      total_price: Number(r.total_price_eur),
      total_refunded: Number(r.total_refunded_eur),
      shopify_created_at: r.shopify_created_at,
      currency: r.currency,
      total_price_shop: Number(r.total_price),
      exchange_rate_to_eur: Number(r.exchange_rate_to_eur),
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

// ---------------------------------------------------------------------------
// Hour × Weekday rhythm — for the /sales heatmap
// ---------------------------------------------------------------------------

/** One bucket of the 7×24 = 168 weekday/hour grid. weekday is ISO (1=Mon, 7=Sun). */
export interface HourWeekdayBucket {
  weekday: number;
  hour: number;
  revenue: number;
  orders: number;
}

interface HourWeekdayRpcRow {
  weekday: number;
  hour: number;
  total_revenue: string | number;
  total_orders: string | number;
}

/**
 * Cross-store hour × ISO-weekday aggregation for the period. Calls
 * read_store_hour_weekday(p_schema, p_from, p_to) per schema and sums
 * the 168 buckets across stores. Always returns exactly 168 rows.
 */
export async function fetchHourWeekday(
  schemas: StoreSchema[],
  from: string,
  to: string
): Promise<HourWeekdayBucket[]> {
  const all = await Promise.all(
    schemas.map(async (s) => {
      const { data, error } = await supabaseAdmin.rpc("read_store_hour_weekday", {
        p_schema: s.schemaName,
        p_from: from,
        p_to: to,
      });

      if (error) {
        logger.error("Failed read_store_hour_weekday", {
          schema: s.schemaName,
          error: error.message,
        });
        return [] as HourWeekdayRpcRow[];
      }
      return (data ?? []) as HourWeekdayRpcRow[];
    })
  );

  // Build a dense 7×24 grid keyed by `${wd}-${h}` so per-store sums
  // accumulate cleanly even if a store returns no rows for a bucket
  // (the RPC zero-fills per schema, but the schema-level merge still
  // needs to handle the empty-schema case).
  const grid = new Map<string, HourWeekdayBucket>();
  for (let wd = 1; wd <= 7; wd++) {
    for (let h = 0; h <= 23; h++) {
      grid.set(`${wd}-${h}`, { weekday: wd, hour: h, revenue: 0, orders: 0 });
    }
  }
  for (const rows of all) {
    for (const r of rows) {
      const key = `${r.weekday}-${r.hour}`;
      const cell = grid.get(key);
      if (!cell) continue;
      cell.revenue += Number(r.total_revenue);
      cell.orders += Number(r.total_orders);
    }
  }
  return Array.from(grid.values());
}

// ---------------------------------------------------------------------------
// Sales by country — for the world-map view
// ---------------------------------------------------------------------------

/** Aggregated sales for one ISO alpha-2 country across the period. */
export interface CountrySales {
  countryCode: string;
  revenue: number;
  orders: number;
  customers: number;
}

interface CountryRpcRow {
  country_code: string;
  total_revenue: string | number;
  total_orders: string | number;
  unique_customers: string | number;
}

/**
 * Cross-store sales aggregated by shipping country (ISO alpha-2).
 * Customers are summed cross-schema rather than DISTINCT-ed — same
 * single-store-exact / multi-store-upper-bound trade-off the unique
 * customers aggregator already makes.
 */
export async function fetchSalesByCountry(
  schemas: StoreSchema[],
  from: string,
  to: string
): Promise<CountrySales[]> {
  const all = await Promise.all(
    schemas.map(async (s) => {
      const { data, error } = await supabaseAdmin.rpc("read_store_sales_by_country", {
        p_schema: s.schemaName,
        p_from: from,
        p_to: to,
      });

      if (error) {
        logger.error("Failed read_store_sales_by_country", {
          schema: s.schemaName,
          error: error.message,
        });
        return [] as CountryRpcRow[];
      }
      return (data ?? []) as CountryRpcRow[];
    })
  );

  const byCountry = new Map<string, CountrySales>();
  for (const rows of all) {
    for (const r of rows) {
      const code = r.country_code;
      if (!code) continue;
      const existing = byCountry.get(code) ?? {
        countryCode: code,
        revenue: 0,
        orders: 0,
        customers: 0,
      };
      existing.revenue += Number(r.total_revenue);
      existing.orders += Number(r.total_orders);
      existing.customers += Number(r.unique_customers);
      byCountry.set(code, existing);
    }
  }

  return Array.from(byCountry.values()).sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// Sales by city — for the world-map pulsing dots overlay
// ---------------------------------------------------------------------------

/** Aggregated sales for one (country, city) tuple across the period. */
export interface CitySales {
  countryCode: string;
  city: string;
  revenue: number;
  orders: number;
  customers: number;
}

interface CityRpcRow {
  country_code: string;
  city: string;
  total_revenue: string | number;
  total_orders: string | number;
  unique_customers: string | number;
}

/**
 * Cross-store sales aggregated by (country, city). City strings come back
 * raw from Shopify — alias normalisation + lat/lng resolution happens on
 * the client against `src/lib/geo/cities.ts` so we can iterate the alias
 * table without redeploying the DB.
 */
export async function fetchSalesByCity(
  schemas: StoreSchema[],
  from: string,
  to: string
): Promise<CitySales[]> {
  const all = await Promise.all(
    schemas.map(async (s) => {
      const { data, error } = await supabaseAdmin.rpc("read_store_sales_by_city", {
        p_schema: s.schemaName,
        p_from: from,
        p_to: to,
      });

      if (error) {
        logger.error("Failed read_store_sales_by_city", {
          schema: s.schemaName,
          error: error.message,
        });
        return [] as CityRpcRow[];
      }
      return (data ?? []) as CityRpcRow[];
    })
  );

  // Merge across schemas by (countryCode, city) lowercased for the key,
  // but preserve the raw city string from the first row so the client
  // sees the actual Shopify-provided spelling.
  const byKey = new Map<string, CitySales>();
  for (const rows of all) {
    for (const r of rows) {
      if (!r.country_code || !r.city) continue;
      const key = `${r.country_code}|${r.city.toLowerCase()}`;
      const existing = byKey.get(key) ?? {
        countryCode: r.country_code,
        city: r.city,
        revenue: 0,
        orders: 0,
        customers: 0,
      };
      existing.revenue += Number(r.total_revenue);
      existing.orders += Number(r.total_orders);
      existing.customers += Number(r.unique_customers);
      byKey.set(key, existing);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// Order points — per-(lat,lng) office aggregation for the hierarchical
// zoom-driven dot view on /sales/geography. Per migration 042: returns
// rows only for schemas whose Shopify payloads carry shipping_address
// latitude/longitude (currently store_bg). Foreign-store schemas
// (PII-redacted webhooks) return zero rows here; those markets fall
// back to the city-centroid path via fetchSalesByCity.
// ---------------------------------------------------------------------------

/** Aggregated sales for one (lat, lng) office address across the period. */
export interface OfficePoint {
  lat: number;
  lng: number;
  countryCode: string;
  city: string;
  address1: string;
  zip: string;
  revenue: number;
  orders: number;
  customers: number;
}

interface OfficePointRpcRow {
  lat: number;
  lng: number;
  country_code: string;
  city: string | null;
  address1: string | null;
  zip: string | null;
  total_revenue: string | number;
  total_orders: string | number;
  unique_customers: string | number;
}

/**
 * Cross-store per-(lat,lng) order aggregation. Same office in two
 * schemas (unlikely but possible if a shop migrates) would merge by
 * coordinate key — we round to 5 decimal places (~1.1m on the equator)
 * to dedupe Shopify's occasional floating-point drift while keeping
 * meaningfully separate offices distinct.
 */
export async function fetchOrderPoints(
  schemas: StoreSchema[],
  from: string,
  to: string
): Promise<OfficePoint[]> {
  const all = await Promise.all(
    schemas.map(async (s) => {
      const { data, error } = await supabaseAdmin.rpc("read_store_order_points", {
        p_schema: s.schemaName,
        p_from: from,
        p_to: to,
      });

      if (error) {
        logger.error("Failed read_store_order_points", {
          schema: s.schemaName,
          error: error.message,
        });
        return [] as OfficePointRpcRow[];
      }
      return (data ?? []) as OfficePointRpcRow[];
    })
  );

  // Merge by quantised (lat, lng) key — 5 decimals = ~1.1m precision,
  // tight enough that two different offices never collide while loose
  // enough that the same office across schemas merges deterministically.
  const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
  const byKey = new Map<string, OfficePoint>();
  for (const rows of all) {
    for (const r of rows) {
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const key = `${round5(lat)}|${round5(lng)}`;
      const existing = byKey.get(key) ?? {
        lat: round5(lat),
        lng: round5(lng),
        countryCode: r.country_code,
        city: r.city ?? "",
        address1: r.address1 ?? "",
        zip: r.zip ?? "",
        revenue: 0,
        orders: 0,
        customers: 0,
      };
      existing.revenue += Number(r.total_revenue);
      existing.orders += Number(r.total_orders);
      existing.customers += Number(r.unique_customers);
      byKey.set(key, existing);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => b.revenue - a.revenue);
}
