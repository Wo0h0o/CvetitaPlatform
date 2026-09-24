import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/** Follow-up проследяване на изпратени оферти + задачи (обаждане/имейл) с отмятане. */

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Стандартните 3 стъпки от датата на изпращане. */
export function defaultTasks(baseISO: string) {
  return [
    { kind: "call", label: "Обади се на клиента — пусната оферта", due: addDays(baseISO, 0), done: false, done_at: null },
    { kind: "email", label: "Изпрати нов имейл (ако няма отговор)", due: addDays(baseISO, 3), done: false, done_at: null },
    { kind: "call", label: "Обади се (ако няма отговор)", due: addDays(baseISO, 5), done: false, done_at: null },
  ];
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const { data, error } = await supabaseAdmin.from("pl_followups").select("*").order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ followups: data ?? [] });
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
  const base = (body.sent_date as string) || new Date().toISOString().slice(0, 10);
  const row = {
    module: body.module ?? "standard",
    client: body.client ?? null,
    client_email: body.client_email ?? null,
    product_ids: body.product_ids ?? [],
    subject: body.subject ?? null,
    status: body.status ?? "нова",
    sent_date: body.sent_date ?? null,
    tasks: body.tasks ?? defaultTasks(base),
    owner: body.owner ?? null,
    note: body.note ?? null,
  };
  const { data, error } = await supabaseAdmin.from("pl_followups").insert(row).select().single();
  if (error) {
    logger.error("pricing/followups POST failed", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ followup: data });
}

export async function PATCH(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = body.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { id: _id, ...fields } = body;
  void _id;
  fields.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("pl_followups").update(fields).eq("id", Number(id)).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ followup: data });
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabaseAdmin.from("pl_followups").delete().eq("id", Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
