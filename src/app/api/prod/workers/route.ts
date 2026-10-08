import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireManager } from "@/lib/prod-admin";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Колеги (с PIN). GET / POST / PATCH / DELETE (само админ/мениджър). */
export async function GET(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const { data, error } = await supabaseAdmin.from("prod_workers").select("id, name, pin, active").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workers: data ?? [] });
}

export async function POST(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const b = await req.json().catch(() => ({}));
  if (!b.name || !b.pin) return NextResponse.json({ error: "name и pin са задължителни" }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("prod_workers").insert({ name: b.name, pin: String(b.pin) }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ worker: data });
}

export async function PATCH(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const fields: Record<string, unknown> = {};
  if (b.name !== undefined) fields.name = b.name;
  if (b.pin !== undefined && b.pin !== "") fields.pin = String(b.pin);
  if (b.active !== undefined) fields.active = b.active;
  const { data, error } = await supabaseAdmin.from("prod_workers").update(fields).eq("id", Number(b.id)).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ worker: data });
}

export async function DELETE(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabaseAdmin.from("prod_workers").update({ active: false }).eq("id", Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
