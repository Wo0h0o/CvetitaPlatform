import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Заявки за дозареждане на магазин. GET списък / POST нова / PATCH / DELETE. */

function resolveStore(ctx: { canAllStores: boolean; storeId: number | null }, requested: string | null): number | null {
  if (!ctx.canAllStores) return ctx.storeId;
  return requested ? Number(requested) : null;
}

export async function GET(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  if (id) {
    const { data, error } = await supabaseAdmin.from("store_restock").select("*").eq("id", Number(id)).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ request: data });
  }
  const store = resolveStore(ctx, sp.get("store"));
  let q = supabaseAdmin.from("store_restock").select("*").order("created_at", { ascending: false }).limit(100);
  if (store) q = q.eq("store_id", store);
  else if (!ctx.canAllStores) q = q.eq("store_id", ctx.storeId ?? -1);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
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
    created_by: ctx.userId,
    created_name: ctx.email,
    period_from: (body.period_from as string) || null,
    period_to: (body.period_to as string) || null,
    items: Array.isArray(body.items) ? body.items : [],
    status: "new",
    note: (body.note as string) || null,
  };
  const { data, error } = await supabaseAdmin.from("store_restock").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
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
  const fields: Record<string, unknown> = {};
  if (body.items !== undefined) fields.items = body.items;
  if (body.status !== undefined) fields.status = body.status;
  if (body.note !== undefined) fields.note = body.note;
  let q = supabaseAdmin.from("store_restock").update(fields).eq("id", Number(id));
  if (!ctx.canAllStores) q = q.eq("store_id", ctx.storeId ?? -1);
  const { data, error } = await q.select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  let q = supabaseAdmin.from("store_restock").delete().eq("id", Number(id));
  if (!ctx.canAllStores) q = q.eq("store_id", ctx.storeId ?? -1);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
