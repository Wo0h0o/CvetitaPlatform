import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Сумира продадените продукти за период → предложение за дозареждане. */

function resolveStore(ctx: { canAllStores: boolean; storeId: number | null }, requested: string | null): number | null {
  if (!ctx.canAllStores) return ctx.storeId;
  return requested ? Number(requested) : null;
}

export async function GET(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const store = resolveStore(ctx, sp.get("store"));
  const from = sp.get("from");
  const to = sp.get("to");
  if (!store || !from || !to) return NextResponse.json({ error: "store, from, to required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("store_sales")
    .select("items")
    .eq("store_id", store)
    .gte("sold_at", from)
    .lte("sold_at", to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // агрегиране по продукт (item_id ако има, иначе по име)
  const map = new Map<string, { item_id: number | null; sku: string | null; name: string; qty_sold: number }>();
  for (const row of data ?? []) {
    for (const it of (row.items as { item_id?: number | null; sku?: string | null; name?: string; qty?: number }[]) ?? []) {
      const name = (it.name || "").trim();
      if (!name) continue;
      const key = it.item_id != null ? `id:${it.item_id}` : `nm:${name.toLowerCase()}`;
      if (!map.has(key)) map.set(key, { item_id: it.item_id ?? null, sku: it.sku ?? null, name, qty_sold: 0 });
      map.get(key)!.qty_sold += Number(it.qty) || 0;
    }
  }
  const items = [...map.values()].sort((a, b) => b.qty_sold - a.qty_sold);
  return NextResponse.json({ items });
}
