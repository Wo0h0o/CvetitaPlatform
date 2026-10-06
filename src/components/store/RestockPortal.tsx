"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { PackagePlus, Plus, X, Loader2, Calculator, FileText, Trash2, Send, Check } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayISO = () => iso(new Date());
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const d2 = (s: string | null) => (s ? s.split("-").reverse().join(".") : "—");

interface StoreRow { id: number; name: string }
interface Item { key: string; item_id: number | null; sku: string | null; name: string; qty_sold: number; qty: number }
interface Req { id: number; store_id: number; period_from: string | null; period_to: string | null; items: { name: string; qty: number }[]; status: string; created_at: string; created_name: string | null }

const inputCls = "px-3 py-2 rounded-lg border border-border bg-surface text-[14px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40";
const STATUS: Record<string, { t: string; c: string }> = {
  new: { t: "нова", c: "bg-amber-500/15 text-amber-600" },
  sent: { t: "изпратена", c: "bg-blue-500/15 text-blue-600" },
  done: { t: "заредена", c: "bg-green-500/15 text-green-600" },
};

export function RestockPortal() {
  const { data: storesData } = useSWR<{ stores: StoreRow[]; myStore: number | null }>("/api/store/stores", fetcher, { revalidateOnFocus: false });
  const stores = storesData?.stores ?? [];
  const [storeId, setStoreId] = useState<number | null>(null);
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  useEffect(() => { if (storeId == null && stores.length) setStoreId(storesData?.myStore ?? stores[0].id); }, [stores, storeId, storesData]);

  const { data: listData, mutate: mutateList } = useSWR<{ requests: Req[] }>(storeId ? `/api/store/restock?store=${storeId}` : null, fetcher, { revalidateOnFocus: false });
  const requests = listData?.requests ?? [];

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

  async function compute() {
    if (!storeId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/store/restock/suggest?store=${storeId}&from=${from}&to=${to}`).then((x) => x.json());
      setItems((r.items ?? []).map((it: { item_id: number | null; sku: string | null; name: string; qty_sold: number }) => ({ key: Math.random().toString(36).slice(2), item_id: it.item_id, sku: it.sku, name: it.name, qty_sold: it.qty_sold, qty: it.qty_sold })));
    } finally { setLoading(false); }
  }
  const addManual = () => setItems((a) => [...a, { key: Math.random().toString(36).slice(2), item_id: null, sku: null, name: "", qty_sold: 0, qty: 1 }]);
  const upd = (key: string, patch: Partial<Item>) => setItems((a) => a.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const rm = (key: string) => setItems((a) => a.filter((it) => it.key !== key));

  async function createRequest() {
    const valid = items.filter((it) => it.name.trim() && (Number(it.qty) || 0) > 0);
    if (!valid.length || !storeId || creating) return;
    setCreating(true);
    try {
      const payloadItems = valid.map((it) => ({ item_id: it.item_id, sku: it.sku, name: it.name.trim(), qty_sold: it.qty_sold, qty: Number(it.qty) || 0 }));
      await fetch("/api/store/restock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store_id: storeId, period_from: from, period_to: to, items: payloadItems, note: note || null }) });
      setItems([]); setNote("");
      mutateList();
    } finally { setCreating(false); }
  }
  async function setStatus(id: number, status: string) {
    await fetch("/api/store/restock", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    mutateList();
  }
  async function del(id: number) {
    if (!confirm("Изтриване на заявката?")) return;
    await fetch(`/api/store/restock?id=${id}`, { method: "DELETE" });
    mutateList();
  }

  return (
    <div className="pb-10">
      <PageHeader title={<><PackagePlus size={22} className="text-accent" /> Дозареждане на магазин</>}>
        {stores.length > 1 && (
          <select value={storeId ?? ""} onChange={(e) => setStoreId(Number(e.target.value))} className={inputCls + " py-1.5"}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </PageHeader>

      {/* Период */}
      <Card className="p-4 mb-5">
        <div className="text-[14px] font-semibold text-text mb-3">1. Избери период на продажбите</div>
        <div className="flex items-end gap-3 flex-wrap">
          <div><label className="block text-[11px] text-text-3 mb-1">От</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></div>
          <div><label className="block text-[11px] text-text-3 mb-1">До</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></div>
          <button onClick={compute} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />} Изчисли продаденото
          </button>
        </div>
      </Card>

      {/* Продадено → заявка */}
      {(items.length > 0 || loading) && (
        <Card className="p-4 mb-5">
          <div className="text-[14px] font-semibold text-text mb-3">2. Количества за зареждане</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[520px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-text-3">
                  <th className="text-left font-medium px-2 py-2">Продукт</th>
                  <th className="text-right font-medium px-2 py-2">Продадено</th>
                  <th className="text-right font-medium px-2 py-2">За зареждане</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.key} className="border-t border-border">
                    <td className="px-2 py-1.5"><input value={it.name} onChange={(e) => upd(it.key, { name: e.target.value })} placeholder="продукт" className={inputCls + " w-full py-1.5"} /></td>
                    <td className="px-2 py-1.5 text-right text-text-3 tabular-nums">{it.qty_sold || "—"}</td>
                    <td className="px-2 py-1.5 text-right"><input type="number" min={0} value={it.qty} onChange={(e) => upd(it.key, { qty: Number(e.target.value) })} className={inputCls + " w-20 py-1.5 text-right"} /></td>
                    <td className="px-2 py-1.5"><button onClick={() => rm(it.key)} className="text-text-3 hover:text-red-500"><X size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addManual} className="flex items-center gap-1.5 text-[12px] text-accent mt-2 cursor-pointer"><Plus size={14} /> Добави ред ръчно</button>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="бележка (по избор)" className={inputCls + " w-full mt-3 mb-3"} />
          <button onClick={createRequest} disabled={creating || !items.some((it) => it.name.trim() && it.qty > 0)} className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-accent text-white font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer">
            {creating ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} Създай заявка за зареждане
          </button>
        </Card>
      )}

      {/* Минали заявки */}
      <Card className="p-4">
        <div className="text-[14px] font-semibold text-text mb-3">Заявки за дозареждане</div>
        {requests.length === 0 ? (
          <div className="text-[13px] text-text-3 py-4 text-center">Още няма заявки.</div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0 flex-wrap">
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS[r.status]?.c ?? ""}`}>{STATUS[r.status]?.t ?? r.status}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-text">Заявка #{r.id} · {r.items.length} продукта · {r.items.reduce((s, it) => s + (Number(it.qty) || 0), 0)} бр.</div>
                  <div className="text-[11px] text-text-3">период {d2(r.period_from)} – {d2(r.period_to)} · {new Date(r.created_at).toLocaleDateString("bg-BG")}{r.created_name ? ` · ${r.created_name}` : ""}</div>
                </div>
                <Link href={`/store/restock/doc?id=${r.id}`} className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"><FileText size={14} /> Отвори / Печат</Link>
                {r.status === "new" && <button onClick={() => setStatus(r.id, "sent")} className="inline-flex items-center gap-1 text-[12px] text-blue-600 hover:underline"><Send size={13} /> изпратена</button>}
                {r.status !== "done" && <button onClick={() => setStatus(r.id, "done")} className="inline-flex items-center gap-1 text-[12px] text-green-600 hover:underline"><Check size={13} /> заредена</button>}
                <button onClick={() => del(r.id)} className="text-text-3 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
