"use client";

import { useState } from "react";
import useSWR from "swr";
import { Gauge, Check, RotateCcw, Loader2, Plus, Save } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

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

// ─────────── Дашборд ───────────
function Dashboard() {
  const [from, setFrom] = useState(daysAgoISO(6));
  const [to, setTo] = useState(todayISO());
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);
  const { data } = useSWR(`/api/prod/dashboard?from=${from}&to=${to}${onlyConfirmed ? "&confirmed=1" : ""}`, fetcher, { revalidateOnFocus: false });
  const rows = data?.rows ?? [];
  const ops = data?.operations ?? [];
  return (
    <>
      <Card className="p-4 mb-4 flex items-end gap-3 flex-wrap">
        <div><label className="block text-[11px] text-text-3 mb-1">От</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></div>
        <div><label className="block text-[11px] text-text-3 mb-1">До</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></div>
        <label className="flex items-center gap-2 text-[13px] text-text-2"><input type="checkbox" checked={onlyConfirmed} onChange={(e) => setOnlyConfirmed(e.target.checked)} /> само потвърдени</label>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-[13px]">
          <thead><tr className="text-[11px] uppercase tracking-wider text-text-3">
            <th className="text-left px-4 py-2.5 font-medium">Колега</th>
            <th className="text-right px-4 py-2.5 font-medium">Дни</th>
            <th className="text-right px-4 py-2.5 font-medium">Средно %</th>
            <th className="text-right px-4 py-2.5 font-medium">Потвърдени</th>
            <th className="text-right px-4 py-2.5 font-medium">Чакащи</th>
            <th className="text-right px-4 py-2.5 font-medium">Върнати</th>
          </tr></thead>
          <tbody>
            {rows.map((r: { worker_id: number; worker_name: string; days: number; avg_pct: number | null; confirmed: number; submitted: number; rejected: number }) => (
              <tr key={r.worker_id} className="border-t border-border">
                <td className="px-4 py-2.5 font-medium text-text">{r.worker_name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-2">{r.days}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${pctColor(r.avg_pct)}`}>{fmtPct(r.avg_pct)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-accent">{r.confirmed}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-amber-600">{r.submitted || "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-red-500">{r.rejected || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="text-center text-text-3 py-6">Няма данни за периода.</td></tr>}
          </tbody>
        </table>
      </Card>
      {ops.some((o: { norm_per_day: number | null }) => o.norm_per_day == null) && (
        <p className="text-[12px] text-amber-600 mt-3">⚠ Някои операции нямат зададена норма → не влизат в % изчислението. Задай нормите в „Настройки“.</p>
      )}
    </>
  );
}

// ─────────── Преглед / потвърждаване ───────────
function Review() {
  const [date, setDate] = useState(todayISO());
  const { data, mutate } = useSWR(`/api/prod/review?date=${date}`, fetcher, { revalidateOnFocus: false });
  const rows = data?.rows ?? [];
  const [busy, setBusy] = useState<number | null>(null);
  async function act(id: number, status: string) {
    let note: string | null = null;
    if (status === "rejected") { note = prompt("Причина за връщане (по избор):") || null; }
    setBusy(id);
    try {
      await fetch("/api/prod/review", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status, note }) });
      mutate();
    } finally { setBusy(null); }
  }
  const shift = (n: number) => { const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + n); const iso = d.toISOString().slice(0, 10); if (iso <= todayISO()) setDate(iso); };
  return (
    <>
      <Card className="p-3 mb-4 flex items-center justify-between">
        <button onClick={() => shift(-1)} className="px-3 py-1 text-text-2">‹</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + " py-1.5"} />
        <button onClick={() => shift(1)} disabled={date >= todayISO()} className="px-3 py-1 text-text-2 disabled:opacity-30">›</button>
      </Card>
      <div className="space-y-3">
        {rows.map((r: { worker_id: number; worker_name: string; entry_id: number | null; items: { name: string; qty: number }[]; status: string; pct: number | null; review_note: string | null }) => (
          <Card key={r.worker_id} className="p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold text-text">{r.worker_name}</span>
                  {r.status === "confirmed" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-600">потвърдено</span>}
                  {r.status === "submitted" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">чака</span>}
                  {r.status === "rejected" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-600">върнато</span>}
                  {r.status === "none" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-text-3">няма запис</span>}
                  {r.pct != null && <span className={`text-[13px] font-bold ${pctColor(r.pct)}`}>{fmtPct(r.pct)}</span>}
                </div>
                {r.items.length > 0 ? (
                  <div className="text-[13px] text-text-2 mt-1">{r.items.map((it) => `${it.name}: ${it.qty}`).join(" · ")}</div>
                ) : r.status !== "none" ? <div className="text-[12px] text-text-3 mt-1">празен запис</div> : null}
                {r.review_note && <div className="text-[12px] text-red-500 mt-1">Бележка: {r.review_note}</div>}
              </div>
              {r.entry_id && r.status !== "none" && (
                <div className="flex gap-2">
                  {r.status !== "confirmed" && <button onClick={() => act(r.entry_id!, "confirmed")} disabled={busy === r.entry_id} className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-lg bg-accent text-white cursor-pointer disabled:opacity-50">{busy === r.entry_id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Потвърди</button>}
                  {r.status !== "rejected" && <button onClick={() => act(r.entry_id!, "rejected")} disabled={busy === r.entry_id} className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-lg border border-red-400 text-red-500 hover:bg-red-500/10 cursor-pointer disabled:opacity-50"><RotateCcw size={13} /> Върни</button>}
                </div>
              )}
            </div>
          </Card>
        ))}
        {rows.length === 0 && <Card className="p-6 text-center text-text-3 text-[13px]">Няма колеги.</Card>}
      </div>
    </>
  );
}

// ─────────── Настройки (операции + колеги) ───────────
function Settings() {
  const { data: opsData, mutate: mutateOps } = useSWR("/api/prod/operations", fetcher, { revalidateOnFocus: false });
  const { data: wkData, mutate: mutateWk } = useSWR("/api/prod/workers", fetcher, { revalidateOnFocus: false });
  const ops = opsData?.operations ?? [];
  const workers = wkData?.workers ?? [];
  const [norms, setNorms] = useState<Record<number, string>>({});
  const [newOp, setNewOp] = useState("");
  const [newW, setNewW] = useState({ name: "", pin: "" });

  async function saveNorm(id: number) {
    await fetch("/api/prod/operations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, norm_per_day: norms[id] }) });
    mutateOps();
  }
  async function addOp() { if (!newOp.trim()) return; await fetch("/api/prod/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newOp.trim() }) }); setNewOp(""); mutateOps(); }
  async function addWorker() { if (!newW.name.trim() || !newW.pin.trim()) return; await fetch("/api/prod/workers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newW) }); setNewW({ name: "", pin: "" }); mutateWk(); }
  async function resetPin(id: number) { const pin = prompt("Нов 4-цифрен PIN:"); if (!pin) return; await fetch("/api/prod/workers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, pin }) }); mutateWk(); }
  async function toggleW(id: number, active: boolean) { await fetch("/api/prod/workers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, active }) }); mutateWk(); }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <Card className="p-4">
        <div className="text-[14px] font-semibold text-text mb-3">Операции и норми (на пълен ден)</div>
        <div className="space-y-2">
          {ops.map((o: { id: number; name: string; unit: string; norm_per_day: number | null }) => (
            <div key={o.id} className="flex items-center gap-2">
              <div className="flex-1 text-[14px] text-text">{o.name}</div>
              <input value={norms[o.id] ?? (o.norm_per_day ?? "")} onChange={(e) => setNorms((n) => ({ ...n, [o.id]: e.target.value.replace(/[^\d.,]/g, "") }))} placeholder="норма" className={inputCls + " w-28 text-right py-1.5"} />
              <span className="text-[12px] text-text-3 w-6">{o.unit}</span>
              <button onClick={() => saveNorm(o.id)} className="text-text-3 hover:text-accent" title="Запази"><Save size={16} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3 pt-3 border-t border-border">
          <input value={newOp} onChange={(e) => setNewOp(e.target.value)} placeholder="нова операция" className={inputCls + " flex-1"} />
          <button onClick={addOp} className="px-3 rounded-lg bg-accent text-white cursor-pointer"><Plus size={16} /></button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[14px] font-semibold text-text mb-3">Колеги и PIN кодове</div>
        <div className="space-y-2">
          {workers.map((w: { id: number; name: string; pin: string; active: boolean }) => (
            <div key={w.id} className={`flex items-center gap-2 ${w.active ? "" : "opacity-50"}`}>
              <div className="flex-1 text-[14px] text-text">{w.name}</div>
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
