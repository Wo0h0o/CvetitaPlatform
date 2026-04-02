import { NextResponse } from "next/server";
import { fetchProductCatalog } from "@/lib/shopify";

export async function GET() {
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
    console.error("Product catalog error:", error);
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }
}
