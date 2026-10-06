import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeStock } from "@/lib/store-stock";

export const maxDuration = 60;

function resolveStore(ctx: { canAllStores: boolean; storeId: number | null }, requested: string | null): number | null {
  if (!ctx.canAllStores) return ctx.storeId;
  return requested ? Number(requested) : null;
}

/** GET ?store= → списък минали ревизии. */
export async function GET(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const store = resolveStore(ctx, new URL(req.url).searchParams.get("store"));
  if (!store) return NextResponse.json({ error: "store required" }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("store_revisions").select("*").eq("store_id", store).order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ revisions: data ?? [] });
}

/**
 * POST → записва ревизия: за всеки преброен продукт сетва наличността = преброено
 * (нов as_of = сега) и записва разликата спрямо очакваното.
 * body {store_id, items:[{match_key, item_id, sku, name, counted}], note}
 */
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
  const counts = (Array.isArray(body.items) ? body.items : []) as { match_key: string; item_id?: number | null; sku?: string | null; name: string; counted: number }[];
  if (!counts.length) return NextResponse.json({ error: "no items" }, { status: 400 });

  // очаквано преди ревизията
  const current = await computeStock(store);
  const expMap = new Map(current.map((r) => [r.match_key, r.expected]));

  const now = new Date().toISOString();
  const rows = counts.map((c) => ({
    store_id: store,
    item_id: c.item_id ?? null,
    sku: c.sku ?? null,
    name: c.name,
    match_key: c.match_key,
    qty: Number(c.counted) || 0,
    as_of: now,
    updated_at: now,
  }));
  const { error: upErr } = await supabaseAdmin.from("store_stock").upsert(rows, { onConflict: "store_id,match_key" });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const diffItems = counts.map((c) => {
    const expected = expMap.get(c.match_key) ?? 0;
    const counted = Number(c.counted) || 0;
    return { name: c.name, match_key: c.match_key, expected, counted, diff: counted - expected };
  });
  const { data: rev, error: revErr } = await supabaseAdmin
    .from("store_revisions")
    .insert({ store_id: store, created_by: ctx.userId, created_name: ctx.email, items: diffItems, note: (body.note as string) || null })
    .select()
    .single();
  if (revErr) return NextResponse.json({ error: revErr.message }, { status: 500 });
  return NextResponse.json({ revision: rev });
}
