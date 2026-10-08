"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { Gauge, Check, RotateCcw, Plus, Save, Pencil } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { Sparkbars } from "@/components/cex/CexPortal";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const inputCls = "px-3 py-2 rounded-lg border border-border bg-surface text-[14px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40";
const pctColor = (p: number | null) => (p == null ? "text-text-3" : p >= 100 ? "text-accent" : p >= 80 ? "text-amber-600" : "text-red-500");
const fmtPct = (p: number | null) => (p == null ? "—" : `${p}%`);

type Tab = "dashboard" | "review" | "settings";

export function ProductivityAdmin() {
  const [tab, setTab] = useState<Tab>("dashboard");
  return (
    <div className="pb-10">
      <PageHeader title={<><Gauge size={22} className="text-accent" /> Производство — продуктивност</>} />
      <div className="flex gap-2 mb-5 flex-wrap">
        {([["dashboard", "Дашборд"], ["review", "Преглед / потвърждаване"], ["settings", "Настройки"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-lg text-[13px] font-medium cursor-pointer ${tab === k ? "bg-accent text-white" : "border border-border text-text-2 hover:bg-surface-2"}`}>{l}</button>
        ))}
      </div>
      {tab === "dashboard" && <Dashboard />}
      {tab === "review" && <Review />}
      {tab === "settings" && <Settings />}
    </div>
  );
}

// ─────────── Дашборд с графики ───────────
interface DRow { worker_id: number; worker_name: string; days: number; avg_pct: number | null; series: { date: string; pct: number }[] }
function Dashboard() {
  const [from, setFrom] = useState(daysAgoISO(6));
  const [to, setTo] = useState(todayISO());
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);
  const { data } = useSWR(`/api/prod/dashboard?from=${from}&to=${to}${onlyConfirmed ? "&confirmed=1" : ""}`, fetcher, { revalidateOnFocus: false });
  const rows: DRow[] = data?.rows ?? [];
  const ops = data?.operations ?? [];
  return (
    <>
      <Card className="p-4 mb-4 flex items-end gap-3 flex-wrap">
        <div><label className="block text-[11px] text-text-3 mb-1">От</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></div>
        <div><label className="block text-[11px] text-text-3 mb-1">До</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></div>
        <label className="flex items-center gap-2 text-[13px] text-text-2"><input type="checkbox" checked={onlyConfirmed} onChange={(e) => setOnlyConfirmed(e.target.checked)} /> само потвърдени</label>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((r) => (
          <Card key={r.worker_id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[15px] font-semibold text-text">{r.worker_name}</span>
              <span className={`text-[18px] font-bold ${pctColor(r.avg_pct)}`}>{fmtPct(r.avg_pct)}</span>
            </div>
            <Sparkbars series={r.series} />
            <div className="text-[11px] text-text-3 mt-1">{r.days} дни с запис · средно {fmtPct(r.avg_pct)}</div>
          </Card>
        ))}
        {rows.length === 0 && <Card className="p-6 text-center text-text-3 text-[13px] md:col-span-2">Няма данни за периода.</Card>}
      </div>
      {ops.some((o: { has_difficulty: boolean; norm_per_day: number | null; diff_norms: Record<string, number> | null }) => (o.has_difficulty ? !o.diff_norms : o.norm_per_day == null)) && (
        <p className="text-[12px] text-amber-600 mt-3">⚠ Някои операции нямат зададена норма → не влизат в % изчислението. Задай нормите в „Настройки“.</p>
      )}
    </>
  );
}

// ─────────── Преглед / потвърждаване (по операция) ───────────
interface RLine { id: string; name: string; qty: number; difficulty: number | null; product: string | null; status: string; note: string | null; pct: number | null; norm: number | null }
interface RRow { worker_id: number; worker_name: string; entry_id: number | null; status: string; pct: number | null; lines: RLine[] }
function Review() {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<{ rows: RRow[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; qty: string; product: string; difficulty: number | null } | null>(null);
  const load = useCallback(() => { fetcher(`/api/prod/review?date=${date}`).then(setData); }, [date]);
  useEffect(() => { load(); }, [load]);
  async function saveEdit(entry_id: number) {
    if (!edit) return;
    setBusy(edit.id);
    try {
      await fetch("/api/prod/review", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry_id, line_id: edit.id, edit: { qty: Number(edit.qty) || 0, product: edit.product.trim() || null, difficulty: edit.difficulty } }) });
      setEdit(null); load();
    } finally { setBusy(null); }
  }
  async function act(entry_id: number, line_id: string | undefined, status: string) {
    let note: string | null = null;
    if (status === "rejected") note = prompt("Причина за връщане (по избор):") || null;
    setBusy(line_id || `all-${entry_id}`);
    try { await fetch("/api/prod/review", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry_id, line_id, status, note }) }); load(); } finally { setBusy(null); }
  }
  const shift = (n: number) => { const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + n); const iso = d.toISOString().slice(0, 10); if (iso <= todayISO()) setDate(iso); };
  const rows = data?.rows ?? [];
  return (
    <>
      <Card className="p-3 mb-4 flex items-center justify-between">
        <button onClick={() => shift(-1)} className="px-3 py-1 text-text-2">‹</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + " py-1.5"} />
        <button onClick={() => shift(1)} disabled={date >= todayISO()} className="px-3 py-1 text-text-2 disabled:opacity-30">›</button>
      </Card>
      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.worker_id} className="p-4">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-[14px] font-semibold text-text">{r.worker_name}</span>
              {r.pct != null && <span className={`text-[13px] font-bold ${pctColor(r.pct)}`}>{fmtPct(r.pct)}</span>}
              {r.entry_id && r.lines.some((l) => l.status !== "confirmed") && (
                <button onClick={() => act(r.entry_id!, undefined, "confirmed")} disabled={busy === `all-${r.entry_id}`} className="ml-auto text-[12px] px-3 py-1.5 rounded-lg bg-accent text-white cursor-pointer">✓ Потвърди всички</button>
              )}
            </div>
            {r.lines.length === 0 ? <div className="text-[12px] text-text-3">няма запис</div> : (
              <div className="divide-y divide-border">
                {r.lines.map((l) => edit?.id === l.id ? (
                  <div key={l.id} className="flex items-center gap-2 py-2 flex-wrap">
                    <span className="text-[13px] text-text">{l.name}</span>
                    <input value={edit.product} onChange={(e) => setEdit({ ...edit, product: e.target.value })} placeholder="продукт" className={inputCls + " py-1 w-40"} />
                    {l.difficulty != null && (
                      <select value={edit.difficulty ?? 1} onChange={(e) => setEdit({ ...edit, difficulty: Number(e.target.value) })} className={inputCls + " py-1"}>{[1, 2, 3].map((d) => <option key={d} value={d}>трудност {d}</option>)}</select>
                    )}
                    <input value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: e.target.value.replace(/[^\d]/g, "") })} className={inputCls + " py-1 w-24 text-right"} />
                    <button onClick={() => saveEdit(r.entry_id!)} className="text-[12px] px-3 py-1.5 rounded-lg bg-accent text-white cursor-pointer">Запази</button>
                    <button onClick={() => setEdit(null)} className="text-[12px] px-2 py-1.5 text-text-3 cursor-pointer">отказ</button>
                  </div>
                ) : (
                  <div key={l.id} className="flex items-center gap-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-text">{l.name}{l.product ? ` · ${l.product}` : ""}{l.difficulty ? ` · трудност ${l.difficulty}` : ""}</div>
                      <div className="text-[12px] text-text-3">{l.qty} бр{l.pct != null ? ` · ${l.pct}%` : l.norm == null ? " · няма норма" : ""}{l.note ? ` · бел.: ${l.note}` : ""}</div>
                    </div>
                    {l.status === "confirmed" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-600">потвърдено</span>}
                    {l.status === "rejected" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-600">върнато</span>}
                    <button onClick={() => setEdit({ id: l.id, qty: String(l.qty), product: l.product || "", difficulty: l.difficulty })} className="text-text-3 hover:text-accent cursor-pointer" title="Редактирай"><Pencil size={14} /></button>
                    {l.status !== "confirmed" && <button onClick={() => act(r.entry_id!, l.id, "confirmed")} disabled={busy === l.id} className="text-[12px] px-2.5 py-1.5 rounded-lg bg-accent text-white cursor-pointer flex items-center gap-1"><Check size={13} /></button>}
                    {l.status !== "rejected" && <button onClick={() => act(r.entry_id!, l.id, "rejected")} disabled={busy === l.id} className="text-[12px] px-2.5 py-1.5 rounded-lg border border-red-400 text-red-500 cursor-pointer flex items-center gap-1"><RotateCcw size={13} /></button>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
        {rows.length === 0 && <Card className="p-6 text-center text-text-3 text-[13px]">Зареждане…</Card>}
      </div>
    </>
  );
}

// ─────────── Настройки ───────────
interface Op { id: number; name: string; unit: string; norm_per_day: number | null; has_difficulty: boolean; diff_norms: Record<string, number> | null }
function Settings() {
  const { data: opsData, mutate: mutateOps } = useSWR("/api/prod/operations", fetcher, { revalidateOnFocus: false });
  const { data: wkData, mutate: mutateWk } = useSWR("/api/prod/workers", fetcher, { revalidateOnFocus: false });
  const ops: Op[] = opsData?.operations ?? [];
  const workers = wkData?.workers ?? [];
  const [norms, setNorms] = useState<Record<number, string>>({});
  const [diffs, setDiffs] = useState<Record<number, { 1: string; 2: string; 3: string }>>({});
  const [newOp, setNewOp] = useState("");
  const [newW, setNewW] = useState({ name: "", pin: "" });

  const dval = (o: Op, d: 1 | 2 | 3) => diffs[o.id]?.[d] ?? (o.diff_norms?.[String(d)] != null ? String(o.diff_norms![String(d)]) : "");
  async function saveNorm(o: Op) {
    if (o.has_difficulty) {
      const dn = { 1: Number(dval(o, 1)) || 0, 2: Number(dval(o, 2)) || 0, 3: Number(dval(o, 3)) || 0 };
      await fetch("/api/prod/operations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: o.id, diff_norms: dn }) });
    } else {
      await fetch("/api/prod/operations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: o.id, norm_per_day: norms[o.id] ?? o.norm_per_day ?? "" }) });
    }
    mutateOps();
  }
  async function addOp() { if (!newOp.trim()) return; await fetch("/api/prod/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newOp.trim() }) }); setNewOp(""); mutateOps(); }
  async function addWorker() { if (!newW.name.trim() || !newW.pin.trim()) return; await fetch("/api/prod/workers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newW) }); setNewW({ name: "", pin: "" }); mutateWk(); }
  async function resetPin(id: number) { const pin = prompt("Нов 4-цифрен PIN:"); if (!pin) return; await fetch("/api/prod/workers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, pin }) }); mutateWk(); }
  async function toggleW(id: number, active: boolean) { await fetch("/api/prod/workers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, active }) }); mutateWk(); }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <Card className="p-4">
        <div className="text-[14px] font-semibold text-text mb-1">Операции и норми (на пълен ден)</div>
        <p className="text-[12px] text-text-3 mb-3">Капсулирането има 3 норми по трудност (1 лесни · 2 средни · 3 трудни).</p>
        <div className="space-y-3">
          {ops.map((o) => (
            <div key={o.id} className="border-b border-border pb-2">
              <div className="text-[14px] text-text mb-1">{o.name}</div>
              {o.has_difficulty ? (
                <div className="flex items-center gap-2">
                  {[1, 2, 3].map((d) => (
                    <input key={d} value={dval(o, d as 1 | 2 | 3)} onChange={(e) => setDiffs((s) => ({ ...s, [o.id]: { 1: dval(o, 1), 2: dval(o, 2), 3: dval(o, 3), [d]: e.target.value.replace(/[^\d.,]/g, "") } }))} placeholder={`тр.${d}`} className={inputCls + " w-20 text-right py-1.5"} />
                  ))}
                  <span className="text-[12px] text-text-3">{o.unit}</span>
                  <button onClick={() => saveNorm(o)} className="text-text-3 hover:text-accent ml-auto" title="Запази"><Save size={16} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input value={norms[o.id] ?? (o.norm_per_day ?? "")} onChange={(e) => setNorms((n) => ({ ...n, [o.id]: e.target.value.replace(/[^\d.,]/g, "") }))} placeholder="норма" className={inputCls + " w-28 text-right py-1.5"} />
                  <span className="text-[12px] text-text-3">{o.unit}</span>
                  <button onClick={() => saveNorm(o)} className="text-text-3 hover:text-accent ml-auto" title="Запази"><Save size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <input value={newOp} onChange={(e) => setNewOp(e.target.value)} placeholder="нова операция" className={inputCls + " flex-1"} />
          <button onClick={addOp} className="px-3 rounded-lg bg-accent text-white cursor-pointer"><Plus size={16} /></button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[14px] font-semibold text-text mb-3">Колеги и PIN кодове</div>
        <div className="space-y-2">
          {workers.map((w: { id: number; name: string; pin: string; active: boolean; is_supervisor: boolean }) => (
            <div key={w.id} className={`flex items-center gap-2 ${w.active ? "" : "opacity-50"}`}>
              <div className="flex-1 text-[14px] text-text">{w.name}{w.is_supervisor && <span className="text-[11px] text-accent ml-1">(ръководител)</span>}</div>
              <span className="text-[13px] font-mono tabular-nums bg-surface-2 rounded px-2 py-1">{w.pin}</span>
              <button onClick={() => resetPin(w.id)} className="text-[11px] text-accent hover:underline">смени PIN</button>
              <button onClick={() => toggleW(w.id, !w.active)} className="text-[11px] text-text-3 hover:underline">{w.active ? "скрий" : "върни"}</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3 pt-3 border-t border-border">
          <input value={newW.name} onChange={(e) => setNewW({ ...newW, name: e.target.value })} placeholder="име" className={inputCls + " flex-1"} />
          <input value={newW.pin} onChange={(e) => setNewW({ ...newW, pin: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })} placeholder="PIN" className={inputCls + " w-20 text-center"} />
          <button onClick={addWorker} className="px-3 rounded-lg bg-accent text-white cursor-pointer"><Plus size={16} /></button>
        </div>
      </Card>
    </div>
  );
}
