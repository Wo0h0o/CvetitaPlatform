"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Boxes, Plus, X, Loader2, Search, Download, ClipboardCheck, Save, Trash2 } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const dt = (s: string) => (s ? new Date(s).toLocaleDateString("bg-BG") : "");

interface StoreRow { id: number; name: string }
interface Product { item_id: number; sku: string | null; name: string }
interface Stock { item_id: number | null; sku: string | null; name: string; match_key: string; loaded: number; sold: number; expected: number }
interface LoadRow { key: string; item_id: number | null; sku: string | null; name: string; qty: number }
interface Rev { id: number; revised_at: string; created_at: string; created_name: string | null; items: { name: string; expected: number; counted: number; diff: number }[]; note: string | null }

const inputCls = "px-3 py-2 rounded-lg border border-border bg-surface text-[14px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40";

export function InventoryPortal() {
  const { data: storesData } = useSWR<{ stores: StoreRow[]; myStore: number | null; canAllStores: boolean }>("/api/store/stores", fetcher, { revalidateOnFocus: false });
  const stores = storesData?.stores ?? [];
  const canAll = storesData?.canAllStores;
  const [storeId, setStoreId] = useState<number | null>(null);
  useEffect(() => { if (storeId == null && stores.length) setStoreId(storesData?.myStore ?? stores[0].id); }, [stores, storeId, storesData]);

  const { data: stockData, mutate: mutateStock } = useSWR<{ stock: Stock[] }>(storeId ? `/api/store/stock?store=${storeId}` : null, fetcher, { revalidateOnFocus: false });
  const stock = stockData?.stock ?? [];
  const { data: revData, mutate: mutateRev } = useSWR<{ revisions: Rev[] }>(storeId ? `/api/store/revision?store=${storeId}` : null, fetcher, { revalidateOnFocus: false });
  const revisions = revData?.revisions ?? [];

  // --- зареждане ---
  const [soNum, setSoNum] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  async function importSo() {
    if (!storeId || !soNum.trim() || importing) return;
    setImporting(true); setImportMsg("");
    try {
      const r = await fetch("/api/store/stock/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store_id: storeId, so_num: soNum.trim() }) }).then((x) => x.json());
      setImportMsg(r.error ? `Грешка: ${r.error}` : `✓ Заредени ${r.items} продукта от ${r.so} (${r.date}).`);
      if (!r.error) { setSoNum(""); mutateStock(); }
    } finally { setImporting(false); }
  }

  const [loadRows, setLoadRows] = useState<LoadRow[]>([]);
  const [q, setQ] = useState("");
  const { data: prodData } = useSWR<{ products: Product[] }>(q.trim() ? `/api/store/products?q=${encodeURIComponent(q.trim())}` : null, fetcher, { revalidateOnFocus: false });
  const results = prodData?.products ?? [];
  const [savingLoad, setSavingLoad] = useState(false);
  const addProd = (p: Product) => { setLoadRows((a) => [...a, { key: Math.random().toString(36).slice(2), item_id: p.item_id, sku: p.sku, name: p.name, qty: 1 }]); setQ(""); };
  const addManual = () => setLoadRows((a) => [...a, { key: Math.random().toString(36).slice(2), item_id: null, sku: null, name: "", qty: 1 }]);
  async function saveLoad() {
    const valid = loadRows.filter((r) => r.name.trim() && Number(r.qty) > 0);
    if (!valid.length || !storeId || savingLoad) return;
    setSavingLoad(true);
    try {
      await fetch("/api/store/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store_id: storeId, items: valid.map((r) => ({ item_id: r.item_id, sku: r.sku, name: r.name.trim(), qty: Number(r.qty) })) }) });
      setLoadRows([]); mutateStock();
    } finally { setSavingLoad(false); }
  }

  // --- ревизия ---
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [savingRev, setSavingRev] = useState(false);
  const [revNote, setRevNote] = useState("");
  async function saveRevision() {
    const items = stock.filter((s) => counts[s.match_key] !== undefined && counts[s.match_key] !== "").map((s) => ({ match_key: s.match_key, item_id: s.item_id, sku: s.sku, name: s.name, counted: Number(counts[s.match_key].replace(",", ".")) || 0 }));
    if (!items.length || !storeId || savingRev) return;
    if (!confirm(`Записване на ревизия за ${items.length} продукта? Наличността ще се изравни с преброеното.`)) return;
    setSavingRev(true);
    try {
      await fetch("/api/store/revision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store_id: storeId, items, note: revNote || null }) });
      setCounts({}); setRevNote(""); mutateStock(); mutateRev();
    } finally { setSavingRev(false); }
  }
  async function delRow(key: string) {
    if (!storeId || !confirm("Премахване на продукта от наличностите?")) return;
    await fetch(`/api/store/stock?store=${storeId}&key=${encodeURIComponent(key)}`, { method: "DELETE" });
    mutateStock();
  }
  const countedN = (k: string) => (counts[k] !== undefined && counts[k] !== "" ? Number(counts[k].replace(",", ".")) || 0 : null);
  const filledCount = Object.values(counts).filter((v) => v !== "").length;

  return (
    <div className="pb-10">
      <PageHeader title={<><Boxes size={22} className="text-accent" /> Наличности и ревизия</>}>
        {stores.length > 1 && (
          <select value={storeId ?? ""} onChange={(e) => setStoreId(Number(e.target.value))} className={inputCls + " py-1.5"}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </PageHeader>

      {/* Зареждане */}
      <Card className="p-4 mb-5">
        <div className="text-[14px] font-semibold text-text mb-3 flex items-center gap-2"><Download size={16} className="text-accent" /> Зареждане на магазина</div>
        {canAll && (
          <div className="flex items-end gap-2 flex-wrap mb-3 pb-3 border-b border-border">
            <div><label className="block text-[11px] text-text-3 mb-1">Импорт от PRIM продажба (№)</label><input value={soNum} onChange={(e) => setSoNum(e.target.value)} placeholder="напр. SO00003788" className={inputCls + " w-48"} /></div>
            <button onClick={importSo} disabled={importing} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer">
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Импортирай
            </button>
            {importMsg && <span className={`text-[12px] ${importMsg.startsWith("Грешка") ? "text-red-500" : "text-accent"}`}>{importMsg}</span>}
          </div>
        )}
        <div className="relative mb-2 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Добави продукт за зареждане…" className={inputCls + " w-full pl-9"} />
          {q.trim() && results.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-surface shadow-lg">
              {results.map((p) => <button key={p.item_id} onClick={() => addProd(p)} className="block w-full text-left px-3 py-2 text-[13px] hover:bg-surface-2 border-b border-border last:border-0">{p.name}{p.sku ? <span className="text-text-3 text-[11px] ml-2">SKU {p.sku}</span> : null}</button>)}
            </div>
          )}
        </div>
        <button onClick={addManual} className="flex items-center gap-1.5 text-[12px] text-accent mb-2 cursor-pointer"><Plus size={14} /> Добави ръчно</button>
        {loadRows.length > 0 && (
          <>
            <div className="space-y-2 mb-3">
              {loadRows.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <input value={r.name} onChange={(e) => setLoadRows((a) => a.map((x) => x.key === r.key ? { ...x, name: e.target.value } : x))} placeholder="продукт" className={inputCls + " flex-1 py-1.5"} />
                  <input type="number" min={0} value={r.qty} onChange={(e) => setLoadRows((a) => a.map((x) => x.key === r.key ? { ...x, qty: Number(e.target.value) } : x))} className={inputCls + " w-20 py-1.5 text-right"} />
                  <button onClick={() => setLoadRows((a) => a.filter((x) => x.key !== r.key))} className="text-text-3 hover:text-red-500"><X size={16} /></button>
                </div>
              ))}
            </div>
            <button onClick={saveLoad} disabled={savingLoad} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer">
              {savingLoad ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Зареди в наличността
            </button>
          </>
        )}
      </Card>

      {/* Наличности + ревизия */}
      <Card className="p-4 mb-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="text-[14px] font-semibold text-text flex items-center gap-2"><ClipboardCheck size={16} className="text-accent" /> Наличности и ревизия ({stock.length})</div>
          {filledCount > 0 && (
            <div className="flex items-center gap-2">
              <input value={revNote} onChange={(e) => setRevNote(e.target.value)} placeholder="бележка за ревизията" className={inputCls + " py-1.5 w-44"} />
              <button onClick={saveRevision} disabled={savingRev} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer">
                {savingRev ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Запази ревизия ({filledCount})
              </button>
            </div>
          )}
        </div>
        <p className="text-[12px] text-text-3 mb-3">Впиши „Преброено“ за продуктите, които броиш — системата смята разликата спрямо очакваното и при запис изравнява наличността.</p>
        {stock.length === 0 ? (
          <div className="text-[13px] text-text-3 py-6 text-center">Няма наличности. Зареди магазина отгоре (импорт от PRIM продажба или ръчно).</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[640px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-text-3">
                  <th className="text-left font-medium px-2 py-2">Продукт</th>
                  <th className="text-right font-medium px-2 py-2">Заредено</th>
                  <th className="text-right font-medium px-2 py-2">Продадено</th>
                  <th className="text-right font-medium px-2 py-2">Очаквано</th>
                  <th className="text-right font-medium px-2 py-2">Преброено</th>
                  <th className="text-right font-medium px-2 py-2">Разлика</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s) => {
                  const cn = countedN(s.match_key);
                  const diff = cn != null ? cn - s.expected : null;
                  return (
                    <tr key={s.match_key} className="border-t border-border">
                      <td className="px-2 py-1.5">{s.name}</td>
                      <td className="px-2 py-1.5 text-right text-text-3 tabular-nums">{s.loaded}</td>
                      <td className="px-2 py-1.5 text-right text-text-3 tabular-nums">{s.sold || "—"}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{s.expected}</td>
                      <td className="px-2 py-1.5 text-right"><input value={counts[s.match_key] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [s.match_key]: e.target.value.replace(/[^\d.,]/g, "") }))} className={inputCls + " w-20 py-1 text-right"} placeholder="—" /></td>
                      <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${diff == null ? "text-text-3" : diff === 0 ? "text-accent" : "text-red-500"}`}>{diff == null ? "—" : diff > 0 ? `+${diff}` : diff}</td>
                      <td className="px-2 py-1.5 text-right"><button onClick={() => delRow(s.match_key)} className="text-text-3 hover:text-red-500" title="Премахни"><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Минали ревизии */}
      <Card className="p-4">
        <div className="text-[14px] font-semibold text-text mb-3">Минали ревизии</div>
        {revisions.length === 0 ? (
          <div className="text-[13px] text-text-3 py-4 text-center">Още няма ревизии.</div>
        ) : (
          <div className="space-y-2">
            {revisions.map((r) => {
              const discrepancies = r.items.filter((i) => i.diff !== 0);
              return (
                <details key={r.id} className="border-b border-border last:border-0 pb-2">
                  <summary className="cursor-pointer text-[13px] py-1 flex items-center gap-2 flex-wrap">
                    <span className="font-medium">Ревизия {dt(r.created_at)}</span>
                    <span className="text-text-3">· {r.items.length} продукта · {discrepancies.length} разлики{r.created_name ? ` · ${r.created_name}` : ""}</span>
                  </summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-[12px] min-w-[420px]">
                      <thead><tr className="text-text-3"><th className="text-left px-2 py-1">Продукт</th><th className="text-right px-2 py-1">Очаквано</th><th className="text-right px-2 py-1">Преброено</th><th className="text-right px-2 py-1">Разлика</th></tr></thead>
                      <tbody>
                        {r.items.map((i, idx) => (
                          <tr key={idx} className="border-t border-border">
                            <td className="px-2 py-1">{i.name}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{i.expected}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{i.counted}</td>
                            <td className={`px-2 py-1 text-right tabular-nums font-medium ${i.diff === 0 ? "text-text-3" : "text-red-500"}`}>{i.diff > 0 ? `+${i.diff}` : i.diff}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {r.note && <p className="text-[12px] text-text-3 mt-1">{r.note}</p>}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
