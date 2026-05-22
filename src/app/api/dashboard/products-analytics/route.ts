import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { parseDateParams } from "@/lib/api-utils";
import { fetchAllProducts } from "@/lib/shopify";
import { requireAuth } from "@/lib/api-auth";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { runReport, isGA4Configured } from "@/lib/ga4";

const STORE_URL = process.env.SHOPIFY_STORE_URL!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;

// Below this many GA4 item-views a product's conversion ratio is
// statistical noise (2 views / 1 purchase = 50%) — it is not plotted
// on the diagnostic matrix but parked in the "insufficient" bucket.
const MATRIX_MIN_VIEWS = 30;

type Quadrant = "star" | "leaking" | "gem" | "dormant" | "insufficient";

interface LineItem {
  title: string;
  quantity: number;
  price: string;
  product_id: number;
}

interface Order {
  total_price: string;
  financial_status: string;
  cancelled_at: string | null;
  created_at: string;
  line_items: LineItem[];
}

async function fetchOrdersForRange(from: string, to: string): Promise<Order[]> {
  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T23:59:59.999Z");

  const orders: Order[] = [];
  let url: string | null =
    `https://${STORE_URL}/admin/api/2024-10/orders.json?` +
    new URLSearchParams({
      created_at_min: fromDate.toISOString(),
      created_at_max: toDate.toISOString(),
      status: "any",
      limit: "250",
      fields: "total_price,financial_status,cancelled_at,created_at,line_items",
    }).toString();

  while (url) {
    const res: Response = await fetchWithTimeout(
      url,
      { headers: { "X-Shopify-Access-Token": ACCESS_TOKEN } },
      15_000
    );
    if (!res.ok) break;
    const data = await res.json();
    orders.push(...(data.orders || []));
    const link = res.headers.get("Link");
    const next = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  return orders.filter(
    (o) =>
      ["paid", "pending", "partially_paid", "authorized"].includes(o.financial_status) &&
      !o.cancelled_at
  );
}

interface ProductCatalogItem {
  title: string;
  handle: string;
  imageUrl: string | null;
}

interface GA4Item {
  views: number;
  purchases: number;
  revenue: number;
}

/**
 * GA4 per-product attention & conversion, keyed by Shopify product_id.
 * GA4 embeds it in itemId as `shopify_<market>_<productId>_<variantId>`;
 * we roll variants up to the product. Best-effort — a GA4 outage drops
 * the matrix, never the page (principle 8).
 */
async function fetchGA4Items(from: string, to: string): Promise<Map<string, GA4Item>> {
  const map = new Map<string, GA4Item>();
  if (!isGA4Configured()) return map;
  try {
    const rows = await runReport({
      metrics: ["itemsViewed", "itemsPurchased", "itemRevenue"],
      dimensions: ["itemId"],
      startDate: from,
      endDate: to,
      limit: 500,
    });
    for (const r of rows) {
      const itemId = r.dimensionValues?.[0]?.value || "";
      const m = itemId.match(/(\d{6,})[_-](\d{6,})/);
      const productId = m ? m[1] : null;
      if (!productId) continue;
      const views = parseInt(r.metricValues?.[0]?.value || "0", 10);
      const purchases = parseInt(r.metricValues?.[1]?.value || "0", 10);
      const revenue = parseFloat(r.metricValues?.[2]?.value || "0");
      const e = map.get(productId) || { views: 0, purchases: 0, revenue: 0 };
      e.views += views;
      e.purchases += purchases;
      e.revenue += revenue;
      map.set(productId, e);
    }
  } catch (error) {
    logger.error("GA4 items fetch failed", { error: String(error) });
  }
  return map;
}

function analyzeOrders(orders: Order[], catalog: Map<string, ProductCatalogItem> = new Map()) {
  // Keyed by Shopify product_id (stable) — falls back to title only for
  // line items with no product_id (custom items, deleted products).
  const productMap = new Map<
    string,
    { productId: string | null; title: string; quantity: number; revenue: number; orders: number }
  >();
  const combos = new Map<string, number>();
  const dailyRevenue = new Map<string, number>();

  for (const order of orders) {
    const day = order.created_at.split("T")[0];
    dailyRevenue.set(day, (dailyRevenue.get(day) || 0) + parseFloat(order.total_price));

    const titles = new Set<string>();
    for (const item of order.line_items || []) {
      const productId = item.product_id ? String(item.product_id) : null;
      const key = productId ?? `t:${item.title}`;
      const existing =
        productMap.get(key) || { productId, title: item.title, quantity: 0, revenue: 0, orders: 0 };
      existing.quantity += item.quantity;
      existing.revenue += parseFloat(item.price) * item.quantity;
      existing.orders += 1;
      productMap.set(key, existing);
      titles.add(item.title);
    }

    if (titles.size >= 2) {
      const sorted = Array.from(titles).sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]} + ${sorted[j]}`;
          combos.set(key, (combos.get(key) || 0) + 1);
        }
      }
    }
  }

  const allProducts = Array.from(productMap.values())
    .map((data) => {
      const catalogItem = catalog.get(data.title);
      return {
        productId: data.productId,
        title: data.title,
        handle: catalogItem?.handle || null,
        imageUrl: catalogItem?.imageUrl || null,
        quantity: data.quantity,
        orders: data.orders,
        revenue: Math.round(data.revenue * 100) / 100,
        avgPrice: data.quantity > 0 ? Math.round((data.revenue / data.quantity) * 100) / 100 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const topCombos = Array.from(combos.entries())
    .map(([combo, count]) => ({ combo, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalRevenue = orders.reduce((s, o) => s + parseFloat(o.total_price), 0);
  const totalOrders = orders.length;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const multiItemOrders = orders.filter((o) => (o.line_items?.length || 0) > 1).length;
  const upsellRate = totalOrders > 0 ? (multiItemOrders / totalOrders) * 100 : 0;

  const timeSeries = Array.from(dailyRevenue.entries())
    .map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    summary: {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalOrders,
      avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      uniqueProducts: productMap.size,
      upsellRate: Math.round(upsellRate * 10) / 10,
    },
    allProducts,
    topCombos,
    timeSeries,
  };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const dates = parseDateParams(req);

    const [currentOrders, compOrders, shopifyProducts, ga4Items] = await Promise.all([
      fetchOrdersForRange(dates.from, dates.to),
      fetchOrdersForRange(dates.compFrom, dates.compTo),
      fetchAllProducts(),
      fetchGA4Items(dates.from, dates.to),
    ]);

    const catalog = new Map<string, ProductCatalogItem>();
    for (const p of shopifyProducts) {
      catalog.set(p.title, {
        title: p.title,
        handle: p.handle,
        imageUrl: p.image?.src || null,
      });
    }

    const current = analyzeOrders(currentOrders, catalog);
    const comparison = analyzeOrders(compOrders);

    // Join GA4 attention/conversion onto each sold product.
    const enriched = current.allProducts.map((p) => {
      const g = p.productId ? ga4Items.get(p.productId) : undefined;
      const ga4Views = g?.views ?? 0;
      const ga4Purchases = g?.purchases ?? 0;
      return {
        ...p,
        ga4Views,
        ga4Purchases,
        // GA4-native conversion: items purchased per item viewed.
        conversionRate: ga4Views > 0 ? ga4Purchases / ga4Views : 0,
      };
    });

    // Quadrant — median split of the products that clear the data gate.
    // Median (not zero) is the honest divider: it asks "above or below
    // typical", which is the diagnostic question (contract §9.7).
    const plottable = enriched.filter((p) => p.ga4Views >= MATRIX_MIN_VIEWS);
    const medianViews = median(plottable.map((p) => p.ga4Views));
    const medianConversion = median(plottable.map((p) => p.conversionRate));

    const allProducts = enriched.map((p) => {
      let quadrant: Quadrant;
      if (p.ga4Views < MATRIX_MIN_VIEWS) {
        quadrant = "insufficient";
      } else if (p.ga4Views >= medianViews) {
        quadrant = p.conversionRate >= medianConversion ? "star" : "leaking";
      } else {
        quadrant = p.conversionRate >= medianConversion ? "gem" : "dormant";
      }
      return { ...p, quadrant };
    });

    const calcChange = (curr: number, prev: number) =>
      prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 1000) / 10;

    return NextResponse.json({
      period: dates.label,
      from: dates.from,
      to: dates.to,
      summary: current.summary,
      allProducts,
      topCombos: current.topCombos,
      timeSeries: current.timeSeries,
      matrixMeta: {
        ga4Available: isGA4Configured(),
        minViews: MATRIX_MIN_VIEWS,
        medianViews,
        medianConversion,
        plottableCount: plottable.length,
      },
      comparison: {
        totalRevenue: comparison.summary.totalRevenue,
        totalOrders: comparison.summary.totalOrders,
        avgOrderValue: comparison.summary.avgOrderValue,
        upsellRate: comparison.summary.upsellRate,
      },
      changes: {
        revenue: calcChange(current.summary.totalRevenue, comparison.summary.totalRevenue),
        orders: calcChange(current.summary.totalOrders, comparison.summary.totalOrders),
        aov: calcChange(current.summary.avgOrderValue, comparison.summary.avgOrderValue),
        upsellRate: calcChange(current.summary.upsellRate, comparison.summary.upsellRate),
      },
    });
  } catch (error) {
    logger.error("Products analytics error", { error: String(error) });
    return NextResponse.json({ error: "Products analytics fetch failed" }, { status: 500 });
  }
}
