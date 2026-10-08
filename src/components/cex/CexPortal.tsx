"use client";

import { useCallback, useEffect, useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const todayISO = () => new Date().toISOString().slice(0, 10);
const bgDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("bg-BG", { weekday: "long", day: "2-digit", month: "long" });

interface Worker { id: number; name: string }
interface Op { id: number; name: string; unit: string }
interface Entry { items: { operation_id: number; name: string; qty: number }[]; status: "submitted" | "confirmed" | "rejected"; review_note: string | null }

export function CexPortal() {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    fetcher("/api/cex/me").then((d) => setWorker(d.worker)).finally(() => setBooting(false));
  }, []);

  if (booting) return <Center>Зареждане…</Center>;
  return worker ? <DayForm worker={worker} onLogout={() => setWorker(null)} /> : <Login onLogin={setWorker} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center text-[15px] text-text-2 p-6" style={{ background: "var(--bg)" }}>{children}</div>;
}

// ─────────────────────── Вход с PIN ───────────────────────
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
      if (r.ok) onLogin(r.worker);
      else { setErr(r.error || "Грешен PIN"); setPin(""); }
    } finally { setBusy(false); }
  }

  const key = (d: string) => { if (d === "←") setPin((p) => p.slice(0, -1)); else if (pin.length < 4) setPin((p) => p + d); };

  return (
    <div className="min-h-screen px-5 py-8" style={{ background: "var(--bg)" }}>
      <div className="max-w-sm mx-auto">
        <h1 className="text-[20px] font-bold text-text text-center mb-1">Производство</h1>
        <p className="text-[13px] text-text-3 text-center mb-6">Моят работен ден</p>

        {!sel ? (
          <>
            <p className="text-[14px] font-medium text-text mb-3">Избери името си:</p>
            <div className="grid grid-cols-2 gap-3">
              {workers.map((w) => (
                <button key={w.id} onClick={() => { setSel(w); setPin(""); setErr(""); }} className="py-4 rounded-2xl bg-surface border border-border text-[16px] font-medium text-text active:scale-95 transition-transform shadow-sm">
                  {w.name}
                </button>
              ))}
              {workers.length === 0 && <div className="col-span-2 text-center text-text-3 text-[13px] py-6">Зареждане…</div>}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => setSel(null)} className="text-[13px] text-text-3 mb-3">‹ Назад</button>
            <p className="text-[16px] font-semibold text-text text-center mb-1">Здравей, {sel.name}</p>
            <p className="text-[13px] text-text-3 text-center mb-4">Въведи своя PIN</p>
            <div className="flex justify-center gap-3 mb-5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? "bg-accent" : "bg-border"}`} />
              ))}
            </div>
            {err && <p className="text-center text-[13px] text-red-500 mb-3">{err}</p>}
            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "←"].map((d, i) => (
                d === "" ? <div key={i} /> : (
                  <button key={i} onClick={() => key(d)} className="py-5 rounded-2xl bg-surface border border-border text-[22px] font-semibold text-text active:scale-95 transition-transform shadow-sm">
                    {d}
                  </button>
                )
              ))}
            </div>
            <button onClick={submit} disabled={pin.length < 3 || busy} className="w-full mt-5 py-4 rounded-2xl bg-accent text-white text-[17px] font-semibold disabled:opacity-40 active:scale-95 transition-transform">
              {busy ? "Влизане…" : "Влез"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────── Дневна форма ───────────────────────
function DayForm({ worker, onLogout }: { worker: Worker; onLogout: () => void }) {
  const [date, setDate] = useState(todayISO());
  const [ops, setOps] = useState<Op[]>([]);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true); setMsg("");
    fetcher(`/api/cex/entry?date=${date}`).then((d) => {
      setOps(d.operations ?? []);
      setEntry(d.entry ?? null);
      const q: Record<number, string> = {};
      for (const it of d.entry?.items ?? []) q[it.operation_id] = String(it.qty);
      setQty(q);
    }).finally(() => setLoading(false));
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const confirmed = entry?.status === "confirmed";
  async function save() {
    if (saving || confirmed) return;
    setSaving(true); setMsg("");
    try {
      const items = ops.filter((o) => (Number(qty[o.id]) || 0) > 0).map((o) => ({ operation_id: o.id, name: o.name, qty: Number(qty[o.id]) || 0 }));
      const r = await fetch("/api/cex/entry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_date: date, items }) }).then((x) => x.json());
      if (r.error) setMsg(r.error);
      else { setMsg("✓ Записано! Благодаря."); load(); }
    } finally { setSaving(false); }
  }
  async function logout() { await fetch("/api/cex/me", { method: "POST" }); onLogout(); }
  const shift = (n: number) => { const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + n); const iso = d.toISOString().slice(0, 10); if (iso <= todayISO()) setDate(iso); };

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: "var(--bg)" }}>
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[17px] font-bold text-text">Здравей, {worker.name}</div>
          </div>
          <button onClick={logout} className="text-[13px] text-text-3 border border-border rounded-lg px-3 py-1.5">Изход</button>
        </div>

        <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-3 py-2 mb-4">
          <button onClick={() => shift(-1)} className="text-[18px] text-text-2 px-2">‹</button>
          <div className="text-[14px] font-medium text-text capitalize">{bgDate(date)}{date === todayISO() ? " (днес)" : ""}</div>
          <button onClick={() => shift(1)} disabled={date >= todayISO()} className="text-[18px] text-text-2 px-2 disabled:opacity-30">›</button>
        </div>

        {entry && (
          <div className={`rounded-xl px-4 py-2.5 mb-4 text-[13px] ${entry.status === "confirmed" ? "bg-green-500/15 text-green-600" : entry.status === "rejected" ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-600"}`}>
            {entry.status === "confirmed" && "✅ Потвърдено от ръководител — не може да се променя."}
            {entry.status === "submitted" && "⏳ Записано — чака потвърждение от ръководител."}
            {entry.status === "rejected" && <>❌ Върнато за корекция{entry.review_note ? `: ${entry.review_note}` : "."} Поправи и запиши пак.</>}
          </div>
        )}

        <p className="text-[14px] font-medium text-text mb-2">Какво направи днес?</p>
        {loading ? (
          <div className="text-center text-text-3 py-8">Зареждане…</div>
        ) : (
          <div className="space-y-2.5">
            {ops.map((o) => (
              <div key={o.id} className="flex items-center gap-3 bg-surface border border-border rounded-2xl px-4 py-3">
                <div className="flex-1 text-[15px] text-text">{o.name}</div>
                <input
                  inputMode="numeric" pattern="[0-9]*"
                  value={qty[o.id] ?? ""}
                  onChange={(e) => setQty((q) => ({ ...q, [o.id]: e.target.value.replace(/[^\d]/g, "") }))}
                  disabled={confirmed}
                  placeholder="0"
                  className="w-24 text-right text-[18px] font-semibold rounded-xl border border-border px-3 py-2 bg-surface-2 text-text disabled:opacity-60"
                />
                <span className="text-[12px] text-text-3 w-6">{o.unit}</span>
              </div>
            ))}
          </div>
        )}

        {msg && <p className={`text-center text-[14px] mt-4 ${msg.startsWith("✓") ? "text-accent" : "text-red-500"}`}>{msg}</p>}

        {!confirmed && (
          <button onClick={save} disabled={saving || loading} className="w-full mt-5 py-4 rounded-2xl bg-accent text-white text-[17px] font-semibold disabled:opacity-40 active:scale-95 transition-transform">
            {saving ? "Записване…" : "Запиши деня"}
          </button>
        )}
      </div>
    </div>
  );
}
