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
  PRIM_MARKUP,
  PL_TYPES,
  type PlIngredient,
  type PlOperation,
  type PlProductType,
} from "@/lib/pricing";

type Mode = "standard" | "key";
const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Material { item_id: number; sku: string; name: string; unit: string; price_eur: number | null; price_updated: string | null }
interface OpRef { id: number; name: string; unit_price: number; kind: "per_unit" | "per_pack"; is_input: boolean; is_labor: boolean; sort: number }
interface Capsule { item_id: number; name: string; price_eur: number | null }
interface Packaging { item_id: number; name: string; category: string | null; price_eur: number | null }
interface Refs { materials: Material[]; operations: OpRef[]; capsules: Capsule[]; packaging: Packaging[] }

const inputCls = "w-full px-3 py-2 rounded-lg border border-border bg-surface text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40";
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium uppercase tracking-wider text-text-3 mb-1">{children}</label>;
}

function Inner({ mode }: { mode: Mode }) {
  const params = useSearchParams();
  const router = useRouter();
  const editId = params.get("id");
  const base = mode === "key" ? "/pricing-key" : "/pricing";
  // за „Ключови клиенти" — реалната себестойност (без +20%); за стандартните — доставна +20%
  const applyMarkup = (price: number) => (mode === "key" ? price : Math.round(price * PRIM_MARKUP * 10000) / 10000);

  const { data: refs, mutate: mutateRefs } = useSWR<Refs>(`/api/pricing/refs?module=${mode}`, fetcher, { revalidateOnFocus: false });

  const [productName, setProductName] = useState("");
  const [client, setClient] = useState("");
  const [productType, setProductType] = useState<PlProductType>("tablet");
  const [tabsPerPack, setTabsPerPack] = useState<string>("");
  const [ingredients, setIngredients] = useState<PlIngredient[]>([]);
  const [operations, setOperations] = useState<PlOperation[]>([]);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");
  const [opsInit, setOpsInit] = useState(false);

  // Операции по подразбиране за даден вид продукт (tablet → от PRIM, останалите → фиксирани).
  const opsForType = (t: PlProductType): PlOperation[] =>
    t === "tablet"
      ? (refs?.operations ?? []).map((o) => ({ name: o.name, unit_price: o.unit_price, kind: o.kind, is_input: o.is_input, is_labor: o.is_labor }))
      : PL_TYPES[t].defaultOps.map((o) => ({ ...o }));

  useEffect(() => {
    if (!refs || opsInit || editId) return;
    setOperations(opsForType("tablet"));
    setOpsInit(true);
  }, [refs, opsInit, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeType(t: PlProductType) {
    setProductType(t);
    if (!editId) setOperations(opsForType(t)); // смяна на вида → нови операции по подразбиране
  }

  useEffect(() => {
    if (!editId) return;
    fetch(`/api/pricing/offers?module=${mode}&id=${editId}`).then((r) => r.json()).then(({ offer: o }) => {
      if (!o) return;
      setProductName(o.product_name || "");
      setClient(o.client || "");
      setProductType((o.product_type as PlProductType) || "tablet");
      setTabsPerPack(o.tabs_per_pack != null ? String(o.tabs_per_pack) : "");
      setIngredients(o.ingredients || []);
      setOperations(o.operations || []);
      setSavedId(o.id);
      setOpsInit(true);
    });
  }, [editId, mode]);

  const typeCfg = PL_TYPES[productType];
  const divisor = typeCfg.divisor;
  // категории опаковки за optgroup-ите (Флакони,капачки преди Етикети,кутии)
  const packagingCats = useMemo(() => {
    const set = new Set((refs?.packaging ?? []).map((p) => p.category || "Други"));
    return [...set].sort((a, b) => (a === "Флакони, капачки" ? -1 : b === "Флакони, капачки" ? 1 : a.localeCompare(b, "bg")));
  }, [refs]);
  const totals = useMemo(() => computeTotals(ingredients, operations, tabsPerPack, divisor), [ingredients, operations, tabsPerPack, divisor]);
  const tpp = tabsPerPack;

  function addIngredient() {
    setIngredients((a) => [...a, { item_id: undefined, name: "", price_eur: "", mg_per_tablet: "" }]);
  }
  function updateIng(idx: number, patch: Partial<PlIngredient>) {
    setIngredients((a) => a.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function setIngredientName(idx: number, name: string) {
    const key = name.toLowerCase().replace(/\s+/g, " ").trim();
    const m = refs?.materials.find((x) => x.name.toLowerCase().replace(/\s+/g, " ").trim() === key);
    setIngredients((a) =>
      a.map((it, i) => {
        if (i !== idx) return it;
        if (m) return { ...it, name: m.name, item_id: m.item_id, price_eur: m.price_eur != null ? applyMarkup(m.price_eur) : it.price_eur || "" };
        return { ...it, name, item_id: undefined };
      })
    );
  }
  function updateOp(idx: number, unit_price: string) {
    setOperations((a) => a.map((op, i) => (i === idx ? { ...op, unit_price } : op)));
  }
  function updateOpField(idx: number, patch: Partial<PlOperation>) {
    setOperations((a) => a.map((op, i) => (i === idx ? { ...op, ...patch } : op)));
  }
  function addOp() {
    setOperations((a) => [...a, { name: "", unit_price: 0, kind: "per_pack", is_labor: false }]);
  }
  function setOpCapsule(idx: number, itemId: string) {
    const c = refs?.capsules.find((x) => String(x.item_id) === itemId);
    setOperations((a) => a.map((op, i) => (i === idx ? { ...op, capsule: c ? c.name : "", unit_price: c && c.price_eur != null ? c.price_eur : op.unit_price } : op)));
  }
  function setOpPackaging(idx: number, itemId: string) {
    const p = refs?.packaging.find((x) => String(x.item_id) === itemId);
    setOperations((a) => a.map((op, i) => (i === idx ? { ...op, packaging: p ? p.name : "", unit_price: p && p.price_eur != null ? p.price_eur : op.unit_price } : op)));
  }

  async function syncPrices() {
    setSyncing(true);
    setNote("");
    try {
      const r = await fetch(`/api/pricing/sync?module=${mode}`, { method: "POST" }).then((x) => x.json());
      const fresh = await mutateRefs();
      if (fresh?.materials) {
        const byId = new Map(fresh.materials.map((m) => [String(m.item_id), m.price_eur]));
        setIngredients((a) => a.map((ing) => {
          if (!ing.item_id || !byId.has(String(ing.item_id))) return ing;
          const p = byId.get(String(ing.item_id));
          return { ...ing, price_eur: p != null ? applyMarkup(p) : ing.price_eur };
        }));
      }
      setNote(r.materials ? `Обновени ${r.materials} суровини (${r.priced} с цена), ${r.capsules ?? 0} капсули, ${r.packaging ?? 0} опаковки.` : r.error || "Обновено.");
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
        product_type: productType,
        tabs_per_pack: tabsPerPack ? Number(tabsPerPack) : null,
        ingredients,
        operations,
        total_raw: totals.totalRaw,
        total_ops: totals.totalOps,
        total: totals.total,
      };
      let res;
      if (savedId) res = await fetch(`/api/pricing/offers?module=${mode}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: savedId, ...payload }) });
      else res = await fetch(`/api/pricing/offers?module=${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const { offer } = await res.json();
      if (offer?.id) {
        setSavedId(offer.id);
        if (!editId) router.replace(`${base}/offer?id=${offer.id}`);
      }
    } finally {
      setSaving(false);
    }
  }

  const priceHeader = mode === "key" ? "€/кг (себестойност)" : "€/кг (доставна)";

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <Link href={base} className="text-text-3 hover:text-text"><ArrowLeft size={20} /></Link>
        <h1 className="text-[20px] font-bold text-text">{savedId ? "Оферта" : "Нова оферта"}{mode === "key" ? " · Ключови клиенти" : ""}</h1>
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

      <Card className="p-4 mb-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div><Label>Продукт</Label><input value={productName} onChange={(e) => setProductName(e.target.value)} className={inputCls} placeholder="напр. Продукт за сън 60 капс" /></div>
        <div>
          <Label>Вид продукт</Label>
          <select value={productType} onChange={(e) => changeType(e.target.value as PlProductType)} className={inputCls}>
            {(Object.keys(PL_TYPES) as PlProductType[]).map((t) => <option key={t} value={t}>{PL_TYPES[t].label}</option>)}
          </select>
        </div>
        <div><Label>Клиент (по избор)</Label><input value={client} onChange={(e) => setClient(e.target.value)} className={inputCls} placeholder="напр. Сапфир Нутришън" /></div>
        <div><Label>{typeCfg.packLabel}</Label><input value={tabsPerPack} onChange={(e) => setTabsPerPack(e.target.value.replace(/[^\d.,]/g, ""))} className={inputCls} placeholder="напр. 60" /></div>
      </Card>

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
                <th className="text-right font-medium px-2 py-1.5">{priceHeader}</th>
                <th className="text-right font-medium px-2 py-1.5">{typeCfg.doseLabel}</th>
                <th className="text-right font-medium px-2 py-1.5">{typeCfg.perUnitLabel}</th>
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
                    <input value={ing.price_eur === "" || ing.price_eur == null ? "" : String(ing.price_eur)} onChange={(e) => updateIng(idx, { price_eur: e.target.value })} className="w-[90px] px-2 py-1 rounded-md border border-border text-[12px] bg-surface text-right tabular-nums" placeholder="€/кг" />
                  </td>
                  <td className="px-2 py-1.5"><input value={String(ing.mg_per_tablet)} onChange={(e) => updateIng(idx, { mg_per_tablet: e.target.value })} className="w-[80px] px-2 py-1 rounded-md border border-border text-[12px] bg-surface text-right" placeholder={typeCfg.doseUnit} /></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text-3 whitespace-nowrap">{eur(pricePerTablet(ing, divisor), 5)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-text whitespace-nowrap">{eur(pricePerPack(ing, tpp, divisor), 4)}</td>
                  <td className="px-2 py-1.5"><button onClick={() => setIngredients((a) => a.filter((_, i) => i !== idx))} className="text-text-3 hover:text-red-500"><X size={14} /></button></td>
                </tr>
              ))}
              {ingredients.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-[12px] text-text-3">Няма добавени съставки.</td></tr>}
            </tbody>
            {ingredients.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td colSpan={4} className="px-2 py-2 text-right font-semibold">Тотал суровини за опаковка:</td>
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

      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold text-text">Модул 2 · Операции</span>
          <button onClick={addOp} className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2 cursor-pointer"><Plus size={14} /> Добави операция</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[720px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-3">
                <th className="text-left font-medium px-2 py-1.5">Операция</th>
                <th className="text-right font-medium px-2 py-1.5">Единична цена €</th>
                <th className="text-left font-medium px-2 py-1.5">Начин</th>
                <th className="text-center font-medium px-2 py-1.5">Труд</th>
                <th className="text-right font-medium px-2 py-1.5">€/опаковка</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {operations.map((op, idx) => (
                <tr key={idx} className="border-t border-border">
                  <td className="px-2 py-1.5 min-w-[200px]">
                    {op.is_input ? (
                      <div>{op.name}<span className="text-[10px] text-accent ml-1">(въвежда се)</span></div>
                    ) : (
                      <input value={op.name} onChange={(e) => updateOpField(idx, { name: e.target.value })} className={inputCls + " py-1.5"} placeholder="име на операция" />
                    )}
                    {op.is_input && (refs?.capsules?.length ?? 0) > 0 && (
                      <select value={refs?.capsules.find((c) => c.name === op.capsule)?.item_id ?? ""} onChange={(e) => setOpCapsule(idx, e.target.value)} className="mt-1 w-full max-w-[280px] px-2 py-1 rounded-md border border-border text-[11px] bg-surface">
                        <option value="">— избери вид капсула —</option>
                        {refs?.capsules.map((c) => <option key={c.item_id} value={c.item_id}>{c.name}{c.price_eur != null ? ` — ${eur(c.price_eur, 4)} €` : " (без цена)"}</option>)}
                      </select>
                    )}
                    {!op.is_input && !op.is_labor && (refs?.packaging?.length ?? 0) > 0 && (
                      <select value={refs?.packaging.find((p) => p.name === op.packaging)?.item_id ?? ""} onChange={(e) => setOpPackaging(idx, e.target.value)} className="mt-1 w-full max-w-[320px] px-2 py-1 rounded-md border border-border text-[11px] bg-surface text-text-2" title="Свържи с опаковъчен артикул от ПРИМ (цената идва сама)">
                        <option value="">— опаковка от ПРИМ (по избор) —</option>
                        {packagingCats.map((cat) => (
                          <optgroup key={cat} label={cat}>
                            {refs!.packaging.filter((p) => (p.category || "Други") === cat).map((p) => (
                              <option key={p.item_id} value={p.item_id}>{p.name}{p.price_eur != null ? ` — ${eur(p.price_eur, 4)} €` : " (без цена)"}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right"><input value={String(op.unit_price)} onChange={(e) => updateOp(idx, e.target.value)} className="w-[110px] px-2 py-1 rounded-md border border-border text-[12px] bg-surface text-right tabular-nums" /></td>
                  <td className="px-2 py-1.5">
                    <select value={op.kind} onChange={(e) => updateOpField(idx, { kind: e.target.value as "per_unit" | "per_pack" })} className="px-2 py-1 rounded-md border border-border text-[11px] bg-surface">
                      <option value="per_pack">фиксирана</option>
                      <option value="per_unit">× брой в опаковка</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!op.is_labor} onChange={(e) => updateOpField(idx, { is_labor: e.target.checked })} /></td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">{eur(opPerPack(op, tpp), 4)}</td>
                  <td className="px-2 py-1.5"><button onClick={() => setOperations((a) => a.filter((_, i) => i !== idx))} className="text-text-3 hover:text-red-500" title="Премахни"><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border text-text-2">
                <td colSpan={4} className="px-2 py-1.5 text-right">Труд (операциите, маркирани като ръчен труд):</td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{eur(totals.labor, 4)} €</td>
                <td></td>
              </tr>
              <tr className="border-t-2 border-border">
                <td colSpan={4} className="px-2 py-2 text-right font-semibold">Тотал операции за опаковка:</td>
                <td className="px-2 py-2 text-right font-bold text-accent tabular-nums whitespace-nowrap">{eur(totals.totalOps, 4)} €</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card className="p-5 mb-4 flex items-center justify-between flex-wrap gap-3 bg-accent-soft">
        <div>
          <div className="text-[12px] text-text-3">{mode === "key" ? "Крайна цена / себестойност за опаковка (без ДДС)" : "Крайна цена за опаковка (без ДДС)"}</div>
          <div className="text-[11px] text-text-3">суровини {eur(totals.totalRaw, 3)} € + операции {eur(totals.totalOps, 3)} €</div>
        </div>
        <div className="text-[28px] font-bold text-accent tabular-nums">{eur(totals.total, 3)} €</div>
      </Card>
    </div>
  );
}

export function OfferForm({ mode }: { mode: Mode }) {
  return (
    <Suspense fallback={<div className="flex items-center gap-2 text-text-3 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Зареждане…</div>}>
      <Inner mode={mode} />
    </Suspense>
  );
}
