import { NextRequest, NextResponse } from "next/server";
import { getShopifyKPIs } from "@/lib/shopify";
import { getGA4KPIs } from "@/lib/ga4";

export async function GET(req: NextRequest) {
  try {
    const day = req.nextUrl.searchParams.get("day");
    const daysAgo = day === "yesterday" ? 1 : 0;

    const [shopify, ga4] = await Promise.all([
      getShopifyKPIs(daysAgo),
      getGA4KPIs(),
    ]);

    return NextResponse.json(
      { ...shopify, ...ga4 },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (error) {
    console.error("KPI fetch error:", error);
    return NextResponse.json({
      sales: { value: 0, change: 0 },
      orders: { value: 0, change: 0 },
      aov: { value: 0, change: 0 },
      sessions: { value: 0, change: 0 },
      conversionRate: { value: 0, change: 0 },
    });
  }
}
