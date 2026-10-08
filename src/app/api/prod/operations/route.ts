import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireManager } from "@/lib/prod-admin";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Операции + норми. GET / POST / PATCH / DELETE (само админ/мениджър). */
export async function GET(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const { data, error } = await supabaseAdmin.from("prod_operations").select("*").order("sort");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ operations: data ?? [] });
}

export async function POST(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const b = await req.json().catch(() => ({}));
  if (!b.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("prod_operations").insert({ name: b.name, unit: b.unit || "бр", norm_per_day: b.norm_per_day != null && b.norm_per_day !== "" ? Number(b.norm_per_day) : null, sort: b.sort ?? 99 }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ operation: data });
}

export async function PATCH(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const fields: Record<string, unknown> = {};
  if (b.name !== undefined) fields.name = b.name;
  if (b.unit !== undefined) fields.unit = b.unit;
  if (b.norm_per_day !== undefined) fields.norm_per_day = b.norm_per_day === "" || b.norm_per_day == null ? null : Number(b.norm_per_day);
  if (b.has_difficulty !== undefined) fields.has_difficulty = !!b.has_difficulty;
  if (b.diff_norms !== undefined) fields.diff_norms = b.diff_norms; // {"1":n,"2":n,"3":n}
  if (b.active !== undefined) fields.active = b.active;
  if (b.sort !== undefined) fields.sort = b.sort;
  const { data, error } = await supabaseAdmin.from("prod_operations").update(fields).eq("id", Number(b.id)).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ operation: data });
}

export async function DELETE(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // меко: деактивиране, за да не чупим стари записи
  const { error } = await supabaseAdmin.from("prod_operations").update({ active: false }).eq("id", Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
