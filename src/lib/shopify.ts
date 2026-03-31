const STORE_URL = process.env.SHOPIFY_STORE_URL!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;
const API_VERSION = "2024-10";

interface ShopifyOrder {
  id: number;
  total_price: string;
  financial_status: string;
  cancelled_at: string | null;
  created_at: string;
  line_items: { title: string; quantity: number; price: string }[];
}

async function fetchOrders(dateMin: string, dateMax: string): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = [];
  let url: string | null =
    `https://${STORE_URL}/admin/api/${API_VERSION}/orders.json?` +
    new URLSearchParams({
      created_at_min: dateMin,
      created_at_max: dateMax,
      status: "any",
      limit: "250",
      fields: "id,total_price,financial_status,cancelled_at,created_at,line_items",
    }).toString();

  while (url) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": ACCESS_TOKEN },
    });

    if (!res.ok) {
      console.error("Shopify API error:", res.status, await res.text());
      break;
    }

    const data = await res.json();
    orders.push(...(data.orders || []));

    const link = res.headers.get("Link");
    const nextMatch = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }

  return orders.filter(
    (o) =>
      ["paid", "pending", "partially_paid", "authorized"].includes(o.financial_status) &&
      !o.cancelled_at
  );
}

function startOfDay(daysAgo: number = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfDay(daysAgo: number = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function calcChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export async function getShopifyKPIs() {
  const [todayOrders, yesterdayOrders] = await Promise.all([
    fetchOrders(startOfDay(0), endOfDay(0)),
    fetchOrders(startOfDay(1), endOfDay(1)),
  ]);

  const todaySales = todayOrders.reduce((sum, o) => sum + parseFloat(o.total_price), 0);
  const yesterdaySales = yesterdayOrders.reduce((sum, o) => sum + parseFloat(o.total_price), 0);

  const todayCount = todayOrders.length;
  const yesterdayCount = yesterdayOrders.length;

  const todayAov = todayCount > 0 ? todaySales / todayCount : 0;
  const yesterdayAov = yesterdayCount > 0 ? yesterdaySales / yesterdayCount : 0;

  return {
    sales: { value: Math.round(todaySales * 100) / 100, change: calcChange(todaySales, yesterdaySales) },
    orders: { value: todayCount, change: calcChange(todayCount, yesterdayCount) },
    aov: { value: Math.round(todayAov * 100) / 100, change: calcChange(todayAov, yesterdayAov) },
  };
}

export interface TopProduct {
  title: string;
  quantity: number;
  revenue: number;
}

export async function getTopProducts(): Promise<TopProduct[]> {
  const orders = await fetchOrders(startOfDay(0), endOfDay(0));

  const productMap = new Map<string, { quantity: number; revenue: number }>();

  for (const order of orders) {
    for (const item of order.line_items || []) {
      const existing = productMap.get(item.title) || { quantity: 0, revenue: 0 };
      existing.quantity += item.quantity;
      existing.revenue += parseFloat(item.price) * item.quantity;
      productMap.set(item.title, existing);
    }
  }

  return Array.from(productMap.entries())
    .map(([title, data]) => ({ title, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
}
