const API_VERSION = "2024-10";

function getStoreUrl() { return process.env.SHOPIFY_STORE_URL || ""; }
function getAccessToken() { return process.env.SHOPIFY_ACCESS_TOKEN || ""; }

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
    `https://${getStoreUrl()}/admin/api/${API_VERSION}/orders.json?` +
    new URLSearchParams({
      created_at_min: dateMin,
      created_at_max: dateMax,
      status: "any",
      limit: "250",
      fields: "id,total_price,financial_status,cancelled_at,created_at,line_items",
    }).toString();

  while (url) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": getAccessToken() },
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

// ---- Product fetching ----

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string;
  status: string;
  created_at: string;
  image: { src: string } | null;
  images: { id: number; src: string; alt: string | null }[];
  variants: {
    id: number;
    title: string;
    price: string;
    compare_at_price: string | null;
    sku: string;
    inventory_quantity: number;
    option1: string | null;
    inventory_management: string | null;
  }[];
}

export async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let url: string | null =
    `https://${getStoreUrl()}/admin/api/${API_VERSION}/products.json?limit=250&fields=id,title,handle,image,product_type,vendor,status`;

  while (url) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": getAccessToken() },
    });
    if (!res.ok) break;
    const data = await res.json();
    products.push(...(data.products || []));
    const link: string | null = res.headers.get("Link");
    const nextMatch = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }

  return products.filter((p) => p.status === "active");
}

export async function fetchProductByHandle(handle: string): Promise<ShopifyProduct | null> {
  const res = await fetch(
    `https://${getStoreUrl()}/admin/api/${API_VERSION}/products.json?handle=${encodeURIComponent(handle)}`,
    { headers: { "X-Shopify-Access-Token": getAccessToken() } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.products?.[0] || null;
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
