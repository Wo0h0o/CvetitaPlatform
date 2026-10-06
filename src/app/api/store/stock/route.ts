import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { computeStock, loadStock } from "@/lib/store-stock";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

function resolveStore(ctx: { canAllStores: boolean; storeId: number | null }, requested: string | null): number | null {
  if (!ctx.canAllStores) return ctx.storeId;
  return requested ? Number(requested) : null;
}

/** GET ?store= → наличности с очаквано количество. */
export async function GET(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const store = resolveStore(ctx, new URL(req.url).searchParams.get("store"));
  if (!store) return NextResponse.json({ error: "store required" }, { status: 400 });
  const stock = await computeStock(store);
  return NextResponse.json({ stock });
}

/** POST → ръчно зареждане (добавя към наличността). body {store_id, items:[{item_id,sku,name,qty}]} */
export async function POST(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const store = resolveStore(ctx, (body.store_id as string) ?? null);
  if (!store) return NextResponse.json({ error: "store required" }, { status: 400 });
  const items = Array.isArray(body.items) ? body.items : [];
  const asOf = (body.as_of as string) ? `${body.as_of}T00:00:00Z` : new Date().toISOString();
  const r = await loadStock(store, items as never, asOf);
  return NextResponse.json(r);
}

/** DELETE ?store=&key= → премахва ред от наличностите (или ?store=&all=1 изчиства всичко). */
export async function DELETE(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const store = resolveStore(ctx, sp.get("store"));
  if (!store) return NextResponse.json({ error: "store required" }, { status: 400 });
  if (sp.get("all") === "1") {
    const { error } = await supabaseAdmin.from("store_stock").delete().eq("store_id", store);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const key = sp.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  const { error } = await supabaseAdmin.from("store_stock").delete().eq("store_id", store).eq("match_key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
