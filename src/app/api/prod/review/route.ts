import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireManager, entryPct } from "@/lib/prod-admin";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Преглед на деня: всички колеги + техните записи + %; PATCH потвърди/отхвърли. */
export async function GET(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const date = new URL(req.url).searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const [opsRes, workersRes, entriesRes] = await Promise.all([
    supabaseAdmin.from("prod_operations").select("id, norm_per_day"),
    supabaseAdmin.from("prod_workers").select("id, name").eq("active", true).order("name"),
    supabaseAdmin.from("prod_entries").select("*").eq("work_date", date),
  ]);
  const normById = new Map((opsRes.data ?? []).map((o) => [o.id, o.norm_per_day]));
  const entryByWorker = new Map((entriesRes.data ?? []).map((e) => [e.worker_id, e]));
  const rows = (workersRes.data ?? []).map((w) => {
    const e = entryByWorker.get(w.id);
    return {
      worker_id: w.id,
      worker_name: w.name,
      entry_id: e?.id ?? null,
      items: e?.items ?? [],
      status: e?.status ?? "none",
      review_note: e?.review_note ?? null,
      pct: e ? entryPct(e.items, normById) : null,
    };
  });
  return NextResponse.json({ date, rows });
}

export async function PATCH(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const b = await req.json().catch(() => ({}));
  if (!b.id || !["confirmed", "rejected", "submitted"].includes(b.status)) return NextResponse.json({ error: "id и валиден status са задължителни" }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("prod_entries")
    .update({ status: b.status, review_note: b.note ?? null, reviewed_by: a.userId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", Number(b.id))
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}
