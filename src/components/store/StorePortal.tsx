"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Store, Plus, X, Loader2, Banknote, CreditCard, Search, Trash2, Save, Wallet, Tag, Pencil } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const todayISO = () => new Date().toISOString().slice(0, 10);
const m = (v: number | null | undefined) => (Number(v) || 0).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const hhmm = (s: string) => (s ? new Date(s).toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" }) : "");

interface StoreRow { id: number; name: string }
interface Product { item_id: number; sku: string | null; barcode: string | null; name: string }
interface Line { key: string; item_id: number | null; sku: string | null; name: string; qty: number; unit_price: string }
type Pay = "cash" | "card" | "unmarked";
interface Sale { id: number; items: { name: string; qty: number; unit_price: number; line_total: number }[]; payment: Pay; total: number; note: string | null; created_at: string; cashier_name: string | null }
const PAY_LABEL: Record<Pay, string> = { cash: "брой", card: "карта", unmarked: "НМ" };

const inputCls = "px-3 py-2 rounded-lg border border-border bg-surface text-[14px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40";
const lineTotal = (l: Line) => (Number(l.qty) || 0) * (parseFloat(String(l.unit_price).replace(",", ".")) || 0);

export function StorePortal() {
  const { data: storesData } = useSWR<{ stores: StoreRow[]; canAllStores: boolean; myStore: number | null }>("/api/store/stores", fetcher, { revalidateOnFocus: false });
  const stores = storesData?.stores ?? [];
  const [storeId, setStoreId] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());

  useEffect(() => {
    if (storeId == null && stores.length) setStoreId(storesData?.myStore ?? stores[0].id);
  }, [stores, storeId, storesData]);

  const salesKey = storeId ? `/api/store/sales?store=${storeId}&date=${date}` : null;
  const { data: salesData, mutate: mutateSales } = useSWR<{ sales: Sale[] }>(salesKey, fetcher, { revalidateOnFocus: false });
  const sales = salesData?.sales ?? [];
  const cashKey = storeId ? `/api/store/cash?store=${storeId}&date=${date}` : null;
  const { data: cashData, mutate: mutateCash } = useSWR<{ cash: { opening_float: number; counted_cash: number | null; note: string | null; closed_at: string | null } | null }>(cashKey, fetcher, { revalidateOnFocus: false });
  const closed = !!cashData?.cash?.closed_at;

  // --- нова продажба (кошница) ---
  const [lines, setLines] = useState<Line[]>([]);
  const [payment, setPayment] = useState<Pay>("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const { data: prodData } = useSWR<{ products: Product[] }>(q.trim() ? `/api/store/products?q=${encodeURIComponent(q.trim())}` : null, fetcher, { revalidateOnFocus: false });
  const results = prodData?.products ?? [];

  const cartTotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const addProduct = (p: Product) => {
    setLines((a) => [...a, { key: Math.random().toString(36).slice(2), item_id: p.item_id, sku: p.sku, name: p.name, qty: 1, unit_price: "" }]);
    setQ("");
  };
  const addManual = () => setLines((a) => [...a, { key: Math.random().toString(36).slice(2), item_id: null, sku: null, name: "", qty: 1, unit_price: "" }]);
  const updLine = (key: string, patch: Partial<Line>) => setLines((a) => a.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const rmLine = (key: string) => setLines((a) => a.filter((l) => l.key !== key));

  function resetForm() { setLines([]); setNote(""); setPayment("cash"); setEditId(null); }
  function startEdit(s: Sale) {
    setEditId(s.id);
    setLines(s.items.map((it) => ({ key: Math.random().toString(36).slice(2), item_id: null, sku: null, name: it.name, qty: it.qty, unit_price: String(it.unit_price) })));
    setPayment(s.payment);
    setNote(s.note || "");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function saveSale() {
    const valid = lines.filter((l) => l.name.trim() && lineTotal(l) >= 0);
    if (!valid.length || !storeId || saving || (closed && !editId)) return;
    setSaving(true);
    try {
      const items = valid.map((l) => ({ item_id: l.item_id, sku: l.sku, name: l.name.trim(), qty: Number(l.qty) || 0, unit_price: parseFloat(String(l.unit_price).replace(",", ".")) || 0, line_total: lineTotal(l) }));
      const total = items.reduce((s, it) => s + it.line_total, 0);
      if (editId) {
        await fetch("/api/store/sales", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editId, items, payment, total, note: note || null }) });
      } else {
        await fetch("/api/store/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store_id: storeId, sold_at: date, items, payment, total, note: note || null }) });
      }
      resetForm();
      mutateSales();
    } finally {
      setSaving(false);
    }
  }
  async function delSale(id: number) {
    if (!confirm("Изтриване на продажбата?")) return;
    await fetch(`/api/store/sales?id=${id}`, { method: "DELETE" });
    mutateSales();
  }

  const cashSales = sales.filter((s) => s.payment === "cash").reduce((s, x) => s + Number(x.total), 0);
  const cardSales = sales.filter((s) => s.payment === "card").reduce((s, x) => s + Number(x.total), 0);
  const nmSales = sales.filter((s) => s.payment === "unmarked").reduce((s, x) => s + Number(x.total), 0);
  const total = cashSales + cardSales + nmSales;

  // --- каса ---
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [cashNote, setCashNote] = useState("");
  const [savedCash, setSavedCash] = useState(false);
  useEffect(() => {
    setOpening(cashData?.cash?.opening_float != null ? String(cashData.cash.opening_float) : "");
    setCounted(cashData?.cash?.counted_cash != null ? String(cashData.cash.counted_cash) : "");
    setCashNote(cashData?.cash?.note ?? "");
  }, [cashData]);
  const openingN = parseFloat(opening.replace(",", ".")) || 0;
  const countedN = counted.trim() ? parseFloat(counted.replace(",", ".")) || 0 : null;
  const expected = openingN + cashSales + nmSales; // физическа каса = брой + НМ (ПОС не влиза)
  const diff = countedN != null ? countedN - expected : null;
  async function saveCash(closeFlag?: boolean) {
    if (!storeId) return;
    if (closeFlag === true && !confirm("Приключване на деня — продажбите се финализират. Сигурен ли си?")) return;
    const payload: Record<string, unknown> = { store_id: storeId, day: date, opening_float: opening, counted_cash: counted, note: cashNote };
    if (closeFlag !== undefined) payload.closed = closeFlag;
    await fetch("/api/store/cash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSavedCash(true);
    setTimeout(() => setSavedCash(false), 2000);
    mutateCash();
  }
  const shiftDate = (days: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  const payBtn = (val: Pay, label: string, Icon: typeof Banknote) => (
    <button onClick={() => setPayment(val)} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[13px] font-medium border cursor-pointer ${payment === val ? "bg-accent text-white border-accent" : "border-border text-text-2 hover:bg-surface-2"}`}>
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <div className="pb-10">
      <PageHeader title={<><Store size={22} className="text-accent" /> Магазин — продажби</>}>
        <div className="flex items-center gap-2 flex-wrap">
          {stores.length > 1 && (
            <select value={storeId ?? ""} onChange={(e) => setStoreId(Number(e.target.value))} className={inputCls + " py-1.5"}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button onClick={() => shiftDate(-1)} className="px-2 py-1.5 rounded-lg border border-border text-[13px] text-text-2 hover:bg-surface-2 cursor-pointer" title="Предходен ден">‹</button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + " py-1.5"} />
          <button onClick={() => shiftDate(1)} className="px-2 py-1.5 rounded-lg border border-border text-[13px] text-text-2 hover:bg-surface-2 cursor-pointer" title="Следващ ден">›</button>
          {date !== todayISO() && <button onClick={() => setDate(todayISO())} className="px-3 py-1.5 rounded-lg border border-accent text-accent text-[13px] hover:bg-accent-soft cursor-pointer">Днес</button>}
        </div>
      </PageHeader>

      {closed && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[13px] flex items-center justify-between flex-wrap gap-2">
          <span>🔒 Денят е приключен (финализиран). Нови продажби не могат да се добавят.</span>
          <button onClick={() => saveCash(false)} className="text-[12px] underline hover:no-underline cursor-pointer">Отвори отново</button>
        </div>
      )}

      {/* Овървю отгоре */}
      <Card className="p-4 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div><div className="text-[11px] text-text-3 flex items-center justify-center gap-1"><Banknote size={13} /> В брой</div><div className="text-[18px] font-bold tabular-nums">{m(cashSales)}</div></div>
          <div><div className="text-[11px] text-text-3 flex items-center justify-center gap-1"><CreditCard size={13} /> С карта</div><div className="text-[18px] font-bold tabular-nums">{m(cardSales)}</div></div>
          <div><div className="text-[11px] text-text-3 flex items-center justify-center gap-1"><Tag size={13} /> НМ</div><div className="text-[18px] font-bold tabular-nums">{m(nmSales)}</div></div>
          <div><div className="text-[11px] text-text-3">Общо ({sales.length})</div><div className="text-[18px] font-bold text-accent tabular-nums">{m(total)}</div></div>
        </div>
      </Card>

      {/* Нова продажба — цял екран */}
      <Card className="p-4 mb-5">
          <div className="text-[14px] font-semibold text-text mb-3">{editId ? "✏️ Редакция на продажба" : "Нова продажба"}</div>

          {closed && !editId ? (
            <div className="text-[13px] text-text-3 py-8 text-center">🔒 Денят е приключен. Натисни „Отвори отново“, за да добавяш продажби.</div>
          ) : (
          <>
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Търси продукт (име / SKU / баркод)…" className={inputCls + " w-full pl-9"} />
            {q.trim() && results.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-surface shadow-lg">
                {results.map((p) => (
                  <button key={p.item_id} onClick={() => addProduct(p)} className="block w-full text-left px-3 py-2 text-[13px] hover:bg-surface-2 border-b border-border last:border-0">
                    <span className="text-text">{p.name}</span>
                    {p.sku && <span className="text-text-3 text-[11px] ml-2">SKU {p.sku}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={addManual} className="flex items-center gap-1.5 text-[12px] text-accent mb-3 cursor-pointer"><Plus size={14} /> Добави ръчно (мъфин и др.)</button>

          {lines.length === 0 ? (
            <div className="text-[13px] text-text-3 py-4 text-center">Добави продукти в продажбата.</div>
          ) : (
            <div className="space-y-2 mb-3">
              {lines.map((l) => (
                <div key={l.key} className="flex items-center gap-2">
                  <input value={l.name} onChange={(e) => updLine(l.key, { name: e.target.value })} placeholder="продукт" className={inputCls + " flex-1 min-w-0 py-1.5"} />
                  <input type="number" min={0} step={1} value={l.qty} onChange={(e) => updLine(l.key, { qty: Number(e.target.value) })} className={inputCls + " w-14 py-1.5 text-center"} title="брой" />
                  <span className="text-text-3 text-[13px]">×</span>
                  <input value={l.unit_price} onChange={(e) => updLine(l.key, { unit_price: e.target.value.replace(/[^\d.,]/g, "") })} placeholder="цена" className={inputCls + " w-20 py-1.5 text-right"} title="единична цена" />
                  <span className="w-20 text-right text-[13px] font-semibold tabular-nums">{m(lineTotal(l))}</span>
                  <button onClick={() => rmLine(l.key)} className="text-text-3 hover:text-red-500"><X size={16} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between py-2 border-t border-border mb-3">
            <span className="text-[13px] text-text-3">Сума</span>
            <span className="text-[20px] font-bold text-accent tabular-nums">{m(cartTotal)}</span>
          </div>

          <div className="flex gap-2 mb-3">{payBtn("cash", "В брой", Banknote)}{payBtn("card", "С карта", CreditCard)}{payBtn("unmarked", "Немаркирани", Tag)}</div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="бележка (по избор)" className={inputCls + " w-full mb-3"} />
          <div className="flex gap-2">
            <button onClick={saveSale} disabled={saving || !lines.some((l) => l.name.trim())} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-accent text-white font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer">
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} {editId ? "Обнови продажбата" : "Запиши продажбата"}
            </button>
            {editId && <button onClick={resetForm} className="px-4 py-3 rounded-lg border border-border text-text-2 hover:bg-surface-2 font-medium cursor-pointer">Отказ</button>}
          </div>
          </>
          )}
      </Card>

      {/* Каса */}
      <Card className="p-4 mb-5">
            <div className="text-[14px] font-semibold text-text mb-3 flex items-center gap-2"><Wallet size={16} className="text-accent" /> Каса (край на деня)</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div><label className="block text-[11px] text-text-3 mb-1">Начално салдо</label><input value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0,00" className={inputCls + " w-full"} /></div>
              <div><label className="block text-[11px] text-text-3 mb-1">Преброено в касата</label><input value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0,00" className={inputCls + " w-full"} /></div>
            </div>
            <div className="text-[13px] space-y-1 mb-3">
              <div className="flex justify-between"><span className="text-text-3">+ Продажби в брой + НМ</span><span className="tabular-nums">{m(cashSales + nmSales)}</span></div>
              <div className="flex justify-between font-medium"><span>= Очаквано в касата</span><span className="tabular-nums">{m(expected)}</span></div>
              {diff != null && (
                <div className={`flex justify-between font-bold ${Math.abs(diff) < 0.005 ? "text-accent" : "text-red-500"}`}>
                  <span>Разлика (преброено − очаквано)</span><span className="tabular-nums">{diff > 0 ? "+" : ""}{m(diff)}</span>
                </div>
              )}
            </div>
            <input value={cashNote} onChange={(e) => setCashNote(e.target.value)} placeholder="бележка за касата (по избор)" className={inputCls + " w-full mb-3"} />
            <div className="flex gap-2">
              <button onClick={() => saveCash()} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border hover:bg-surface-2 font-medium cursor-pointer">
                {savedCash ? "✓ Запазено" : <><Save size={16} /> Запази</>}
              </button>
              {closed ? (
                <button onClick={() => saveCash(false)} className="flex-1 py-2.5 rounded-lg border border-amber-500 text-amber-600 hover:bg-amber-500/10 font-medium cursor-pointer">Отвори отново</button>
              ) : (
                <button onClick={() => saveCash(true)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white hover:opacity-90 font-medium cursor-pointer">🔒 Приключи деня</button>
              )}
            </div>
          </Card>

      {/* Продажби днес */}
      <Card className="p-4 mt-5">
        <div className="text-[14px] font-semibold text-text mb-3">Продажби ({sales.length})</div>
        {sales.length === 0 ? (
          <div className="text-[13px] text-text-3 py-4 text-center">Още няма продажби за този ден.</div>
        ) : (
          <div className="space-y-2">
            {sales.map((s) => (
              <div key={s.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                <span className={`mt-0.5 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${s.payment === "cash" ? "bg-green-500/15 text-green-600" : s.payment === "card" ? "bg-blue-500/15 text-blue-600" : "bg-amber-500/15 text-amber-600"}`}>
                  {s.payment === "cash" ? <Banknote size={12} /> : s.payment === "card" ? <CreditCard size={12} /> : <Tag size={12} />} {PAY_LABEL[s.payment]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-text truncate">{s.items.map((it) => `${it.name} ×${it.qty}`).join(", ")}</div>
                  <div className="text-[11px] text-text-3">{hhmm(s.created_at)}{s.note ? ` · ${s.note}` : ""}{s.cashier_name ? ` · ${s.cashier_name}` : ""}</div>
                </div>
                <span className="text-[14px] font-semibold tabular-nums whitespace-nowrap">{m(s.total)}</span>
                <button onClick={() => startEdit(s)} className="text-text-3 hover:text-accent mt-0.5" title="Редактирай"><Pencil size={15} /></button>
                <button onClick={() => delSale(s.id)} className="text-text-3 hover:text-red-500 mt-0.5" title="Изтрий"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
