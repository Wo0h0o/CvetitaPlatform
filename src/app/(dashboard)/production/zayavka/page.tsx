"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Printer, ArrowLeft, Loader2, Save, Check } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Row {
  id: string;
  name: string;
  sku: number | string;
  free: number;
  q60?: number;
  prodQty?: number;
}
interface Snapshot { singles: Row[]; bundles?: Row[]; ishleme?: Row[]; rawStock?: Record<string, number> }
interface Component { name: string; measure: string; qty_per_batch: number; kind: string }
interface Recipe { item_id: string; batch_qty: number; wo_num: string; components: Component[] }
interface Firma { eik: string; name: string; manager?: string; address?: string }

const nf = (x: number, dp = 0) =>
  x.toLocaleString("bg-BG", { minimumFractionDigits: dp, maximumFractionDigits: dp });

// рецепта за 1 бройка в удобни единици: кг→г, л→мл, бр→бр
function perUnitStr(perUnit: number, measure: string): string {
  if (measure === "кг" || measure === "л") {
    const v = perUnit * 1000; // г или мл
    const unit = measure === "кг" ? "г" : "мл";
    const dp = v >= 10 ? 1 : v >= 1 ? 2 : v >= 0.01 ? 3 : 5;
    return `${nf(v, dp)} ${unit}`;
  }
  return `${nf(perUnit, perUnit >= 1 ? 0 : 2)} ${measure}`;
}

// Разфасовка + вид от името: брой капсули/таблетки, или грамове/мл.
// Пропуска дозата в мг (напр. „100 МГ 30 ТАБЛ" -> 30 ТАБЛ).
// „40 СОФТГЕЛ КАПС" -> 40 КАПС; „150ГР" -> 150 ГР; „150g" -> 150 ГР.
function parsePack(name: string): { size: string; unit: string } {
  const B = "(?![А-Яа-яA-Za-z])"; // граница, съвместима с кирилица (\\b не работи)
  const forms: { re: RegExp; unit: string }[] = [
    { re: new RegExp(`(\\d+)\\s*(?:[А-Яа-яA-Za-z.+-]+\\s+){0,2}?(?:ТАБЛЕТКИ|ТАБЛ|ТАБС|ТАБ)${B}`, "i"), unit: "ТАБЛ" },
    { re: new RegExp(`(\\d+)\\s*(?:[А-Яа-яA-Za-z.+-]+\\s+){0,2}?(?:КАПСУЛИ|КАПС|СОФТГЕЛ)${B}`, "i"), unit: "КАПС" },
    { re: new RegExp(`(\\d+)\\s*(?:МЛ|ML)${B}`, "i"), unit: "МЛ" },
    { re: new RegExp(`(\\d+)\\s*САШЕ${B}`, "i"), unit: "САШЕ" },
    { re: new RegExp(`(\\d+)\\s*(?:ГР|GR|G|Г)\\.?${B}`, "i"), unit: "ГР" },
  ];
  for (const f of forms) {
    const m = name.match(f.re);
    if (m) return { size: m[1], unit: f.unit };
  }
  return { size: "", unit: "" };
}

function ZayavkaInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sel = params.get("sel") ?? "";
  const orderId = params.get("order"); // отваряне на вече издадена заявка

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
  const { data: oData, isLoading: l3 } = useSWR<{
    orders: { id: number; letter_no: string | null; issued_date: string; note?: string | null; firma?: Firma | null; invoice_no?: string | null; invoice_date?: string | null; items: { item_id: string; sku?: string; name: string; qty: number }[] }[];
  }>(orderId ? "/api/production/orders" : null, fetcher, { revalidateOnFocus: false });

  const firmaEik = params.get("firma"); // ЕИК на ишлеме клиента (възложител)
  const { data: refsData } = useSWR<{ companies: Firma[] }>(
    firmaEik ? "/api/notify/refs" : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const snap = fData?.snapshot ?? null;
  const recipes = useMemo(() => rData?.recipes ?? {}, [rData]);
  const rawStock = useMemo(() => snap?.rawStock ?? {}, [snap]);
  const savedOrder = orderId ? oData?.orders?.find((o) => String(o.id) === orderId) ?? null : null;

  // Възложител (ишлеме клиент): от запазеното писмо или намерен по ЕИК в базата с фирми
  const firma: Firma | null = useMemo(() => {
    if (savedOrder?.firma) return savedOrder.firma;
    if (firmaEik && refsData?.companies) return refsData.companies.find((c) => String(c.eik) === String(firmaEik)) ?? null;
    return null;
  }, [savedOrder, firmaEik, refsData]);

  const items = useMemo(() => {
    // 1) вече издадена заявка -> от запазените данни
    if (orderId) {
      if (!savedOrder) return [];
      return savedOrder.items.map((it) => ({
        row: { id: it.item_id, name: it.name, sku: it.sku ?? "", free: 0 } as Row,
        qty: it.qty,
      }));
    }
    // 2) нова заявка от избора на страниците (Цветита Хербал ИЛИ Ишлемета)
    if (!snap) return [];
    const byId = new Map(
      [...(snap.singles ?? []), ...(snap.bundles ?? []), ...(snap.ishleme ?? [])].map((r) => [r.id, r])
    );
    return selection
      .map((s) => ({ row: byId.get(s.id), qty: s.qty }))
      .filter((x): x is { row: Row; qty: number } => !!x.row);
  }, [orderId, savedOrder, snap, selection]);

  // Пълна рецепта по продукт: всеки компонент с нужно/налично/статус
  const perProduct = useMemo(() => {
    return items
      .map(({ row, qty }) => {
        const rec = recipes[row.id];
        if (!rec) return { row, qty, rec: null, comps: [] };
        const mult = qty / rec.batch_qty;
        const comps = rec.components
          .filter((c) => c.kind !== "op")
          .map((c) => {
            const need = c.qty_per_batch * mult;
            const have = rawStock[c.name] ?? 0;
            const perUnit = rec.batch_qty > 0 ? c.qty_per_batch / rec.batch_qty : 0;
            return { name: c.name, measure: c.measure, kind: c.kind, perUnit, need, have, lack: Math.max(0, need - have) };
          })
          .sort((a, b) => (a.kind === b.kind ? b.need - a.need : a.kind === "raw" ? -1 : 1));
        return { row, qty, rec, comps };
      });
  }, [items, recipes, rawStock]);

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

  const today = savedOrder
    ? savedOrder.issued_date.split("-").reverse().join(".")
    : fData?.as_of
      ? fData.as_of.split("-").reverse().join(".")
      : new Date().toLocaleDateString("bg-BG");
  const letterLabel = savedOrder?.letter_no || "___";
  const soRef = params.get("so"); // № на продажбата, от която е създадено писмото

  const [letterNo, setLetterNo] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(false);

  // Фактура и дата за Чл. 3/4 (дата по подразбиране = датата на издаване на писмото)
  const issueISO = savedOrder?.issued_date || fData?.as_of || new Date().toISOString().slice(0, 10);
  const invNo = (savedOrder ? savedOrder.invoice_no : invoiceNo) || "";
  const invDateISO = (savedOrder ? savedOrder.invoice_date : invoiceDate) || issueISO;
  const invNoDisplay = invNo || "……………………";
  const invDateDisplay = invDateISO ? invDateISO.split("-").reverse().join(".") : "……………";

  // ред за референция в писмото (продажба / фактура)
  const refLine = savedOrder
    ? savedOrder.note || ""
    : [soRef ? `Продажба № ${soRef}` : "", invoiceNo ? `Фактура № ${invoiceNo}` : ""].filter(Boolean).join(" · ");

  const issueOrder = async () => {
    setIssuing(true);
    try {
      const note = [soRef ? `Продажба ${soRef}` : "", invoiceNo ? `Фактура ${invoiceNo}` : ""].filter(Boolean).join(" · ") || null;
      const payload = {
        letter_no: letterNo || null,
        note,
        firma,
        invoice_no: invoiceNo || null,
        invoice_date: invoiceDate || issueISO,
        items: items.map(({ row, qty }) => {
          const p = parsePack(row.name);
          return { item_id: row.id, sku: String(row.sku), name: row.name, qty, size: p.size, unit: p.unit };
        }),
      };
      const res = await fetch("/api/production/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("fail");
      setIssued(true);
      setTimeout(() => router.push("/production/orders"), 700);
    } catch {
      alert("Грешка при записване на заявката.");
    } finally {
      setIssuing(false);
    }
  };

  if (l1 || l2 || (orderId && l3))
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
        <div className="flex items-center gap-2 flex-wrap">
          {!savedOrder && (
            <>
              <input
                value={letterNo}
                onChange={(e) => setLetterNo(e.target.value)}
                placeholder="№ на писмо (напр. 52)"
                className="w-40 px-3 py-2 text-[13px] rounded-lg border border-border bg-surface"
              />
              <input
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                placeholder="№ на фактура"
                className="w-44 px-3 py-2 text-[13px] rounded-lg border border-border bg-surface"
              />
              <input
                type="date"
                value={invoiceDate || issueISO}
                onChange={(e) => setInvoiceDate(e.target.value)}
                title="Дата на фактурата"
                className="w-40 px-3 py-2 text-[13px] rounded-lg border border-border bg-surface"
              />
            </>
          )}
          {savedOrder ? null : issued ? (
            <span className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-green-500/15 text-green-600">
              <Check size={16} /> Издадена
            </span>
          ) : (
            <button
              onClick={issueOrder}
              disabled={issuing || items.length === 0}
              className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg border border-accent text-accent hover:bg-accent-soft cursor-pointer disabled:opacity-50"
            >
              {issuing ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Издай заявката
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer"
          >
            <Printer size={16} /> Печат / PDF
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-text-3 text-[14px]">Няма избрани продукти. Върни се и избери от списъка.</div>
      ) : (
        <div id="zayavka-print" className="bg-white text-black rounded-xl p-8 md:p-10 max-w-[900px] mx-auto shadow-sm text-[13px] leading-relaxed">
          <h1 className="text-center text-[17px] font-bold mb-1">ВЪЗЛАГАТЕЛНО ПИСМО №{letterLabel}/{today}г.</h1>
          {refLine && <p className="text-center text-[12px] text-gray-600 mb-3">{refLine}</p>}
          <p className="mb-2 mt-3">Днес, {today}г., в гр. Бургас между:</p>
          <p className="mb-2">
            1. <b>ЦВЕТИТА ХЕРБАЛ ЕООД</b>{', вписано в Търговския регистър под ЕИК 203492157, със седалище и адрес на управление: гр. Бургас, ул. „Граф Игнатиев" № 17, представлявано от Георги Добрев Петков от една страна като '}<b>ИЗПЪЛНИТЕЛ</b>
          </p>
          <p className="mb-2">и</p>
          <p className="mb-3">
            2. {firma ? (
              <>
                <b>{firma.name}</b>, вписано в Търговския регистър под ЕИК {firma.eik}, със седалище и адрес на управление: {firma.address || "…………………………"}, представлявано от {firma.manager || "…………………………"}
              </>
            ) : (
              <>..............................., вписано в Търговския регистър под ЕИК ...................., със седалище и адрес на управление: ..............................., представлявано от ....................</>
            )} от друга страна като <b>ВЪЗЛОЖИТЕЛ,</b>
          </p>
          <p className="mb-3">
            Наричани по–долу общо СТРАНИТЕ, се подписа настоящото възлагателно писмо, с което СТРАНИТЕ се
            договориха за следното:
          </p>
          <p className="mb-3">
            <b>Чл. 1.</b> {'ВЪЗЛОЖИТЕЛЯТ възлага, а ИЗПЪЛНИТЕЛЯТ приема срещу заплащане и при условията на настоящото възлагателно писмо да произведе следните хранителни добавки /диетична храна за специални медицински цели, наричана по-долу „Продукти", както следва:'}
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
            <b>Чл. 2.</b> /1/ Продуктът, предмет на настоящото възлагателно писмо ще се изработва със суровини предоставени от ИЗПЪЛНИТЕЛЯ
          </p>
          <p className="mb-1">/2/ На готовия продукт се поставя етикет, съгласно договорените условия.</p>
          <p className="mb-3">/3/ Готовата продукция се опакова в подходящи кашони за транспортиране.</p>

          <p className="mb-3">
            <b>Чл. 3.</b> /1/ За изработването на продукта, предмет на настоящия договор ВЪЗЛОЖИТЕЛЯТ заплаща на ИЗПЪЛНИТЕЛЯ възнаграждение съгласно Фактура № {invNoDisplay} издадена на {invDateDisplay} г.
          </p>

          <p className="mb-1">
            <b>Чл. 4.</b> /1/ Настоящото възлагане е със срок на изпълнение 60 дни.
          </p>
          <p className="mb-3">/2/ Срокът за изпълнение тече след получаване на плащане по Фактура № {invNoDisplay} издадена на {invDateDisplay} г. и при всички налични суровини и етикети.</p>

          <p className="mb-6">Настоящото възлагателно писмо се подписа в два еднообразни екземпляра, по един за всяка страна.</p>

          <div className="flex flex-col gap-6 mb-2 mt-8">
            <div>За Изпълнителя: ______________________ <span className="text-[10px] text-gray-500">/подпис/</span>
              <div className="mt-1 text-[11px] text-gray-500">_______________________________________________<br />/саморъчно изписване на трите имена/</div>
            </div>
            <div>За Възложителя: ______________________ <span className="text-[10px] text-gray-500">/подпис/</span>
              <div className="mt-1 text-[11px] text-gray-500">_______________________________________________<br />/саморъчно изписване на трите имена/</div>
            </div>
          </div>

          {/* Приложение — рецепта и проверка на суровини */}
          <div className="mt-8 pt-5 border-t border-gray-300 break-before-page">
            <h2 className="text-[14px] font-bold mb-3">Приложение — рецепта и проверка на суровини</h2>

            {perProduct.map(({ row, qty, rec, comps }) => (
              <div key={row.id} className="mb-5">
                <h3 className="text-[12px] font-bold mb-1">
                  {row.name} — {nf(qty)} бр
                  {rec ? <span className="font-normal text-gray-500"> (рецепта по {rec.wo_num}, партида {nf(rec.batch_qty)})</span> : null}
                </h3>
                {!rec ? (
                  <p className="text-[11px] text-gray-500">Няма заредена рецепта за този продукт — суровините не са проверени.</p>
                ) : (
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr>
                        {["Съставка / опаковка", "За 1 бр.", `Нужно за ${nf(qty)} бр`, "Налично", "Статус"].map((h) => (
                          <th key={h} className="border border-gray-400 px-2 py-1 bg-gray-100 text-left font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comps.map((c) => (
                        <tr key={c.name}>
                          <td className="border border-gray-400 px-2 py-1">{c.name}</td>
                          <td className="border border-gray-400 px-2 py-1 text-right whitespace-nowrap font-semibold">{perUnitStr(c.perUnit, c.measure)}</td>
                          <td className="border border-gray-400 px-2 py-1 text-right whitespace-nowrap">{nf(c.need, 3)} {c.measure}</td>
                          <td className="border border-gray-400 px-2 py-1 text-right whitespace-nowrap">{nf(c.have, 3)} {c.measure}</td>
                          <td className={`border border-gray-400 px-2 py-1 text-center font-semibold ${c.lack > 0 ? "text-red-700" : "text-green-700"}`}>
                            {c.lack > 0 ? `поръчай ${nf(c.lack, 3)} ${c.measure}` : "стига"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}

            {shortages.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-300">
                <h3 className="text-[12px] font-bold mb-1 text-red-700">За поръчка — сумарно за цялата заявка</h3>
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      {["Суровина / опаковка", "Общо нужно", "Налично", "Липсва"].map((h) => (
                        <th key={h} className="border border-gray-400 px-2 py-1 bg-gray-100 text-left font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shortages.map((s) => (
                      <tr key={s.name}>
                        <td className="border border-gray-400 px-2 py-1">{s.name}</td>
                        <td className="border border-gray-400 px-2 py-1 text-right whitespace-nowrap">{nf(s.need, 3)} {s.measure}</td>
                        <td className="border border-gray-400 px-2 py-1 text-right whitespace-nowrap">{nf(s.have, 3)} {s.measure}</td>
                        <td className="border border-gray-400 px-2 py-1 text-right font-semibold text-red-700 whitespace-nowrap">{nf(s.lack, 3)} {s.measure}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
