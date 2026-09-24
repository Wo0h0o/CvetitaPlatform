"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft, Plus, X, Save, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/shared/Card";
import {
  pricePerTablet,
  pricePerPack,
  opPerPack,
  computeTotals,
  eur,
  type PlIngredient,
  type PlOperation,
} from "@/lib/pricing";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Material { item_id: number; sku: string; name: string; unit: string; price_eur: number | null; price_updated: string | null }
interface OpRef { id: number; name: string; unit_price: number; kind: "per_unit" | "per_pack"; is_input: boolean; is_labor: boolean; sort: number }
interface Capsule { item_id: number; name: string; price_eur: number | null }
interface Refs { materials: Material[]; operations: OpRef[]; capsules: Capsule[] }

const MARKUPS = [
  { v: 1, label: "×1 (доставна)" },
  { v: 1.2, label: "×1,2" },
  { v: 2, label: "×2" },
];
const inputCls = "w-full px-3 py-2 rounded-lg border border-border bg-surface text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40";
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium uppercase tracking-wider text-text-3 mb-1">{children}</label>;
}

function OfferInner() {
  const params = useSearchParams();
  const router = useRouter();
  const editId = params.get("id");
  const { data: refs, mutate: mutateRefs } = useSWR<Refs>("/api/pricing/refs", fetcher, { revalidateOnFocus: false });

  const [productName, setProductName] = useState("");
  const [client, setClient] = useState("");
  const [tabsPerPack, setTabsPerPack] = useState<string>("");
  const [ingredients, setIngredients] = useState<PlIngredient[]>([]);
  const [operations, setOperations] = useState<PlOperation[]>([]);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");
  const [opsInit, setOpsInit] = useState(false);

  // операции по подразбиране (щом заредят refs), ако не редактираме запазена оферта
  useEffect(() => {
    if (!refs || opsInit || editId) return;
    setOperations(refs.operations.map((o) => ({ name: o.name, unit_price: o.unit_price, kind: o.kind, is_input: o.is_input, is_labor: o.is_labor })));
    setOpsInit(true);
  }, [refs, opsInit, editId]);

  // зареди запазена оферта
  useEffect(() => {
    if (!editId) return;
    fetch(`/api/pricing/offers?id=${editId}`).then((r) => r.json()).then(({ offer: o }) => {
      if (!o) return;
      setProductName(o.product_name || "");
      setClient(o.client || "");
      setTabsPerPack(o.tabs_per_pack != null ? String(o.tabs_per_pack) : "");
      setIngredients(o.ingredients || []);
      setOperations(o.operations || []);
      setSavedId(o.id);
      setOpsInit(true);
    });
  }, [editId]);

  const totals = useMemo(() => computeTotals(ingredients, operations, tabsPerPack), [ingredients, operations, tabsPerPack]);

  function addIngredient() {
    setIngredients((a) => [...a, { item_id: undefined, name: "", price_eur: 0, markup: 1, mg_per_tablet: "" }]);
  }
  function updateIng(idx: number, patch: Partial<PlIngredient>) {
    setIngredients((a) => a.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  // Име на суровина: съвпадне ли с PRIM суровина → взима item_id + доставната цена;
  // иначе е ръчна суровина (пишеш име и цена сам).
  function setIngredientName(idx: number, name: string) {
    const key = name.toLowerCase().replace(/\s+/g, " ").trim();
    const m = refs?.materials.find((x) => x.name.toLowerCase().replace(/\s+/g, " ").trim() === key);
    setIngredients((a) =>
      a.map((it, i) => {
        if (i !== idx) return it;
        if (m) return { ...it, name: m.name, item_id: m.item_id, price_eur: m.price_eur != null ? m.price_eur : it.price_eur || "" };
        return { ...it, name, item_id: undefined };
      })
    );
  }
  function updateOp(idx: number, unit_price: string) {
    setOperations((a) => a.map((op, i) => (i === idx ? { ...op, unit_price } : op)));
  }
  function setOpCapsule(idx: number, itemId: string) {
    const c = refs?.capsules.find((x) => String(x.item_id) === itemId);
    setOperations((a) => a.map((op, i) => (i === idx ? { ...op, capsule: c ? c.name : "", unit_price: c && c.price_eur != null ? c.price_eur : op.unit_price } : op)));
  }

  async function syncPrices() {
    setSyncing(true);
    setNote("");
    try {
      const r = await fetch("/api/pricing/sync", { method: "POST" }).then((x) => x.json());
      const fresh = await mutateRefs();
      // опресни цените на вече избраните съставки от новите данни
      if (fresh?.materials) {
        const byId = new Map(fresh.materials.map((m) => [String(m.item_id), m.price_eur]));
        setIngredients((a) => a.map((ing) => (ing.item_id && byId.has(String(ing.item_id)) ? { ...ing, price_eur: byId.get(String(ing.item_id)) ?? ing.price_eur } : ing)));
      }
      setNote(r.materials ? `Обновени ${r.materials} суровини (${r.priced} с цена).` : r.error || "Обновено.");
    } catch {
      setNote("Грешка при синк.");
    } finally {
      setSyncing(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        product_name: productName,
        client: client || null,
        tabs_per_pack: tabsPerPack ? Number(tabsPerPack) : null,
        ingredients,
        operations,
        total_raw: totals.totalRaw,
        total_ops: totals.totalOps,
        total: totals.total,
      };
      let res;
      if (savedId) res = await fetch("/api/pricing/offers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: savedId, ...payload }) });
      else res = await fetch("/api/pricing/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const { offer } = await res.json();
      if (offer?.id) {
        setSavedId(offer.id);
        if (!editId) router.replace(`/pricing/offer?id=${offer.id}`);
      }
    } finally {
      setSaving(false);
    }
  }

  const tpp = tabsPerPack;

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <Link href="/pricing" className="text-text-3 hover:text-text"><ArrowLeft size={20} /></Link>
        <h1 className="text-[20px] font-bold text-text">{savedId ? "Оферта" : "Нова оферта"}</h1>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={syncPrices} disabled={syncing} className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-lg border border-border hover:bg-surface-2 cursor-pointer disabled:opacity-50">
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Синк цени от PRIM
          </button>
          <button onClick={save} disabled={saving || !productName} className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-50 cursor-pointer">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Запази
          </button>
        </div>
      </div>
      {note && <div className="text-[12px] text-text-2 bg-surface-2 rounded-lg px-3 py-2 mb-4">{note}</div>}

      {/* Основни */}
      <Card className="p-4 mb-4 grid sm:grid-cols-3 gap-3">
        <div><Label>Продукт</Label><input value={productName} onChange={(e) => setProductName(e.target.value)} className={inputCls} placeholder="напр. Продукт за сън 60 капс" /></div>
        <div><Label>Клиент (по избор)</Label><input value={client} onChange={(e) => setClient(e.target.value)} className={inputCls} placeholder="напр. Сапфир Нутришън" /></div>
        <div><Label>Брой в опаковка (табл/капс)</Label><input value={tabsPerPack} onChange={(e) => setTabsPerPack(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} placeholder="напр. 60" /></div>
      </Card>

      {/* Модул 1 — Съставки */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold text-text">Модул 1 · Съставки</span>
          <button onClick={addIngredient} className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg bg-accent text-white cursor-pointer"><Plus size={14} /> Добави съставка</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[820px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-3">
                <th className="text-left font-medium px-2 py-1.5">Суровина</th>
                <th className="text-right font-medium px-2 py-1.5">€/кг (доставна)</th>
                <th className="text-left font-medium px-2 py-1.5">Надценка</th>
                <th className="text-right font-medium px-2 py-1.5">Мг в табл.</th>
                <th className="text-right font-medium px-2 py-1.5">€/табл.</th>
                <th className="text-right font-medium px-2 py-1.5">€/опаковка</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((ing, idx) => (
                <tr key={idx} className="border-t border-border">
                  <td className="px-2 py-1.5 min-w-[220px]">
                    <input list="pl-materials" value={ing.name} onChange={(e) => setIngredientName(idx, e.target.value)} className={inputCls + " py-1.5"} placeholder="избери или напиши суровина" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      value={ing.price_eur === "" || ing.price_eur == null ? "" : String(ing.price_eur)}
                      onChange={(e) => updateIng(idx, { price_eur: e.target.value })}
                      className="w-[90px] px-2 py-1 rounded-md border border-border text-[12px] bg-surface text-right tabular-nums"
                      placeholder="€/кг"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={ing.markup} onChange={(e) => updateIng(idx, { markup: Number(e.target.value) })} className={inputCls + " py-1.5 w-[130px]"}>
                      {MARKUPS.map((mk) => <option key={mk.v} value={mk.v}>{mk.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5"><input value={String(ing.mg_per_tablet)} onChange={(e) => updateIng(idx, { mg_per_tablet: e.target.value })} className="w-[80px] px-2 py-1 rounded-md border border-border text-[12px] bg-surface text-right" placeholder="мг" /></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text-3 whitespace-nowrap">{eur(pricePerTablet(ing), 5)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-text whitespace-nowrap">{eur(pricePerPack(ing, tpp), 4)}</td>
                  <td className="px-2 py-1.5"><button onClick={() => setIngredients((a) => a.filter((_, i) => i !== idx))} className="text-text-3 hover:text-red-500"><X size={14} /></button></td>
                </tr>
              ))}
              {ingredients.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-[12px] text-text-3">Няма добавени съставки.</td></tr>}
            </tbody>
            {ingredients.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td colSpan={5} className="px-2 py-2 text-right font-semibold">Тотал суровини за опаковка:</td>
                  <td className="px-2 py-2 text-right font-bold text-accent tabular-nums whitespace-nowrap">{eur(totals.totalRaw, 4)} €</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <datalist id="pl-materials">{refs?.materials.map((m) => <option key={m.item_id} value={m.name} />)}</datalist>
        {ingredients.some((i) => Number(i.price_eur) === 0 && i.item_id) && (
          <p className="text-[11px] text-amber-600 mt-2">Някои суровини нямат доставна цена в PRIM — впиши я ръчно в полето €/кг (или натисни „Синк цени“).</p>
        )}
      </Card>

      {/* Модул 2 — Операции */}
      <Card className="p-4 mb-4">
        <div className="text-[13px] font-semibold text-text mb-3">Модул 2 · Операции</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[620px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-3">
                <th className="text-left font-medium px-2 py-1.5">Операция</th>
                <th className="text-right font-medium px-2 py-1.5">Единична цена €</th>
                <th className="text-left font-medium px-2 py-1.5">Начин</th>
                <th className="text-right font-medium px-2 py-1.5">€/опаковка</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((op, idx) => (
                <tr key={idx} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <div>{op.name}{op.is_input ? <span className="text-[10px] text-accent ml-1">(въвежда се)</span> : ""}</div>
                    {op.is_input && (refs?.capsules?.length ?? 0) > 0 && (
                      <select
                        value={refs?.capsules.find((c) => c.name === op.capsule)?.item_id ?? ""}
                        onChange={(e) => setOpCapsule(idx, e.target.value)}
                        className="mt-1 w-full max-w-[280px] px-2 py-1 rounded-md border border-border text-[11px] bg-surface"
                      >
                        <option value="">— избери вид капсула —</option>
                        {refs?.capsules.map((c) => <option key={c.item_id} value={c.item_id}>{c.name}{c.price_eur != null ? ` — ${eur(c.price_eur, 4)} €` : " (без цена)"}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right"><input value={String(op.unit_price)} onChange={(e) => updateOp(idx, e.target.value)} className="w-[110px] px-2 py-1 rounded-md border border-border text-[12px] bg-surface text-right tabular-nums" /></td>
                  <td className="px-2 py-1.5 text-[11px] text-text-3">{op.kind === "per_unit" ? "× брой в опаковка" : "фиксирана"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">{eur(opPerPack(op, tpp), 4)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border text-text-2">
                <td colSpan={3} className="px-2 py-1.5 text-right">Труд (броене + таблетиране + лепене):</td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{eur(totals.labor, 4)} €</td>
              </tr>
              <tr className="border-t-2 border-border">
                <td colSpan={3} className="px-2 py-2 text-right font-semibold">Тотал операции за опаковка:</td>
                <td className="px-2 py-2 text-right font-bold text-accent tabular-nums whitespace-nowrap">{eur(totals.totalOps, 4)} €</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Модул 3 — Крайна цена */}
      <Card className="p-5 mb-4 flex items-center justify-between flex-wrap gap-3 bg-accent-soft">
        <div>
          <div className="text-[12px] text-text-3">Крайна цена за опаковка (без ДДС)</div>
          <div className="text-[11px] text-text-3">суровини {eur(totals.totalRaw, 3)} € + операции {eur(totals.totalOps, 3)} €</div>
        </div>
        <div className="text-[28px] font-bold text-accent tabular-nums">{eur(totals.total, 3)} €</div>
      </Card>
    </div>
  );
}

export default function OfferPage() {
  return (
    <Suspense fallback={<div className="flex items-center gap-2 text-text-3 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Зареждане…</div>}>
      <OfferInner />
    </Suspense>
  );
}
