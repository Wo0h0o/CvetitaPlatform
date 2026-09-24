import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { requirePlUnlock, plModule } from "@/lib/pricing-lock";

/** Private-Label offers (per module: standard | key). GET list/one, POST, PATCH, DELETE. */

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const m = plModule(new URL(req.url).searchParams.get("module"));
  const locked = await requirePlUnlock(m);
  if (locked) return locked;
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const { data, error } = await supabaseAdmin.from("pl_offers").select("*").eq("id", Number(id)).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ offer: data });
  }
  const { data, error } = await supabaseAdmin.from("pl_offers").select("*").eq("kind", m).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ offers: data ?? [] });
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const m = plModule(new URL(req.url).searchParams.get("module"));
  const locked = await requirePlUnlock(m);
  if (locked) return locked;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin.from("pl_offers").insert({ ...body, kind: m }).select().single();
  if (error) {
    logger.error("pricing/offers POST failed", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ offer: data });
}

export async function PATCH(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const m = plModule(new URL(req.url).searchParams.get("module"));
  const locked = await requirePlUnlock(m);
  if (locked) return locked;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = body.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { id: _id, kind: _kind, ...fields } = body;
  void _id;
  void _kind;
  fields.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("pl_offers").update(fields).eq("id", Number(id)).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ offer: data });
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const m = plModule(new URL(req.url).searchParams.get("module"));
  const locked = await requirePlUnlock(m);
  if (locked) return locked;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabaseAdmin.from("pl_offers").delete().eq("id", Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
