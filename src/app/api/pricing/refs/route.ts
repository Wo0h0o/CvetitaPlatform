import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlUnlock } from "@/lib/pricing-lock";

/** Reference data for the pricing module: priced raw materials + operation defaults. */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const locked = await requirePlUnlock();
  if (locked) return locked;
  const [mats, ops, caps] = await Promise.all([
    supabaseAdmin.from("pl_materials").select("item_id, sku, name, unit, price_eur, price_updated").order("name"),
    supabaseAdmin.from("pl_operations").select("*").order("sort"),
    supabaseAdmin.from("pl_capsules").select("item_id, name, price_eur").order("name"),
  ]);
  return NextResponse.json({ materials: mats.data ?? [], operations: ops.data ?? [], capsules: caps.data ?? [] });
}
