"use client";

import { useCallback, useEffect, useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const todayISO = () => new Date().toISOString().slice(0, 10);
const bgDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("bg-BG", { weekday: "long", day: "2-digit", month: "long" });
const uid = () => Math.random().toString(36).slice(2);

interface Worker { id: number; name: string; is_supervisor?: boolean }
interface Op { id: number; name: string; unit: string; has_difficulty?: boolean }
type Status = "submitted" | "confirmed" | "rejected";
interface Item { id: string; operation_id: number; name: string; qty: number; difficulty: number | null; product: string | null; status: Status; note: string | null }
interface Entry { items: Item[]; status: Status }

export function CexPortal() {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [booting, setBooting] = useState(true);
  useEffect(() => { fetcher("/api/cex/me").then((d) => setWorker(d.worker)).finally(() => setBooting(false)); }, []);
  if (booting) return <Center>Зареждане…</Center>;
  if (!worker) return <Login onLogin={setWorker} />;
  return worker.is_supervisor ? <Supervisor worker={worker} onLogout={() => setWorker(null)} /> : <DayForm worker={worker} onLogout={() => setWorker(null)} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center text-[15px] text-text-2 p-6" style={{ background: "var(--bg)" }}>{children}</div>;
}
async function logout(cb: () => void) { await fetch("/api/cex/me", { method: "POST" }); cb(); }

// ─────────────── Вход с PIN ───────────────
function Login({ onLogin }: { onLogin: (w: Worker) => void }) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [sel, setSel] = useState<Worker | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetcher("/api/cex/workers").then((d) => setWorkers(d.workers ?? [])); }, []);
  async function submit() {
    if (!sel || pin.length < 3 || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/cex/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worker_id: sel.id, pin }) }).then((x) => x.json());
      if (r.ok) onLogin(r.worker); else { setErr(r.error || "Грешен PIN"); setPin(""); }
    } finally { setBusy(false); }
  }
  const key = (d: string) => { if (d === "←") setPin((p) => p.slice(0, -1)); else if (pin.length < 4) setPin((p) => p + d); };
  return (
    <div className="min-h-screen px-5 py-8" style={{ background: "var(--bg)" }}>
      <div className="max-w-sm mx-auto">
        <div className="flex flex-col items-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cvetita-logo.png" alt="Цветита Хербал" width={220} height={57} className="mb-2" />
          <div className="text-[13px] text-text-3">Производство · моят ден</div>
        </div>
        {!sel ? (
          <>
            <p className="text-[14px] font-medium text-text mb-3">Избери името си:</p>
            <div className="grid grid-cols-2 gap-3">
              {workers.map((w) => (
                <button key={w.id} onClick={() => { setSel(w); setPin(""); setErr(""); }} className="py-4 rounded-2xl bg-surface border border-border text-[16px] font-medium text-text active:scale-95 transition-transform shadow-sm">{w.name}</button>
              ))}
              {workers.length === 0 && <div className="col-span-2 text-center text-text-3 text-[13px] py-6">Зареждане…</div>}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => setSel(null)} className="text-[13px] text-text-3 mb-3">‹ Назад</button>
            <p className="text-[16px] font-semibold text-text text-center mb-1">Здравей, {sel.name}</p>
            <p className="text-[13px] text-text-3 text-center mb-4">Въведи своя PIN</p>
            <div className="flex justify-center gap-3 mb-5">{[0, 1, 2, 3].map((i) => <div key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? "bg-accent" : "bg-border"}`} />)}</div>
            {err && <p className="text-center text-[13px] text-red-500 mb-3">{err}</p>}
            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "←"].map((d, i) => d === "" ? <div key={i} /> : (
                <button key={i} onClick={() => key(d)} className="py-5 rounded-2xl bg-surface border border-border text-[22px] font-semibold text-text active:scale-95 transition-transform shadow-sm">{d}</button>
              ))}
            </div>
            <button onClick={submit} disabled={pin.length < 3 || busy} className="w-full mt-5 py-4 rounded-2xl bg-accent text-white text-[17px] font-semibold disabled:opacity-40 active:scale-95 transition-transform">{busy ? "Влизане…" : "Влез"}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────── Колега: дневна форма (редове) ───────────────
interface EditLine { key: string; id?: string; operation_id: number; name: string; product: string; difficulty: number | null; qty: string; status?: Status; note?: string | null }
const DIFF_HINT = "1 = лесни (целулоза) · 2 = средни · 3 = трудни (кверцетин)";

function DayForm({ worker, onLogout }: { worker: Worker; onLogout: () => void }) {
  const [date, setDate] = useState(todayISO());
  const [ops, setOps] = useState<Op[]>([]);
  const [locked, setLocked] = useState<Item[]>([]);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true); setMsg("");
    fetcher(`/api/cex/entry?date=${date}`).then((d: { operations: Op[]; entry: Entry | null }) => {
      setOps(d.operations ?? []);
      const items = d.entry?.items ?? [];
      setLocked(items.filter((i) => i.status === "confirmed"));
      setLines(items.filter((i) => i.status !== "confirmed").map((i) => ({ key: i.id, id: i.id, operation_id: i.operation_id, name: i.name, product: i.product || "", difficulty: i.difficulty, qty: String(i.qty), status: i.status, note: i.note })));
    }).finally(() => setLoading(false));
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const addLine = (op: Op) => setLines((a) => [...a, { key: uid(), operation_id: op.id, name: op.name, product: "", difficulty: op.has_difficulty ? 1 : null, qty: "" }]);
  const upd = (key: string, patch: Partial<EditLine>) => setLines((a) => a.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const rm = (key: string) => setLines((a) => a.filter((l) => l.key !== key));
  const opById = (id: number) => ops.find((o) => o.id === id);

  async function save() {
    if (saving) return;
    setSaving(true); setMsg("");
    try {
      const items = lines.filter((l) => (Number(l.qty) || 0) > 0).map((l) => ({ id: l.id, operation_id: l.operation_id, name: l.name, qty: Number(l.qty) || 0, difficulty: l.difficulty, product: l.product.trim() || null }));
      const r = await fetch("/api/cex/entry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_date: date, items }) }).then((x) => x.json());
      if (r.error) setMsg(r.error); else { setMsg("✓ Записано! Благодаря."); load(); }
    } finally { setSaving(false); }
  }
  const shift = (n: number) => { const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + n); const iso = d.toISOString().slice(0, 10); if (iso <= todayISO()) setDate(iso); };

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: "var(--bg)" }}>
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cvetita-mark.png" alt="" width={28} height={28} className="rounded-lg" />
            <div className="text-[17px] font-bold text-text">Здравей, {worker.name}</div>
          </div>
          <button onClick={() => logout(onLogout)} className="text-[13px] text-text-3 border border-border rounded-lg px-3 py-1.5">Изход</button>
        </div>
        <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-3 py-2 mb-4">
          <button onClick={() => shift(-1)} className="text-[18px] text-text-2 px-2">‹</button>
          <div className="text-[14px] font-medium text-text capitalize">{bgDate(date)}{date === todayISO() ? " (днес)" : ""}</div>
          <button onClick={() => shift(1)} disabled={date >= todayISO()} className="text-[18px] text-text-2 px-2 disabled:opacity-30">›</button>
        </div>

        {/* Потвърдени (заключени) */}
        {locked.length > 0 && (
          <div className="mb-4">
            <p className="text-[12px] text-text-3 mb-1.5">✅ Потвърдени от ръководител (не се променят):</p>
            <div className="space-y-1.5">
              {locked.map((i) => (
                <div key={i.id} className="flex items-center gap-2 bg-green-500/10 rounded-xl px-3 py-2 text-[13px]">
                  <span className="flex-1 text-text">{i.name}{i.product ? ` · ${i.product}` : ""}{i.difficulty ? ` · тр.${i.difficulty}` : ""}</span>
                  <span className="font-semibold tabular-nums">{i.qty}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[14px] font-medium text-text mb-2">Какво направи днес?</p>
        <p className="text-[12px] text-text-3 mb-3">Избери операция, за да добавиш ред:</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {ops.map((o) => (
            <button key={o.id} onClick={() => addLine(o)} className="text-[13px] px-3 py-2 rounded-xl bg-surface border border-border text-text active:scale-95 transition-transform">+ {o.name}</button>
          ))}
        </div>

        {loading ? <div className="text-center text-text-3 py-6">Зареждане…</div> : (
          <div className="space-y-3">
            {lines.map((l) => {
              const hasDiff = !!opById(l.operation_id)?.has_difficulty;
              const rejected = l.status === "rejected";
              return (
                <div key={l.key} className={`bg-surface border rounded-2xl p-3 ${rejected ? "border-red-400" : "border-border"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex-1 text-[15px] font-medium text-text">{l.name}</span>
                    <button onClick={() => rm(l.key)} className="text-text-3 text-[18px] leading-none px-1">×</button>
                  </div>
                  <input value={l.product} onChange={(e) => upd(l.key, { product: e.target.value })} placeholder="продукт (по избор)" className="w-full mb-2 px-3 py-2 rounded-xl border border-border bg-surface-2 text-[14px] text-text" />
                  {hasDiff && (
                    <div className="mb-2">
                      <div className="flex gap-2">
                        {[1, 2, 3].map((d) => (
                          <button key={d} onClick={() => upd(l.key, { difficulty: d })} className={`flex-1 py-2 rounded-xl text-[15px] font-semibold border ${l.difficulty === d ? "bg-accent text-white border-accent" : "border-border text-text-2"}`}>{d}</button>
                        ))}
                      </div>
                      <p className="text-[11px] text-text-3 mt-1">{DIFF_HINT}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input inputMode="numeric" pattern="[0-9]*" value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value.replace(/[^\d]/g, "") })} placeholder="брой" className="flex-1 text-right text-[18px] font-semibold rounded-xl border border-border px-3 py-2.5 bg-surface-2 text-text" />
                    <span className="text-[13px] text-text-3 w-8">{opById(l.operation_id)?.unit || "бр"}</span>
                  </div>
                  {rejected && <p className="text-[12px] text-red-500 mt-1">↩ Върнато{l.note ? `: ${l.note}` : ""} — поправи и запиши.</p>}
                </div>
              );
            })}
            {lines.length === 0 && locked.length === 0 && <p className="text-center text-text-3 text-[13px] py-4">Още нищо. Избери операция отгоре.</p>}
          </div>
        )}

        {msg && <p className={`text-center text-[14px] mt-4 ${msg.startsWith("✓") ? "text-accent" : "text-red-500"}`}>{msg}</p>}
        <button onClick={save} disabled={saving || loading} className="w-full mt-5 py-4 rounded-2xl bg-accent text-white text-[17px] font-semibold disabled:opacity-40 active:scale-95 transition-transform">{saving ? "Записване…" : "Запиши деня"}</button>
      </div>
    </div>
  );
}

// ─────────────── Супервайзър (телефон) ───────────────
interface RLine { id: string; name: string; qty: number; difficulty: number | null; product: string | null; status: Status; note: string | null; pct: number | null; norm: number | null }
interface RRow { worker_id: number; worker_name: string; entry_id: number | null; status: string; pct: number | null; lines: RLine[] }
interface DRow { worker_id: number; worker_name: string; days: number; avg_pct: number | null; series: { date: string; pct: number }[] }

const pctColor = (p: number | null) => (p == null ? "text-text-3" : p >= 100 ? "text-accent" : p >= 80 ? "text-amber-600" : "text-red-500");

function Supervisor({ worker, onLogout }: { worker: Worker; onLogout: () => void }) {
  const [view, setView] = useState<"review" | "dash">("review");
  return (
    <div className="min-h-screen px-4 py-5" style={{ background: "var(--bg)" }}>
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cvetita-mark.png" alt="" width={28} height={28} className="rounded-lg" />
            <div className="text-[17px] font-bold text-text">{worker.name}</div>
          </div>
          <button onClick={() => logout(onLogout)} className="text-[13px] text-text-3 border border-border rounded-lg px-3 py-1.5">Изход</button>
        </div>
        <div className="flex gap-2 mb-4">
          <button onClick={() => setView("review")} className={`flex-1 py-2.5 rounded-xl text-[14px] font-medium ${view === "review" ? "bg-accent text-white" : "border border-border text-text-2"}`}>Преглед</button>
          <button onClick={() => setView("dash")} className={`flex-1 py-2.5 rounded-xl text-[14px] font-medium ${view === "dash" ? "bg-accent text-white" : "border border-border text-text-2"}`}>Дашборд</button>
        </div>
        {view === "review" ? <SupReview /> : <SupDash />}
      </div>
    </div>
  );
}

function SupReview() {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<{ rows: RRow[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; qty: string; product: string; difficulty: number | null } | null>(null);
  const load = useCallback(() => { fetcher(`/api/cex/review?date=${date}`).then(setData); }, [date]);
  useEffect(() => { load(); }, [load]);
  async function saveEdit(entry_id: number) {
    if (!edit) return;
    setBusy(edit.id);
    try {
      await fetch("/api/cex/review", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry_id, line_id: edit.id, edit: { qty: Number(edit.qty) || 0, product: edit.product.trim() || null, difficulty: edit.difficulty } }) });
      setEdit(null); load();
    } finally { setBusy(null); }
  }
  async function act(entry_id: number, line_id: string, status: Status) {
    let note: string | null = null;
    if (status === "rejected") note = prompt("Причина (по избор):") || null;
    setBusy(line_id);
    try { await fetch("/api/cex/review", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry_id, line_id, status, note }) }); load(); } finally { setBusy(null); }
  }
  async function confirmAll(entry_id: number) {
    setBusy(`all-${entry_id}`);
    try { await fetch("/api/cex/review", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry_id, status: "confirmed" }) }); load(); } finally { setBusy(null); }
  }
  const shift = (n: number) => { const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + n); const iso = d.toISOString().slice(0, 10); if (iso <= todayISO()) setDate(iso); };
  const rows = data?.rows ?? [];
  return (
    <>
      <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-3 py-2 mb-4">
        <button onClick={() => shift(-1)} className="text-[18px] text-text-2 px-2">‹</button>
        <div className="text-[14px] font-medium text-text capitalize">{bgDate(date)}</div>
        <button onClick={() => shift(1)} disabled={date >= todayISO()} className="text-[18px] text-text-2 px-2 disabled:opacity-30">›</button>
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.worker_id} className="bg-surface border border-border rounded-2xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[15px] font-semibold text-text flex-1">{r.worker_name}</span>
              {r.pct != null && <span className={`text-[14px] font-bold ${pctColor(r.pct)}`}>{r.pct}%</span>}
            </div>
            {r.entry_id && r.lines.some((l) => l.status !== "confirmed") && (
              <button onClick={() => confirmAll(r.entry_id!)} disabled={busy === `all-${r.entry_id}`} className="w-full mb-2 py-2 rounded-xl bg-accent text-white text-[13px] font-semibold">✓ Потвърди всички</button>
            )}
            {r.lines.length === 0 ? <p className="text-[12px] text-text-3">няма запис</p> : (
              <div className="space-y-2">
                {r.lines.map((l) => edit?.id === l.id ? (
                  <div key={l.id} className="border-t border-border pt-2 space-y-2">
                    <div className="text-[13px] font-medium text-text">{l.name}</div>
                    <input value={edit.product} onChange={(e) => setEdit({ ...edit, product: e.target.value })} placeholder="продукт" className="w-full px-3 py-2 rounded-lg border border-border bg-surface-2 text-[14px]" />
                    {l.difficulty != null && (
                      <div className="flex gap-2">{[1, 2, 3].map((d) => <button key={d} onClick={() => setEdit({ ...edit, difficulty: d })} className={`flex-1 py-1.5 rounded-lg text-[14px] font-semibold border ${edit.difficulty === d ? "bg-accent text-white border-accent" : "border-border text-text-2"}`}>{d}</button>)}</div>
                    )}
                    <div className="flex items-center gap-2">
                      <input inputMode="numeric" value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: e.target.value.replace(/[^\d]/g, "") })} className="flex-1 text-right text-[16px] font-semibold rounded-lg border border-border px-3 py-2 bg-surface-2" />
                      <button onClick={() => r.entry_id && saveEdit(r.entry_id)} className="px-3 py-2 rounded-lg bg-accent text-white text-[13px]">Запази</button>
                      <button onClick={() => setEdit(null)} className="px-3 py-2 rounded-lg border border-border text-text-3 text-[13px]">×</button>
                    </div>
                  </div>
                ) : (
                  <div key={l.id} className="flex items-center gap-2 border-t border-border pt-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-text">{l.name}{l.product ? ` · ${l.product}` : ""}{l.difficulty ? ` · тр.${l.difficulty}` : ""}</div>
                      <div className="text-[12px] text-text-3">{l.qty} бр{l.pct != null ? ` · ${l.pct}%` : l.norm == null ? " · няма норма" : ""}</div>
                    </div>
                    {l.status === "confirmed" ? <span className="text-[11px] text-accent">✅</span> : l.status === "rejected" ? <span className="text-[11px] text-red-500">↩</span> : null}
                    <button onClick={() => setEdit({ id: l.id, qty: String(l.qty), product: l.product || "", difficulty: l.difficulty })} className="text-[13px] px-2 py-1.5 text-text-3" title="Редактирай">✎</button>
                    {l.status !== "confirmed" && <button onClick={() => r.entry_id && act(r.entry_id, l.id, "confirmed")} disabled={busy === l.id} className="text-[12px] px-2.5 py-1.5 rounded-lg bg-accent text-white">✓</button>}
                    {l.status !== "rejected" && <button onClick={() => r.entry_id && act(r.entry_id, l.id, "rejected")} disabled={busy === l.id} className="text-[12px] px-2.5 py-1.5 rounded-lg border border-red-400 text-red-500">↩</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-center text-text-3 text-[13px] py-6">Зареждане…</p>}
      </div>
    </>
  );
}

function SupDash() {
  const [days, setDays] = useState(7);
  const to = todayISO();
  const from = (() => { const d = new Date(); d.setDate(d.getDate() - (days - 1)); return d.toISOString().slice(0, 10); })();
  const [data, setData] = useState<{ rows: DRow[] } | null>(null);
  useEffect(() => { fetcher(`/api/cex/dashboard?from=${from}&to=${to}`).then(setData); }, [from, to]);
  const rows = data?.rows ?? [];
  return (
    <>
      <div className="flex gap-2 mb-4">
        {[7, 14, 30].map((d) => <button key={d} onClick={() => setDays(d)} className={`flex-1 py-2 rounded-xl text-[13px] ${days === d ? "bg-accent text-white" : "border border-border text-text-2"}`}>{d} дни</button>)}
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.worker_id} className="bg-surface border border-border rounded-2xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[15px] font-semibold text-text">{r.worker_name}</span>
              <span className={`text-[15px] font-bold ${pctColor(r.avg_pct)}`}>{r.avg_pct == null ? "—" : `${r.avg_pct}%`}</span>
            </div>
            <Sparkbars series={r.series} />
            <div className="text-[11px] text-text-3 mt-1">{r.days} дни с запис</div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-center text-text-3 text-[13px] py-6">Няма данни.</p>}
      </div>
    </>
  );
}

export function Sparkbars({ series }: { series: { date: string; pct: number }[] }) {
  if (!series.length) return <div className="text-[12px] text-text-3">няма записи за периода</div>;
  const max = Math.max(120, ...series.map((s) => s.pct));
  return (
    <div className="flex items-end gap-1 h-16">
      {series.map((s) => {
        const h = Math.max(4, Math.round((s.pct / max) * 60));
        const color = s.pct >= 100 ? "var(--accent, #22c55e)" : s.pct >= 80 ? "#d97706" : "#ef4444";
        return <div key={s.date} className="flex-1 flex flex-col items-center justify-end" title={`${s.date.slice(5)}: ${s.pct}%`}>
          <div style={{ height: h, background: color }} className="w-full rounded-t" />
        </div>;
      })}
    </div>
  );
}
