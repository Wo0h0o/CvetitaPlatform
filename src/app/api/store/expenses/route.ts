import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Разходи в магазин. GET ?store=&month= ; POST нов ; DELETE ?id= */

function resolveStore(ctx: { canAllStores: boolean; storeId: number | null }, requested: string | null): number | null {
  if (!ctx.canAllStores) return ctx.storeId;
  return requested ? Number(requested) : null;
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
  const row = {
    store_id: store,
    spent_at: (body.spent_at as string) || new Date().toISOString().slice(0, 10),
    doc_no: (body.doc_no as string) || null,
    description: (body.description as string) || null,
    amount_store: body.amount_store != null && body.amount_store !== "" ? Number(body.amount_store) : 0,
    amount_other: body.amount_other != null && body.amount_other !== "" ? Number(body.amount_other) : 0,
  };
  const { data, error } = await supabaseAdmin.from("store_expenses").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expense: data });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  let q = supabaseAdmin.from("store_expenses").delete().eq("id", Number(id));
  if (!ctx.canAllStores) q = q.eq("store_id", ctx.storeId ?? -1);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
