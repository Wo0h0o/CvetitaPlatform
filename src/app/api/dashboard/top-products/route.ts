import { NextResponse } from "next/server";
import { getTopProducts } from "@/lib/shopify";

export async function GET() {
  try {
    const products = await getTopProducts();
    return NextResponse.json(products, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("Top products error:", error);
    return NextResponse.json([]);
  }
}
