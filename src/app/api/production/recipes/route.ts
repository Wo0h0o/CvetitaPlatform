import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * GET /api/production/recipes
 * Returns the bill-of-materials recipes keyed by item_id.
 * Recipes are derived from PRIM work orders and seeded/updated out of band.
 */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { data, error } = await supabaseAdmin
    .from("product_recipes")
    .select("item_id, sku, item_name, batch_qty, wo_num, components");

  if (error) {
    logger.error("production/recipes: fetch failed", { error: error.message });
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }

  const recipes: Record<string, unknown> = {};
  for (const r of data ?? []) recipes[r.item_id] = r;
  return NextResponse.json({ recipes });
}
