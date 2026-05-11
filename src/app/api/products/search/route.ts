import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchProductCatalog, searchProducts } from "@/lib/shopify";
import { logger, requestMeta } from "@/lib/logger";

// GET /api/products/search?q=...
// Lightweight typeahead over our Shopify catalog. Reuses 5-min cached catalog.
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const q = req.nextUrl.searchParams.get("q")?.trim() || "";
    if (q.length < 2) {
      return NextResponse.json({ products: [] });
    }

    const catalog = await fetchProductCatalog();
    const matches = searchProducts(catalog, q);

    return NextResponse.json({
      products: matches.map((p) => ({
        id: String(p.id),
        handle: p.handle,
        title: p.title,
        productType: p.product_type,
        image: p.image?.src || null,
        price: p.variants?.[0]?.price || null,
      })),
    });
  } catch (err) {
    logger.error("Products search failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
