import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Reference data for the product-notification (уведомления) module:
 * ingredients, companies, storage sites and learned dropdown options.
 * GET  — return all.
 * POST — add one item: { type: "ingredient"|"site"|"option"|"company", ...fields }.
 */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const [ing, comp, sites, opts] = await Promise.all([
    supabaseAdmin.from("nz_ingredients").select("*").order("name_bg"),
    supabaseAdmin.from("nz_companies").select("*").order("is_default", { ascending: false }),
    supabaseAdmin.from("nz_sites").select("*").order("is_default", { ascending: false }),
    supabaseAdmin.from("nz_options").select("*"),
  ]);
  return NextResponse.json({
    ingredients: ing.data ?? [],
    companies: comp.data ?? [],
    sites: sites.data ?? [],
    options: opts.data ?? [],
  });
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const type = body.type as string;
  const tableByType: Record<string, string> = {
    ingredient: "nz_ingredients",
    site: "nz_sites",
    option: "nz_options",
    company: "nz_companies",
  };
  const table = tableByType[type];
  if (!table) return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  const { type: _t, ...fields } = body;
  void _t;
  // Companies upsert on eik so "save company" also updates an existing one.
  const query =
    type === "company" && fields.eik
      ? supabaseAdmin.from(table).upsert(fields, { onConflict: "eik" })
      : supabaseAdmin.from(table).insert(fields);
  const { data, error } = await query.select().single();
  if (error) {
    logger.error("notify/refs POST failed", { error: error.message, table });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}
