import { NextResponse } from "next/server";

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
  line_items: LineItem[];
}

async function fetchOrdersForPeriod(daysAgo: number): Promise<Order[]> {
  const from = new Date();
  from.setDate(from.getDate() - daysAgo);
  from.setHours(0, 0, 0, 0);

  const orders: Order[] = [];
  let url: string | null =
    `https://${STORE_URL}/admin/api/2024-10/orders.json?` +
    new URLSearchParams({
      created_at_min: from.toISOString(),
      status: "any",
      limit: "250",
      fields: "total_price,financial_status,cancelled_at,line_items",
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

export async function GET() {
  try {
    const orders = await fetchOrdersForPeriod(30);

    // Product aggregation
    const productMap = new Map<string, { quantity: number; revenue: number; orders: number }>();
    const combos = new Map<string, number>();

    for (const order of orders) {
      const titles = new Set<string>();
      for (const item of order.line_items || []) {
        const existing = productMap.get(item.title) || { quantity: 0, revenue: 0, orders: 0 };
        existing.quantity += item.quantity;
        existing.revenue += parseFloat(item.price) * item.quantity;
        existing.orders += 1;
        productMap.set(item.title, existing);
        titles.add(item.title);
      }

      // Upsell combos (orders with 2+ products)
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

    const topProducts = Array.from(productMap.entries())
      .map(([title, data]) => ({
        title,
        ...data,
        revenue: Math.round(data.revenue * 100) / 100,
        avgPrice: Math.round((data.revenue / data.quantity) * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const topCombos = Array.from(combos.entries())
      .map(([combo, count]) => ({ combo, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const totalRevenue = orders.reduce((s, o) => s + parseFloat(o.total_price), 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const multiItemOrders = orders.filter((o) => (o.line_items?.length || 0) > 1).length;
    const upsellRate = totalOrders > 0 ? (multiItemOrders / totalOrders) * 100 : 0;

    return NextResponse.json({
      period: "30 дни",
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalOrders,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        uniqueProducts: productMap.size,
        upsellRate: Math.round(upsellRate * 10) / 10,
      },
      topProducts,
      topCombos,
    });
  } catch (error) {
    console.error("Products analytics error:", error);
    return NextResponse.json({ summary: null, topProducts: [], topCombos: [] });
  }
}
