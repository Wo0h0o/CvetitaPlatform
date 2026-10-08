import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireManager, entryPct } from "@/lib/prod-admin";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Продуктивност за период: % спрямо нормата по колега + по операция. */
export async function GET(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") || new Date().toISOString().slice(0, 10);
  const from = sp.get("from") || to;
  const onlyConfirmed = sp.get("confirmed") === "1";

  const [opsRes, workersRes, entriesRes] = await Promise.all([
    supabaseAdmin.from("prod_operations").select("id, name, norm_per_day"),
    supabaseAdmin.from("prod_workers").select("id, name").eq("active", true).order("name"),
    supabaseAdmin.from("prod_entries").select("worker_id, work_date, items, status").gte("work_date", from).lte("work_date", to),
  ]);
  const normById = new Map((opsRes.data ?? []).map((o) => [o.id, o.norm_per_day]));
  let entries = entriesRes.data ?? [];
  if (onlyConfirmed) entries = entries.filter((e) => e.status === "confirmed");

  const byWorker = new Map<number, { pcts: number[]; days: Set<string>; confirmed: number; submitted: number; rejected: number; qtyByOp: Map<number, number> }>();
  for (const e of entries) {
    if (!byWorker.has(e.worker_id)) byWorker.set(e.worker_id, { pcts: [], days: new Set(), confirmed: 0, submitted: 0, rejected: 0, qtyByOp: new Map() });
    const w = byWorker.get(e.worker_id)!;
    w.days.add(e.work_date);
    if (e.status === "confirmed") w.confirmed++; else if (e.status === "rejected") w.rejected++; else w.submitted++;
    const p = entryPct(e.items, normById);
    if (p != null) w.pcts.push(p);
    for (const it of e.items ?? []) w.qtyByOp.set(it.operation_id, (w.qtyByOp.get(it.operation_id) || 0) + (Number(it.qty) || 0));
  }

  const rows = (workersRes.data ?? []).map((wk) => {
    const w = byWorker.get(wk.id);
    const avg = w && w.pcts.length ? Math.round((w.pcts.reduce((a2, b2) => a2 + b2, 0) / w.pcts.length) * 10) / 10 : null;
    return {
      worker_id: wk.id,
      worker_name: wk.name,
      days: w ? w.days.size : 0,
      avg_pct: avg,
      confirmed: w?.confirmed ?? 0,
      submitted: w?.submitted ?? 0,
      rejected: w?.rejected ?? 0,
    };
  });
  const operations = (opsRes.data ?? []).map((o) => ({ id: o.id, name: o.name, norm_per_day: o.norm_per_day }));
  return NextResponse.json({ from, to, rows, operations });
}
