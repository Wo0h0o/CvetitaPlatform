"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Wallet, Save, Plus, Trash2, Loader2 } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const thisMonth = () => new Date().toISOString().slice(0, 7);
const m = (v: number | null | undefined) => (Number(v) || 0).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const d2 = (s: string) => (s ? s.split("-").reverse().join(".") : "");

interface StoreRow { id: number; name: string }
interface Day { day: string; count: number; cash: number; pos: number; nm: number }
interface Expense { id: number; spent_at: string; doc_no: string | null; description: string | null; amount_store: number; amount_other: number }
interface Summary { salesCount: number; turnoverCash: number; turnoverPos: number; turnoverNm: number; openingNs: number; otherIncome: number; expensesStore: number; expensesOther: number; totalExpense: number; totalIncome: number; cashTotal: number; cashNoPos: number }
interface Kasa { days: Day[]; expenses: Expense[]; meta: { opening_ns: number; other_income: number; note: string }; summary: Summary }

const inputCls = "px-3 py-2 rounded-lg border border-border bg-surface text-[14px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40";
const numFilter = (v: string) => v.replace(/[^\d.,]/g, "");

export function KasaPortal() {
  const { data: storesData } = useSWR<{ stores: StoreRow[]; myStore: number | null }>("/api/store/stores", fetcher, { revalidateOnFocus: false });
  const stores = storesData?.stores ?? [];
  const [storeId, setStoreId] = useState<number | null>(null);
  const [month, setMonth] = useState(thisMonth());
  useEffect(() => { if (storeId == null && stores.length) setStoreId(storesData?.myStore ?? stores[0].id); }, [stores, storeId, storesData]);

  const key = storeId ? `/api/store/kasa?store=${storeId}&month=${month}` : null;
  const { data, mutate } = useSWR<Kasa>(key, fetcher, { revalidateOnFocus: false });
  const sum = data?.summary;

  const [ns, setNs] = useState("");
  const [other, setOther] = useState("");
  const [mnote, setMnote] = useState("");
  const [savedMeta, setSavedMeta] = useState(false);
  useEffect(() => {
    setNs(data?.meta?.opening_ns ? String(data.meta.opening_ns) : "");
    setOther(data?.meta?.other_income ? String(data.meta.other_income) : "");
    setMnote(data?.meta?.note ?? "");
  }, [data]);
  async function saveMeta() {
    if (!storeId) return;
    await fetch("/api/store/kasa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store_id: storeId, month, opening_ns: ns, other_income: other, note: mnote }) });
    setSavedMeta(true); setTimeout(() => setSavedMeta(false), 1800); mutate();
  }

  // нов разход
  const [ex, setEx] = useState({ spent_at: `${month}-01`, doc_no: "", description: "", amount_store: "", amount_other: "" });
  const [adding, setAdding] = useState(false);
  useEffect(() => { setEx((e) => ({ ...e, spent_at: `${month}-01` })); }, [month]);
  async function addExpense() {
    if (!storeId || adding) return;
    if (!ex.description.trim() && !ex.amount_store && !ex.amount_other) return;
    setAdding(true);
    try {
      await fetch("/api/store/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store_id: storeId, ...ex, amount_store: ex.amount_store.replace(",", "."), amount_other: ex.amount_other.replace(",", ".") }) });
      setEx({ spent_at: `${month}-01`, doc_no: "", description: "", amount_store: "", amount_other: "" });
      mutate();
    } finally { setAdding(false); }
  }
  async function delExpense(id: number) {
    if (!confirm("Изтриване на разхода?")) return;
    await fetch(`/api/store/expenses?id=${id}`, { method: "DELETE" });
    mutate();
  }

  const sumRow = (label: string, val: number, strong?: boolean, tone?: "accent" | "red") => (
    <div className={`flex justify-between ${strong ? "font-bold" : ""} ${tone === "accent" ? "text-accent" : tone === "red" ? "text-red-500" : ""}`}>
      <span className={strong ? "" : "text-text-3"}>{label}</span><span className="tabular-nums">{m(val)}</span>
    </div>
  );

  return (
    <div className="pb-10">
      <PageHeader title={<><Wallet size={22} className="text-accent" /> Каса — месечен отчет</>}>
        <div className="flex items-center gap-2 flex-wrap">
          {stores.length > 1 && (
            <select value={storeId ?? ""} onChange={(e) => setStoreId(Number(e.target.value))} className={inputCls + " py-1.5"}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls + " py-1.5"} />
        </div>
      </PageHeader>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Приход (дневно) */}
        <Card className="p-4 lg:col-span-2 overflow-hidden">
          <div className="text-[14px] font-semibold text-text mb-3">Приход по дни (от продажбите)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[460px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-text-3">
                  <th className="text-left font-medium px-2 py-2">Дата</th>
                  <th className="text-right font-medium px-2 py-2">Бр. продажби</th>
                  <th className="text-right font-medium px-2 py-2">Оборот</th>
                  <th className="text-right font-medium px-2 py-2">ПОС</th>
                  <th className="text-right font-medium px-2 py-2">НМ</th>
                </tr>
              </thead>
              <tbody>
                {(data?.days ?? []).length === 0 && <tr><td colSpan={5} className="text-[13px] text-text-3 py-4 text-center">Няма продажби за този месец.</td></tr>}
                {(data?.days ?? []).map((r) => (
                  <tr key={r.day} className="border-t border-border">
                    <td className="px-2 py-1.5">{d2(r.day)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.count}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{m(r.cash)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{m(r.pos)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{m(r.nm)}</td>
                  </tr>
                ))}
              </tbody>
              {sum && (
                <tfoot>
                  <tr className="border-t-2 border-border font-bold">
                    <td className="px-2 py-2">Общо</td>
                    <td className="px-2 py-2 text-right tabular-nums">{sum.salesCount}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m(sum.turnoverCash)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m(sum.turnoverPos)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{m(sum.turnoverNm)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        {/* Резюме */}
        <Card className="p-4">
          <div className="text-[14px] font-semibold text-text mb-3">Резюме на месеца</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label className="block text-[11px] text-text-3 mb-1">НС (начално салдо)</label><input value={ns} onChange={(e) => setNs(numFilter(e.target.value))} placeholder="0,00" className={inputCls + " w-full"} /></div>
            <div><label className="block text-[11px] text-text-3 mb-1">Други (приход)</label><input value={other} onChange={(e) => setOther(numFilter(e.target.value))} placeholder="0,00" className={inputCls + " w-full"} /></div>
          </div>
          {sum && (
            <div className="text-[13px] space-y-1 mb-3">
              {sumRow("НС", sum.openingNs)}
              {sumRow("Оборот магазин (брой)", sum.turnoverCash)}
              {sumRow("НМ", sum.turnoverNm)}
              {sumRow("ПОС", sum.turnoverPos)}
              {sumRow("Други", sum.otherIncome)}
              <div className="border-t border-border my-1" />
              {sumRow("Общо приход", sum.totalIncome, true)}
              {sumRow("Общо разход", sum.totalExpense, true, "red")}
              <div className="border-t border-border my-1" />
              {sumRow("Общо пари (брой+ПОС+НМ)", sum.cashTotal, true)}
              {sumRow("В брой без ПОС", sum.cashNoPos, true, "accent")}
              <div className="text-[11px] text-text-3 pt-1">„В брой без ПОС“ става НС за следващия месец.</div>
            </div>
          )}
          <input value={mnote} onChange={(e) => setMnote(e.target.value)} placeholder="бележка за месеца" className={inputCls + " w-full mb-3"} />
          <button onClick={saveMeta} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border hover:bg-surface-2 font-medium cursor-pointer">
            {savedMeta ? "✓ Запазено" : <><Save size={16} /> Запази НС / други / бележка</>}
          </button>
        </Card>
      </div>

      {/* Разходи */}
      <Card className="p-4 mt-5">
        <div className="text-[14px] font-semibold text-text mb-3">Разходи</div>
        <div className="grid sm:grid-cols-6 gap-2 mb-3">
          <input type="date" value={ex.spent_at} onChange={(e) => setEx({ ...ex, spent_at: e.target.value })} className={inputCls} />
          <input value={ex.doc_no} onChange={(e) => setEx({ ...ex, doc_no: e.target.value })} placeholder="№ документ" className={inputCls} />
          <input value={ex.description} onChange={(e) => setEx({ ...ex, description: e.target.value })} placeholder="описание" className={inputCls + " sm:col-span-2"} />
          <input value={ex.amount_store} onChange={(e) => setEx({ ...ex, amount_store: numFilter(e.target.value) })} placeholder="разход магазин" className={inputCls} />
          <div className="flex gap-2">
            <input value={ex.amount_other} onChange={(e) => setEx({ ...ex, amount_other: numFilter(e.target.value) })} placeholder="други" className={inputCls + " w-full"} />
            <button onClick={addExpense} disabled={adding} className="px-3 rounded-lg bg-accent text-white cursor-pointer disabled:opacity-50" title="Добави">{adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[560px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-3">
                <th className="text-left font-medium px-2 py-2">Дата</th>
                <th className="text-left font-medium px-2 py-2">№ документ</th>
                <th className="text-left font-medium px-2 py-2">Описание</th>
                <th className="text-right font-medium px-2 py-2">Разход магазин</th>
                <th className="text-right font-medium px-2 py-2">Други</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data?.expenses ?? []).length === 0 && <tr><td colSpan={6} className="text-[13px] text-text-3 py-4 text-center">Няма разходи за този месец.</td></tr>}
              {(data?.expenses ?? []).map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-2 py-1.5 whitespace-nowrap">{d2(e.spent_at)}</td>
                  <td className="px-2 py-1.5">{e.doc_no || "—"}</td>
                  <td className="px-2 py-1.5">{e.description || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.amount_store ? m(e.amount_store) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.amount_other ? m(e.amount_other) : "—"}</td>
                  <td className="px-2 py-1.5 text-right"><button onClick={() => delExpense(e.id)} className="text-text-3 hover:text-red-500"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
            {sum && (data?.expenses ?? []).length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-bold">
                  <td className="px-2 py-2" colSpan={3}>Общо разход</td>
                  <td className="px-2 py-2 text-right tabular-nums">{m(sum.expensesStore)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{m(sum.expensesOther)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
