import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Споделена логика за продуктивността — ползва се и от супервайзъра (телефон, /api/cex/*)
 * и от админа (десктоп, /api/prod/*). Одобрението е ПО ОПЕРАЦИЯ (ред), не за целия ден.
 * Капсулирането има трудност 1/2/3 с отделна норма за всяка.
 */

export type ItemStatus = "submitted" | "confirmed" | "rejected";
export interface PItem {
  id: string;
  operation_id: number;
  name: string;
  qty: number;
  difficulty: number | null;
  product: string | null;
  status: ItemStatus;
  note: string | null;
}
export interface OpInfo {
  id: number;
  name: string;
  unit: string;
  sort: number;
  has_difficulty: boolean;
  norm_per_day: number | null;
  diff_norms: Record<string, number> | null;
}

export async function loadOps(): Promise<Map<number, OpInfo>> {
  const { data } = await supabaseAdmin.from("prod_operations").select("id, name, unit, sort, has_difficulty, norm_per_day, diff_norms");
  return new Map((data ?? []).map((o) => [o.id, o as OpInfo]));
}

export function itemNorm(op: OpInfo | undefined, difficulty: number | null): number | null {
  if (!op) return null;
  if (op.has_difficulty) {
    const n = op.diff_norms?.[String(difficulty ?? 1)];
    return n && n > 0 ? n : null;
  }
  return op.norm_per_day && op.norm_per_day > 0 ? op.norm_per_day : null;
}
export function itemPct(it: PItem, ops: Map<number, OpInfo>): number | null {
  const norm = itemNorm(ops.get(it.operation_id), it.difficulty);
  return norm ? Math.round(((Number(it.qty) || 0) / norm) * 1000) / 10 : null;
}

/** % на деня = Σ(количество/норма) по редове (без върнатите, освен ако includeRejected). */
export function entryPct(items: PItem[], ops: Map<number, OpInfo>, opts?: { onlyConfirmed?: boolean }): number | null {
  let sum = 0, counted = 0;
  for (const it of items ?? []) {
    if (it.status === "rejected") continue;
    if (opts?.onlyConfirmed && it.status !== "confirmed") continue;
    const norm = itemNorm(ops.get(it.operation_id), it.difficulty);
    if (norm) { sum += (Number(it.qty) || 0) / norm; counted++; }
  }
  return counted > 0 ? Math.round(sum * 1000) / 10 : null;
}

export function computeStatus(items: PItem[]): ItemStatus {
  if (!items.length) return "submitted";
  if (items.every((i) => i.status === "confirmed")) return "confirmed";
  if (items.some((i) => i.status === "rejected")) return "rejected";
  return "submitted";
}

// ─────────── Преглед по дата (всички колеги) ───────────
export async function reviewByDate(date: string) {
  const [ops, workersRes, entriesRes] = await Promise.all([
    loadOps(),
    supabaseAdmin.from("prod_workers").select("id, name").eq("active", true).eq("is_supervisor", false).order("name"),
    supabaseAdmin.from("prod_entries").select("*").eq("work_date", date),
  ]);
  const byWorker = new Map((entriesRes.data ?? []).map((e) => [e.worker_id, e]));
  const rows = (workersRes.data ?? []).map((w) => {
    const e = byWorker.get(w.id);
    const items = (e?.items ?? []) as PItem[];
    return {
      worker_id: w.id,
      worker_name: w.name,
      entry_id: e?.id ?? null,
      status: e?.status ?? "none",
      pct: e ? entryPct(items, ops) : null,
      lines: items.map((it) => ({ ...it, pct: itemPct(it, ops), norm: itemNorm(ops.get(it.operation_id), it.difficulty) })),
    };
  });
  return { date, rows };
}

// ─────────── Прилагане на одобрение (ред или цял запис) ───────────
export async function applyReview(entryId: number, opts: { lineId?: string; status: ItemStatus; note?: string | null; reviewerId?: string }) {
  const { data: entry } = await supabaseAdmin.from("prod_entries").select("*").eq("id", entryId).maybeSingle();
  if (!entry) throw new Error("not found");
  let items = (entry.items ?? []) as PItem[];
  items = items.map((it) => {
    if (opts.lineId && it.id !== opts.lineId) return it;
    return { ...it, status: opts.status, note: opts.status === "rejected" ? (opts.note ?? it.note ?? null) : null };
  });
  const status = computeStatus(items);
  const { data, error } = await supabaseAdmin
    .from("prod_entries")
    .update({ items, status, reviewed_by: opts.reviewerId ?? null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ─────────── Дашборд за период (+ дневна серия за графики) ───────────
export async function dashboard(from: string, to: string, onlyConfirmed: boolean) {
  const [ops, workersRes, entriesRes] = await Promise.all([
    loadOps(),
    supabaseAdmin.from("prod_workers").select("id, name").eq("active", true).eq("is_supervisor", false).order("name"),
    supabaseAdmin.from("prod_entries").select("worker_id, work_date, items, status").gte("work_date", from).lte("work_date", to),
  ]);
  const perWorker = new Map<number, { byDate: Map<string, number> }>();
  for (const e of entriesRes.data ?? []) {
    const p = entryPct((e.items ?? []) as PItem[], ops, { onlyConfirmed });
    if (p == null) continue;
    if (!perWorker.has(e.worker_id)) perWorker.set(e.worker_id, { byDate: new Map() });
    perWorker.get(e.worker_id)!.byDate.set(e.work_date, p);
  }
  const rows = (workersRes.data ?? []).map((w) => {
    const pw = perWorker.get(w.id);
    const series = pw ? [...pw.byDate.entries()].map(([date, pct]) => ({ date, pct })).sort((a, b) => a.date.localeCompare(b.date)) : [];
    const avg = series.length ? Math.round((series.reduce((a, s) => a + s.pct, 0) / series.length) * 10) / 10 : null;
    return { worker_id: w.id, worker_name: w.name, days: series.length, avg_pct: avg, series };
  });
  return { from, to, rows, operations: [...ops.values()].sort((a, b) => a.sort - b.sort) };
}
