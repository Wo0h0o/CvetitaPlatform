import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/** Продажби в магазин. GET ?store=&date= ; POST нова ; DELETE ?id= */

function resolveStore(ctx: { canAllStores: boolean; storeId: number | null }, requested: string | null): number | null {
  if (!ctx.canAllStores) return ctx.storeId;
  return requested ? Number(requested) : null;
}

export async function GET(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const store = resolveStore(ctx, sp.get("store"));
  const date = sp.get("date") || new Date().toISOString().slice(0, 10);
  if (!store) return NextResponse.json({ error: "store required" }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("store_sales")
    .select("*")
    .eq("store_id", store)
    .eq("sold_at", date)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sales: data ?? [] });
}

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
  const payment = body.payment === "card" || body.payment === "unmarked" ? body.payment : "cash";
  const items = Array.isArray(body.items) ? body.items : [];
  const total = Number(body.total) || items.reduce((s: number, it: { line_total?: number }) => s + (Number(it.line_total) || 0), 0);
  const row = {
    store_id: store,
    sold_at: (body.sold_at as string) || new Date().toISOString().slice(0, 10),
    cashier_id: ctx.userId,
    cashier_name: ctx.email,
    items,
    payment,
    total,
    note: (body.note as string) || null,
  };
  const { data, error } = await supabaseAdmin.from("store_sales").insert(row).select().single();
  if (error) {
    logger.error("store sale insert failed", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ sale: data });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = body.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const items = Array.isArray(body.items) ? body.items : [];
  const fields = {
    items,
    payment: body.payment === "card" || body.payment === "unmarked" ? body.payment : "cash",
    total: Number(body.total) || items.reduce((s: number, it: { line_total?: number }) => s + (Number(it.line_total) || 0), 0),
    note: (body.note as string) || null,
  };
  let q = supabaseAdmin.from("store_sales").update(fields).eq("id", Number(id));
  if (!ctx.canAllStores) q = q.eq("store_id", ctx.storeId ?? -1);
  const { data, error } = await q.select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sale: data });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // store staff може да трие само от своя магазин
  let q = supabaseAdmin.from("store_sales").delete().eq("id", Number(id));
  if (!ctx.canAllStores) q = q.eq("store_id", ctx.storeId ?? -1);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
