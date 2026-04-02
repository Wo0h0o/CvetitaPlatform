import { NextRequest, NextResponse } from "next/server";
import { getTopProducts } from "@/lib/shopify";

export async function GET(req: NextRequest) {
  try {
    const day = req.nextUrl.searchParams.get("day");
    const daysAgo = day === "yesterday" ? 1 : 0;
    const products = await getTopProducts(daysAgo);
    return NextResponse.json(products, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("Top products error:", error);
    return NextResponse.json(
      { error: "Top products fetch failed" },
      { status: 500 }
    );
  }
}
