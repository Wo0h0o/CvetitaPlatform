import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Магазините, достъпни за текущия потребител (всички за admin/manager, иначе само своя). */
export async function GET(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let q = supabaseAdmin.from("store_stores").select("id, name, active").eq("active", true).order("id");
  if (!ctx.canAllStores) q = q.eq("id", ctx.storeId ?? -1);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stores: data ?? [], canAllStores: ctx.canAllStores, myStore: ctx.storeId });
}
