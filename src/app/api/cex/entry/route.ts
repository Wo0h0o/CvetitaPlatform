import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";
import { getCexWorker } from "@/lib/cex-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeStatus, type PItem } from "@/lib/prod-logic";

/** Дневен запис на колегата (редове с операция/продукт/трудност/количество). */
export async function GET(req: NextRequest) {
  const worker = await getCexWorker(req);
  if (!worker || worker.is_supervisor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = new URL(req.url).searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const [ops, entry] = await Promise.all([
    supabaseAdmin.from("prod_operations").select("id, name, unit, has_difficulty").eq("active", true).order("sort"),
    supabaseAdmin.from("prod_entries").select("*").eq("worker_id", worker.id).eq("work_date", date).maybeSingle(),
  ]);
  return NextResponse.json({ operations: ops.data ?? [], entry: entry.data ?? null, date });
}

export async function POST(req: NextRequest) {
  const worker = await getCexWorker(req);
  if (!worker || worker.is_supervisor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const date = (body.work_date as string) || new Date().toISOString().slice(0, 10);
  const incoming = (Array.isArray(body.items) ? body.items : []) as Partial<PItem>[];

  const { data: existing } = await supabaseAdmin.from("prod_entries").select("*").eq("worker_id", worker.id).eq("work_date", date).maybeSingle();
  const prev = (existing?.items ?? []) as PItem[];
  const confirmed = prev.filter((i) => i.status === "confirmed"); // потвърдените се запазват непроменени

  const editable: PItem[] = incoming
    .filter((it) => it.operation_id && (Number(it.qty) || 0) > 0)
    .filter((it) => !(it.id && confirmed.some((c) => c.id === it.id))) // не пипаме потвърдени
    .map((it) => {
      const wasRejected = prev.find((p) => p.id === it.id)?.status === "rejected";
      return {
        id: it.id && !confirmed.some((c) => c.id === it.id) ? it.id : crypto.randomUUID(),
        operation_id: Number(it.operation_id),
        name: String(it.name || ""),
        qty: Number(it.qty) || 0,
        difficulty: it.difficulty != null ? Number(it.difficulty) : null,
        product: it.product ? String(it.product) : null,
        status: "submitted" as const,
        note: wasRejected ? null : null,
      };
    });

  const items = [...confirmed, ...editable];
  const row = {
    worker_id: worker.id,
    work_date: date,
    items,
    status: computeStatus(items),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from("prod_entries").upsert(row, { onConflict: "worker_id,work_date" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}
