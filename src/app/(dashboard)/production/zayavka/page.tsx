"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Printer, ArrowLeft, Loader2 } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Row {
  id: string;
  name: string;
  sku: number | string;
  free: number;
  q60?: number;
  prodQty?: number;
}
interface Snapshot { singles: Row[]; bundles: Row[]; rawStock?: Record<string, number> }
interface Component { name: string; measure: string; qty_per_batch: number; kind: string }
interface Recipe { item_id: string; batch_qty: number; wo_num: string; components: Component[] }

const nf = (x: number, dp = 0) =>
  x.toLocaleString("bg-BG", { minimumFractionDigits: dp, maximumFractionDigits: dp });

// Разфасовка + вид от името, напр. "4МАГНЕБУСТ 150ГР" -> {size:"150", unit:"ГР"}
function parsePack(name: string): { size: string; unit: string } {
  const m = name.match(/(\d+)\s*(ГР|МЛ|ТАБЛ|КАПС|САШЕ|КГ|Г)\b/i);
  return m ? { size: m[1], unit: m[2].toUpperCase() } : { size: "", unit: "" };
}

function ZayavkaInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sel = params.get("sel") ?? "";

  const selection = useMemo(
    () =>
      sel
        .split(",")
        .filter(Boolean)
        .map((p) => {
          const [id, qty] = p.split("~");
          return { id, qty: parseInt(qty || "0", 10) };
        }),
    [sel]
  );

  const { data: fData, isLoading: l1 } = useSWR<{ snapshot: Snapshot | null; as_of?: string }>(
    "/api/production/forecast",
    fetcher,
    { revalidateOnFocus: false }
  );
  const { data: rData, isLoading: l2 } = useSWR<{ recipes: Record<string, Recipe> }>(
    "/api/production/recipes",
    fetcher,
    { revalidateOnFocus: false }
  );

  const snap = fData?.snapshot ?? null;
  const recipes = useMemo(() => rData?.recipes ?? {}, [rData]);
  const rawStock = useMemo(() => snap?.rawStock ?? {}, [snap]);

  const items = useMemo(() => {
    if (!snap) return [];
    const byId = new Map(snap.singles.map((r) => [r.id, r]));
    return selection
      .map((s) => ({ row: byId.get(s.id), qty: s.qty }))
      .filter((x): x is { row: Row; qty: number } => !!x.row);
  }, [snap, selection]);

  // Обобщен списък суровини за поръчка (сумирано по всички избрани)
  const shortages = useMemo(() => {
    const need: Record<string, { measure: string; need: number }> = {};
    for (const { row, qty } of items) {
      const rec = recipes[row.id];
      if (!rec) continue;
      const mult = qty / rec.batch_qty;
      for (const c of rec.components) {
        if (c.kind === "op") continue;
        const key = c.name;
        if (!need[key]) need[key] = { measure: c.measure, need: 0 };
        need[key].need += c.qty_per_batch * mult;
      }
    }
    return Object.entries(need)
      .map(([name, v]) => {
        const have = rawStock[name] ?? 0;
        return { name, measure: v.measure, need: v.need, have, lack: Math.max(0, v.need - have) };
      })
      .filter((x) => x.lack > 1e-6)
      .sort((a, b) => b.lack - a.lack);
  }, [items, recipes, rawStock]);

  const today = fData?.as_of
    ? fData.as_of.split("-").reverse().join(".")
    : new Date().toLocaleDateString("bg-BG");

  if (l1 || l2)
    return (
      <div className="flex items-center gap-2 text-text-3 py-12 justify-center">
        <Loader2 className="animate-spin" size={18} /> Зареждане…
      </div>
    );

  return (
    <div>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #zayavka-print, #zayavka-print * { visibility: visible !important; }
        #zayavka-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0 12mm; }
        .no-print { display: none !important; }
      }`}</style>

      {/* Лента с действия (скрива се при печат) */}
      <div className="no-print flex items-center justify-between mb-5 gap-3 flex-wrap">
        <button
          onClick={() => router.push("/production")}
          className="flex items-center gap-2 text-[13px] text-text-2 hover:text-text cursor-pointer"
        >
          <ArrowLeft size={16} /> Назад
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer"
        >
          <Printer size={16} /> Печат / PDF
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-text-3 text-[14px]">Няма избрани продукти. Върни се и избери от списъка.</div>
      ) : (
        <div id="zayavka-print" className="bg-white text-black rounded-xl p-8 md:p-10 max-w-[900px] mx-auto shadow-sm text-[13px] leading-relaxed">
          <h1 className="text-center text-[17px] font-bold mb-4">ВЪЗЛАГАТЕЛНО ПИСМО №___/{today}г.</h1>
          <p className="mb-2">Днес, {today}г., в гр. Бургас между:</p>
          <p className="mb-2">
            1. <b>ЦВЕТИТА ХЕРБАЛ ЕООД</b>{', вписано в Търговския регистър под ЕИК 203492157, със седалище и адрес на управление: гр. Бургас, ул. „Граф Игнатиев" № 17, представлявано от Георги Добрев Петков от една страна като '}<b>ИЗПЪЛНИТЕЛ</b>
          </p>
          <p className="mb-2">и</p>
          <p className="mb-3">
            2. ..............................., вписано в Търговския регистър под ЕИК ...................., със
            седалище и адрес на управление: гр. София, бул. България Б №81, представлявано от ....................
            от друга страна като <b>ВЪЗЛОЖИТЕЛ,</b>
          </p>
          <p className="mb-3">
            Наричани по–долу общо СТРАНИТЕ, се подписа настоящото възлагателно писмо, с което СТРАНИТЕ се
            договориха за следното:
          </p>
          <p className="mb-3">
            <b>Чл.1.</b> {'ВЪЗЛОЖИТЕЛЯТ възлага, а ИЗПЪЛНИТЕЛЯТ приема срещу заплащане да произведе следните хранителни добавки, наричани по-долу „Продукти", както следва:'}
          </p>

          <table className="w-full border-collapse mb-4 text-[12px]">
            <thead>
              <tr>
                {["№", "Име на продукта / Субстанция", "Количество", "Разфасовка", "Вид", "Допълнителен коментар"].map(
                  (h) => (
                    <th key={h} className="border border-black px-2 py-1.5 bg-gray-100 text-center font-semibold">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {items.map(({ row, qty }, i) => {
                const p = parsePack(row.name);
                return (
                  <tr key={row.id}>
                    <td className="border border-black px-2 py-1.5 text-center">{i + 1}</td>
                    <td className="border border-black px-2 py-1.5">{row.name}</td>
                    <td className="border border-black px-2 py-1.5 text-center font-semibold">{nf(qty)}</td>
                    <td className="border border-black px-2 py-1.5 text-center">{p.size}</td>
                    <td className="border border-black px-2 py-1.5 text-center">{p.unit}</td>
                    <td className="border border-black px-2 py-1.5"></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="mb-1">
            <b>Чл. 2.</b> /1/ Продуктът ще се изработва със суровини предоставени от ИЗПЪЛНИТЕЛЯ
          </p>
          <p className="mb-1">/2/ На готовия продукт се поставя етикет, съгласно условията на договора.</p>
          <p className="mb-3">/3/ Готовата продукция се опакова в подходящи кашони за транспортиране.</p>
          <p className="mb-6">Настоящото възлагателно писмо се подписа в два еднообразни екземпляра, по един за всяка страна.</p>

          <div className="flex flex-col items-center gap-6 mb-2">
            <div className="text-center">За Изпълнителя: ______________________<div className="text-[10px] text-gray-500">/подпис/</div></div>
            <div className="text-center">За Възложителя: ______________________<div className="text-[10px] text-gray-500">/подпис/</div></div>
          </div>

          {/* Приложение — проверка на суровини */}
          <div className="mt-8 pt-5 border-t border-gray-300 break-before-page">
            <h2 className="text-[14px] font-bold mb-2">Приложение — проверка на суровини за поръчка</h2>
            {shortages.length === 0 ? (
              <p className="text-[12px]">
                За избраните продукти с налична рецепта всички суровини стигат, или няма заредена рецепта.
                Продукти без рецепта: {items.filter((x) => !recipes[x.row.id]).map((x) => x.row.name).join(", ") || "няма"}.
              </p>
            ) : (
              <>
                <p className="text-[12px] mb-2">Липсващи суровини/опаковки (сумарно за цялата заявка):</p>
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr>
                      {["Суровина / опаковка", "Нужно", "Налично", "За поръчка"].map((h) => (
                        <th key={h} className="border border-gray-400 px-2 py-1 bg-gray-100 text-left font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shortages.map((s) => (
                      <tr key={s.name}>
                        <td className="border border-gray-400 px-2 py-1">{s.name}</td>
                        <td className="border border-gray-400 px-2 py-1 text-right">{nf(s.need, 3)} {s.measure}</td>
                        <td className="border border-gray-400 px-2 py-1 text-right">{nf(s.have, 3)} {s.measure}</td>
                        <td className="border border-gray-400 px-2 py-1 text-right font-semibold text-red-700">
                          {nf(s.lack, 3)} {s.measure}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {items.some((x) => !recipes[x.row.id]) && shortages.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-2">
                Без заредена рецепта (не са проверени): {items.filter((x) => !recipes[x.row.id]).map((x) => x.row.name).join(", ")}.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ZayavkaPage() {
  return (
    <Suspense fallback={<div className="text-text-3 py-12 text-center">Зареждане…</div>}>
      <ZayavkaInner />
    </Suspense>
  );
}
