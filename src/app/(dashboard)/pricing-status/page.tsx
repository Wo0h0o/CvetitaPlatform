"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { ListChecks, Plus, Loader2, Trash2, Phone, Mail, Check, CheckCircle2, Link2 } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const todayISO = () => new Date().toISOString().slice(0, 10);
const bg = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "—");

interface Task { kind: "call" | "email"; label: string; due: string; done: boolean; done_at: string | null }
interface Followup {
  id: number;
  client: string | null;
  client_email: string | null;
  subject: string | null;
  status: string;
  sent_date: string | null;
  tasks: Task[];
  note: string | null;
}

const STATUSES = ["нова", "чернова", "изпратена", "чака", "отговорено", "приключена"];
const statusCls: Record<string, string> = {
  нова: "bg-gray-500/15 text-gray-600",
  чернова: "bg-blue-500/15 text-blue-600",
  изпратена: "bg-indigo-500/15 text-indigo-600",
  чака: "bg-amber-500/15 text-amber-600",
  отговорено: "bg-green-500/15 text-green-600",
  приключена: "bg-gray-400/15 text-gray-500",
};

export default function PricingStatusPage() {
  const { data, isLoading, mutate } = useSWR<{ followups: Followup[] }>("/api/pricing/followups", fetcher, { revalidateOnFocus: false });
  const list = data?.followups ?? [];
  const { data: gstatus, mutate: mutateG } = useSWR<{ connected: boolean; email: string | null }>("/api/google/status", fetcher, { revalidateOnFocus: false });
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ client: "", client_email: "", subject: "", sent_date: todayISO() });
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get("google");
    if (!g) return;
    const msg: Record<string, string> = {
      connected: "✓ Google е свързан — офертите вече автоматично добавят напомняния в календара и Gmail чернова.",
      denied: "Свързването е отказано.",
      no_refresh: "Google не върна refresh token. Пробвай пак — в екрана за съгласие натисни „Разреши“ за всички права.",
      error: "Възникна грешка при свързването с Google. Пробвай пак.",
      missing_code: "Липсва код от Google. Пробвай пак.",
    };
    setFlash(msg[g] || null);
    mutateG();
    window.history.replaceState({}, "", window.location.pathname);
  }, [mutateG]);

  async function patch(id: number, fields: Record<string, unknown>) {
    await fetch("/api/pricing/followups", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) });
    mutate();
  }
  async function toggleTask(f: Followup, i: number) {
    const tasks = f.tasks.map((t, j) => (j === i ? { ...t, done: !t.done, done_at: !t.done ? todayISO() : null } : t));
    patch(f.id, { tasks });
  }
  async function addFollowup() {
    if (!nf.client) return;
    await fetch("/api/pricing/followups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nf) });
    setNf({ client: "", client_email: "", subject: "", sent_date: todayISO() });
    setAdding(false);
    mutate();
  }
  async function del(id: number) {
    if (!confirm("Изтриване на проследяването?")) return;
    await fetch(`/api/pricing/followups?id=${id}`, { method: "DELETE" });
    mutate();
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-border bg-surface text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40";

  return (
    <div>
      <PageHeader title={<><ListChecks size={22} className="text-accent" /> Оферти — статуси</>}>
        <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer">
          <Plus size={16} /> Нов запис
        </button>
      </PageHeader>
      <p className="text-[13px] text-text-3 mb-3">Проследяване на изпратени оферти: с кой клиент докъде сме и кои стъпки (обаждане/имейл) са свършени. Отмятай задачите, за да не се забравят.</p>

      {flash && <div className="mb-4 px-4 py-2.5 rounded-lg bg-accent-soft text-accent text-[13px]">{flash}</div>}

      <Card className="p-3 mb-5 flex items-center gap-3 flex-wrap">
        {gstatus?.connected ? (
          <span className="flex items-center gap-2 text-[13px] text-accent"><CheckCircle2 size={16} /> Google свързан{gstatus.email ? ` — ${gstatus.email}` : ""}. Напомнянията и черновите се създават автоматично.</span>
        ) : (
          <>
            <span className="text-[13px] text-text-2">За <b>автоматични</b> напомняния в календара + Gmail чернова свържи Google акаунта (препоръчително: cherbal.marketing@gmail.com).</span>
            <a href="/api/google/connect" className="ml-auto flex items-center gap-1.5 text-[13px] font-medium px-3 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer"><Link2 size={15} /> Свържи Google</a>
          </>
        )}
      </Card>

      {adding && (
        <Card className="p-4 mb-4 grid sm:grid-cols-4 gap-3">
          <input value={nf.client} onChange={(e) => setNf({ ...nf, client: e.target.value })} className={inputCls} placeholder="Клиент" />
          <input value={nf.client_email} onChange={(e) => setNf({ ...nf, client_email: e.target.value })} className={inputCls} placeholder="Имейл на клиента" />
          <input value={nf.subject} onChange={(e) => setNf({ ...nf, subject: e.target.value })} className={inputCls} placeholder="Оферта / продукти" />
          <div className="flex gap-2">
            <input type="date" value={nf.sent_date} onChange={(e) => setNf({ ...nf, sent_date: e.target.value })} className={inputCls} />
            <button onClick={addFollowup} disabled={!nf.client} className="px-3 py-2 rounded-lg bg-accent text-white text-[13px] disabled:opacity-50 cursor-pointer whitespace-nowrap">Добави</button>
          </div>
        </Card>
      )}

      {isLoading && <div className="flex items-center gap-2 text-text-3 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Зареждане…</div>}
      {!isLoading && list.length === 0 && <Card className="p-6 text-[14px] text-text-2">Още няма проследявания. Добави с <b>Нов запис</b> или ги стартирай от офертата.</Card>}

      <div className="space-y-3">
        {list.map((f) => (
          <Card key={f.id} className="p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
              <div>
                <div className="text-[14px] font-semibold text-text">{f.client || "—"}</div>
                <div className="text-[12px] text-text-3">{f.subject || ""}{f.client_email ? ` · ${f.client_email}` : ""}{f.sent_date ? ` · изпратена ${bg(f.sent_date)}` : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                <select value={f.status} onChange={(e) => patch(f.id, { status: e.target.value })} className={`text-[12px] px-2 py-1 rounded-md border-0 font-medium ${statusCls[f.status] || "bg-surface-2"}`}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => del(f.id)} className="text-text-3 hover:text-red-500"><Trash2 size={15} /></button>
              </div>
            </div>
            <div className="space-y-1.5">
              {(f.tasks ?? []).map((t, i) => {
                const overdue = !t.done && t.due < todayISO();
                return (
                  <div key={i} className="flex items-center gap-2 text-[13px]">
                    <button onClick={() => toggleTask(f, i)} className={`w-5 h-5 rounded flex items-center justify-center border ${t.done ? "bg-green-500 border-green-500 text-white" : "border-border"}`}>
                      {t.done && <Check size={13} />}
                    </button>
                    {t.kind === "call" ? <Phone size={13} className="text-text-3" /> : <Mail size={13} className="text-text-3" />}
                    <span className={t.done ? "line-through text-text-3" : overdue ? "text-red-600 font-medium" : "text-text"}>{t.label}</span>
                    <span className={`text-[11px] ml-auto ${overdue ? "text-red-600" : "text-text-3"}`}>{t.done ? `✓ ${bg(t.done_at)}` : bg(t.due)}</span>
                  </div>
                );
              })}
            </div>
            {f.note && <p className="text-[12px] text-text-3 mt-2">{f.note}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
