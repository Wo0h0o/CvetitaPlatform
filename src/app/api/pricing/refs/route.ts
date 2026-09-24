import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Reference data for the pricing module: priced raw materials + operation defaults. */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const [mats, ops] = await Promise.all([
    supabaseAdmin.from("pl_materials").select("item_id, sku, name, unit, price_eur, price_updated").order("name"),
    supabaseAdmin.from("pl_operations").select("*").order("sort"),
  ]);
  return NextResponse.json({ materials: mats.data ?? [], operations: ops.data ?? [] });
}
