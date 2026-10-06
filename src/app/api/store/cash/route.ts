import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Каса за деня: начално салдо + преброено. GET ?store=&date= ; POST upsert */

function resolveStore(ctx: { canAllStores: boolean; storeId: number | null }, requested: string | null): number | null {
  if (!ctx.canAllStores) return ctx.storeId;
  return requested ? Number(requested) : null;
}

export async function GET(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const store = resolveStore(ctx, sp.get("store"));
  const day = sp.get("date") || new Date().toISOString().slice(0, 10);
  if (!store) return NextResponse.json({ error: "store required" }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("store_cash_days").select("*").eq("store_id", store).eq("day", day).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cash: data });
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
  const day = (body.day as string) || new Date().toISOString().slice(0, 10);
  if (!store) return NextResponse.json({ error: "store required" }, { status: 400 });
  const row: Record<string, unknown> = {
    store_id: store,
    day,
    opening_float: body.opening_float != null && body.opening_float !== "" ? Number(body.opening_float) : 0,
    counted_cash: body.counted_cash != null && body.counted_cash !== "" ? Number(body.counted_cash) : null,
    note: (body.note as string) || null,
    updated_at: new Date().toISOString(),
  };
  // Приключване / повторно отваряне на деня
  if (body.closed === true) row.closed_at = new Date().toISOString();
  else if (body.closed === false) row.closed_at = null;
  const { data, error } = await supabaseAdmin.from("store_cash_days").upsert(row, { onConflict: "store_id,day" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cash: data });
}
