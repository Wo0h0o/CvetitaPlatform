import { NextRequest, NextResponse } from "next/server";
import { parseDateParams } from "@/lib/api-utils";
import { fetchProductByHandle } from "@/lib/shopify";

const STORE_URL = process.env.SHOPIFY_STORE_URL!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;

interface Order {
  total_price: string;
  financial_status: string;
  cancelled_at: string | null;
  created_at: string;
  line_items: { title: string; quantity: number; price: string }[];
}

async function fetchOrdersForRange(from: string, to: string): Promise<Order[]> {
  const fromDate = new Date(from);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);

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
    const link: string | null = res.headers.get("Link");
    const nextMatch = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }

  return orders.filter(
    (o) =>
      ["paid", "pending", "partially_paid", "authorized"].includes(o.financial_status) &&
      !o.cancelled_at
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;
    const dates = parseDateParams(req);

    const [product, orders] = await Promise.all([
      fetchProductByHandle(handle),
      fetchOrdersForRange(dates.from, dates.to),
    ]);

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Calculate sales for this product
    let revenue = 0;
    let quantity = 0;
    let orderCount = 0;
    const dailyRevenue = new Map<string, { revenue: number; quantity: number }>();
    const boughtWith = new Map<string, number>();

    for (const order of orders) {
      const matchingItems = order.line_items.filter((li) => li.title === product.title);
      if (matchingItems.length === 0) continue;

      orderCount++;
      for (const item of matchingItems) {
        const itemRevenue = parseFloat(item.price) * item.quantity;
        revenue += itemRevenue;
        quantity += item.quantity;

        const day = order.created_at.split("T")[0];
        const existing = dailyRevenue.get(day) || { revenue: 0, quantity: 0 };
        existing.revenue += itemRevenue;
        existing.quantity += item.quantity;
        dailyRevenue.set(day, existing);
      }

      // Track co-purchases
      for (const item of order.line_items) {
        if (item.title !== product.title) {
          boughtWith.set(item.title, (boughtWith.get(item.title) || 0) + 1);
        }
      }
    }

    const timeSeries = Array.from(dailyRevenue.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const topBoughtWith = Array.from(boughtWith.entries())
      .map(([title, count]) => ({ title, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return NextResponse.json({
      product: {
        title: product.title,
        handle: product.handle,
        description: product.body_html,
        vendor: product.vendor,
        productType: product.product_type,
        tags: product.tags ? product.tags.split(", ") : [],
        createdAt: product.created_at,
        images: product.images?.map((img) => ({ src: img.src, alt: img.alt })) || [],
        mainImage: product.image?.src || product.images?.[0]?.src || null,
        variants: product.variants?.map((v) => ({
          id: v.id,
          title: v.title,
          price: v.price,
          compareAtPrice: v.compare_at_price,
          sku: v.sku,
          inventory: v.inventory_quantity,
        })) || [],
      },
      sales: {
        revenue: Math.round(revenue * 100) / 100,
        quantity,
        orders: orderCount,
        avgPrice: quantity > 0 ? Math.round((revenue / quantity) * 100) / 100 : 0,
        timeSeries,
      },
      boughtWith: topBoughtWith,
    }, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("Product detail error:", error);
    return NextResponse.json({ error: "Failed to fetch product" }, { status: 500 });
  }
}
