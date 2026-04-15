import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { fetchProductCatalog } from "@/lib/shopify";
import { requireAuth } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  try {
    const products = await fetchProductCatalog();

    const slim = products.map((p) => ({
      handle: p.handle,
      title: p.title,
      productType: p.product_type || "",
      image: p.image?.src || null,
      price: p.variants?.[0]?.price || "0",
    }));

    return NextResponse.json(
      { products: slim },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (error) {
    logger.error("Product catalog error", { error: String(error) });
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }
}
