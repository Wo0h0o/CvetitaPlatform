import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncStoreProducts } from "@/lib/store-products";
import { logger } from "@/lib/logger";

/** GET ?q= — търсене в кешираните ПРИМ продукти (име/SKU/баркод). */
export async function GET(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  let query = supabaseAdmin.from("store_products").select("item_id, sku, barcode, name").eq("active", true).order("name").limit(30);
  if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data ?? [] });
}

/** POST — ресинк на продуктите от ПРИМ (за admin/manager). */
export async function POST(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.canAllStores) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const r = await syncStoreProducts();
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("store products sync failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
