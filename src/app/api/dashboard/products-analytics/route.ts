import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { parseDateParams } from "@/lib/api-utils";
import { fetchAllProducts } from "@/lib/shopify";
import { requireAuth } from "@/lib/api-auth";

const STORE_URL = process.env.SHOPIFY_STORE_URL!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;

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
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": ACCESS_TOKEN },
    });
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

function analyzeOrders(orders: Order[], catalog: Map<string, ProductCatalogItem> = new Map()) {
  const productMap = new Map<string, { quantity: number; revenue: number; orders: number }>();
  const combos = new Map<string, number>();
  const dailyRevenue = new Map<string, number>();

  for (const order of orders) {
    // Daily revenue
    const day = order.created_at.split("T")[0];
    dailyRevenue.set(day, (dailyRevenue.get(day) || 0) + parseFloat(order.total_price));

    const titles = new Set<string>();
    for (const item of order.line_items || []) {
      const existing = productMap.get(item.title) || { quantity: 0, revenue: 0, orders: 0 };
      existing.quantity += item.quantity;
      existing.revenue += parseFloat(item.price) * item.quantity;
      existing.orders += 1;
      productMap.set(item.title, existing);
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

  const allProducts = Array.from(productMap.entries())
    .map(([title, data]) => {
      const catalogItem = catalog.get(title);
      return {
        title,
        handle: catalogItem?.handle || null,
        imageUrl: catalogItem?.imageUrl || null,
        ...data,
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

  // Daily revenue sorted
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
    allProducts, // No slice - return ALL products
    topCombos,
    timeSeries,
  };
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const dates = parseDateParams(req);

    const [currentOrders, compOrders, shopifyProducts] = await Promise.all([
      fetchOrdersForRange(dates.from, dates.to),
      fetchOrdersForRange(dates.compFrom, dates.compTo),
      fetchAllProducts(),
    ]);

    // Build catalog map: title → { handle, imageUrl }
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

    // Calculate changes
    const calcChange = (curr: number, prev: number) =>
      prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 1000) / 10;

    return NextResponse.json({
      period: dates.label,
      from: dates.from,
      to: dates.to,
      ...current,
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
