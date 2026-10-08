import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCexWorker } from "@/lib/cex-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Дневен запис на колегата (само за себе си). GET ?date= ; POST upsert. */

export async function GET(req: NextRequest) {
  const worker = await getCexWorker(req);
  if (!worker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = new URL(req.url).searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const [ops, entry] = await Promise.all([
    supabaseAdmin.from("prod_operations").select("id, name, unit").eq("active", true).order("sort"),
    supabaseAdmin.from("prod_entries").select("*").eq("worker_id", worker.id).eq("work_date", date).maybeSingle(),
  ]);
  return NextResponse.json({ operations: ops.data ?? [], entry: entry.data ?? null, date });
}

export async function POST(req: NextRequest) {
  const worker = await getCexWorker(req);
  if (!worker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const date = (body.work_date as string) || new Date().toISOString().slice(0, 10);
  const items = (Array.isArray(body.items) ? body.items : []) as { operation_id: number; name: string; qty: number }[];
  const clean = items.filter((it) => it.operation_id && (Number(it.qty) || 0) > 0).map((it) => ({ operation_id: it.operation_id, name: it.name, qty: Number(it.qty) || 0 }));

  // не позволяваме промяна на вече потвърден запис
  const { data: existing } = await supabaseAdmin.from("prod_entries").select("status").eq("worker_id", worker.id).eq("work_date", date).maybeSingle();
  if (existing?.status === "confirmed") return NextResponse.json({ error: "Записът вече е потвърден от ръководител и не може да се променя." }, { status: 409 });

  const row = {
    worker_id: worker.id,
    work_date: date,
    items: clean,
    status: "submitted",
    review_note: null,
    reviewed_by: null,
    reviewed_at: null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from("prod_entries").upsert(row, { onConflict: "worker_id,work_date" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}
