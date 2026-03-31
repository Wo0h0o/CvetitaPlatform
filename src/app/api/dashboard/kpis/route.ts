import { NextResponse } from "next/server";
import { getShopifyKPIs } from "@/lib/shopify";

export async function GET() {
  try {
    const shopify = await getShopifyKPIs();

    // GA4 and Klaviyo will be added when service account / API key are ready
    // For now, return placeholders for those
    const data = {
      ...shopify,
      sessions: { value: 0, change: 0 },
      conversionRate: { value: 0, change: 0 },
    };

    return NextResponse.json(data, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("KPI fetch error:", error);
    // Return mock data on error so the UI doesn't break
    return NextResponse.json({
      sales: { value: 0, change: 0 },
      orders: { value: 0, change: 0 },
      aov: { value: 0, change: 0 },
      sessions: { value: 0, change: 0 },
      conversionRate: { value: 0, change: 0 },
    });
  }
}
