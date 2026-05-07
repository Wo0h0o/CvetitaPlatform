import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

// v1: BG store only. TODO: resolve from store binding when going multi-store.
const SCHEMA = "store_bg";

const ALLOWED_FILTERS = new Set([
  "all",
  "never_called",
  "needs_followup",
  "do_not_call",
  "has_followup",
]);
const ALLOWED_SORTS = new Set([
  "last_order_at",
  "total_spent",
  "total_orders",
  "first_name",
  "last_call_at",
  "first_order_at",
]);
const ALLOWED_ORDERS = new Set(["asc", "desc"]);

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim() || null;
    const filterRaw = sp.get("filter") || "all";
    const sortRaw = sp.get("sort") || "last_order_at";
    const orderRaw = (sp.get("order") || "desc").toLowerCase();
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(sp.get("offset")) || 0, 0);

    const filter = ALLOWED_FILTERS.has(filterRaw) ? filterRaw : "all";
    const sort = ALLOWED_SORTS.has(sortRaw) ? sortRaw : "last_order_at";
    const order = ALLOWED_ORDERS.has(orderRaw) ? orderRaw : "desc";

    const [rowsRes, countRes] = await Promise.all([
      supabaseAdmin.rpc("customer_list_filtered", {
        p_schema: SCHEMA,
        p_search: q,
        p_filter: filter,
        p_sort: sort,
        p_order: order,
        p_limit: limit,
        p_offset: offset,
      }),
      supabaseAdmin.rpc("customer_list_count", {
        p_schema: SCHEMA,
        p_search: q,
        p_filter: filter,
      }),
    ]);

    if (rowsRes.error) throw rowsRes.error;
    if (countRes.error) throw countRes.error;

    return NextResponse.json({
      customers: rowsRes.data || [],
      total: countRes.data || 0,
      limit,
      offset,
      filter,
      sort,
      order,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/customers/list failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
