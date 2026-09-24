"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft, Printer, Loader2, Plus, X, Mail, CalendarPlus, ClipboardCheck } from "lucide-react";
import { eur } from "@/lib/pricing";

type Mode = "standard" | "key";
const fetcher = (url: string) => fetch(url).then((r) => r.json());
const todayBG = () => new Date().toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" });

interface Offer { id: number; product_name: string; client: string | null; tabs_per_pack: number | null; total: number | null }

interface DocRow {
  name: string;
  qty: string;
  pack: string;
  doses: string;
  dose: string;
  container: string;
  price: string; // форматирана единична цена без ДДС
}

const DEFAULT_NOTES = [
  "Смесване на суровини;",
  "Сашетиране",
  "Подреждане на продуктите в кашон готови за експедиране;",
  "Обозначение на кашоните с вида продукт и количество в кашон;",
  "Издаване на сертификат за качество;",
];
const DEFAULT_NOT_INCLUDED = [
  "Цена за фолио на продукта;",
  "Цена за кутия;",
  "Транспортни опаковки;",
  "Транспорт на готов продукт;",
];

// малко поле, което на екран има подчертаване, а на печат е чисто
const fld = "bg-transparent border-0 border-b border-dashed border-gray-300 print:border-0 focus:outline-none focus:border-accent px-0.5";

function Inner({ mode }: { mode: Mode }) {
  const params = useSearchParams();
  const base = mode === "key" ? "/pricing-key" : "/pricing";
  const ids = (params.get("ids") || "").split(",").map((s) => Number(s)).filter(Boolean);

  const { data, isLoading } = useSWR<{ offers: Offer[] }>(`/api/pricing/offers?module=${mode}`, fetcher, { revalidateOnFocus: false });
  const selected = useMemo(() => (data?.offers ?? []).filter((o) => ids.includes(o.id)), [data, ids]);

  const [izh, setIzh] = useState("");
  const [docDate, setDocDate] = useState(todayBG());
  const [doCompany, setDoCompany] = useState("");
  const [attention, setAttention] = useState("");
  const [greet, setGreet] = useState("");
  const [term, setTerm] = useState("обикновена поръчка – 30 работни дни");
  const [validity, setValidity] = useState("30 дни");
  const [notes, setNotes] = useState<string[]>(DEFAULT_NOTES);
  const [notesNot, setNotesNot] = useState<string[]>(DEFAULT_NOT_INCLUDED);
  const [rows, setRows] = useState<DocRow[]>([]);
  const [clientEmail, setClientEmail] = useState("");
  const [trackNote, setTrackNote] = useState("");
  const [init, setInit] = useState(false);

  useEffect(() => {
    if (init || !selected.length) return;
    setDoCompany((c) => c || selected[0].client || "");
    setRows(
      selected.map((o) => ({
        name: o.product_name || "",
        qty: "",
        pack: "",
        doses: o.tabs_per_pack != null ? String(o.tabs_per_pack) : "",
        dose: "",
        container: "",
        price: o.total != null ? `${eur(o.total, 3)} евро` : "",
      }))
    );
    setInit(true);
  }, [selected, init]);

  const upd = (i: number, patch: Partial<DocRow>) => setRows((a) => a.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const enc = encodeURIComponent;
  const productsStr = rows.map((r) => r.name).filter(Boolean).join(", ");
  const salut = greet || attention || "господине/госпожо";

  function gmailUrl() {
    const su = "Ценова оферта — ЦВЕТИТА ХЕРБАЛ ЕООД";
    const body =
      `Уважаеми/а ${salut},\n\n` +
      `Във връзка с Вашето запитване за производство, прилагаме нашата ценова оферта${productsStr ? ` за: ${productsStr}` : ""} (виж прикачения PDF файл).\n\n` +
      `Офертата е валидна ${validity}. Оставаме на разположение за въпроси и уточнения.\n\n` +
      `С уважение,\nЦВЕТИТА ХЕРБАЛ ЕООД\nгр. Бургас, ул. „Граф Игнатиев“ № 17`;
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(clientEmail)}&su=${enc(su)}&body=${enc(body)}`;
  }
  function calUrl(title: string, offsetDays: number) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const s = d.toISOString().slice(0, 10).replace(/-/g, "");
    const e = new Date(d);
    e.setDate(e.getDate() + 1);
    const eStr = e.toISOString().slice(0, 10).replace(/-/g, "");
    const details = `Оферта до ${doCompany || "клиент"}${productsStr ? ` — ${productsStr}` : ""}.${clientEmail ? ` Имейл: ${clientEmail}.` : ""}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(title)}&dates=${s}/${eStr}&details=${enc(details)}`;
  }
  const co = doCompany || "клиент";
  const reminders = [
    { label: "📞 днес", url: calUrl(`📞 Обади се — ${co} (пусната оферта)`, 0) },
    { label: "✉️ +3 дни", url: calUrl(`✉️ Имейл до ${co} (ако няма отговор)`, 3) },
    { label: "📞 +5 дни", url: calUrl(`📞 Обади се на ${co} (ако няма отговор)`, 5) },
  ];

  async function startTracking() {
    try {
      await fetch("/api/pricing/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: mode, client: doCompany || null, client_email: clientEmail || null, subject: productsStr || null, sent_date: new Date().toISOString().slice(0, 10), status: "изпратена" }),
      });
      setTrackNote("Добавено в „Оферти — статуси“ с 3-те напомняния.");
    } catch {
      setTrackNote("Грешка при добавяне в статусите.");
    }
  }

  if (isLoading)
    return <div className="flex items-center gap-2 text-text-3 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Зареждане…</div>;

  return (
    <div>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #offer-doc, #offer-doc * { visibility: visible !important; }
        #offer-doc { position: absolute; left: 0; top: 0; width: 100%; padding: 0 14mm; }
        #offer-doc input, #offer-doc textarea { border: 0 !important; }
        .no-print { display: none !important; }
      }`}</style>

      <div className="no-print mb-5">
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <Link href={base} className="flex items-center gap-2 text-[13px] text-text-2 hover:text-text"><ArrowLeft size={16} /> Назад</Link>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <a href={clientEmail ? gmailUrl() : undefined} target="_blank" rel="noopener noreferrer" title={clientEmail ? "" : "Впиши имейл на клиента в блока „ДО“"} className={`flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-lg border border-border hover:bg-surface-2 ${clientEmail ? "cursor-pointer" : "opacity-50 pointer-events-none"}`}>
              <Mail size={15} /> Подготви имейл
            </a>
            <button onClick={startTracking} className="flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-lg border border-border hover:bg-surface-2 cursor-pointer">
              <ClipboardCheck size={15} /> Стартирай проследяване
            </button>
            <button onClick={() => window.print()} className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer">
              <Printer size={16} /> Печат / PDF
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[12px] text-text-3">
          <span className="flex items-center gap-1"><CalendarPlus size={14} /> Напомняния в календара:</span>
          {reminders.map((r) => (
            <a key={r.label} href={r.url} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1 rounded-md border border-border hover:bg-surface-2 text-text-2 cursor-pointer">{r.label}</a>
          ))}
          {trackNote && <span className="text-accent ml-2">{trackNote}</span>}
        </div>
      </div>

      {selected.length === 0 ? (
        <div className="text-text-3 text-[14px]">Няма избрани продукти. Върни се и избери от списъка с тикчета.</div>
      ) : (
        <div id="offer-doc" className="bg-white text-black rounded-xl p-8 md:p-10 max-w-[920px] mx-auto shadow-sm" style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 13, lineHeight: 1.5 }}>
          <p className="italic mb-6">Изх.№ <input value={izh} onChange={(e) => setIzh(e.target.value)} className={fld + " w-16 italic"} placeholder="№" />/<input value={docDate} onChange={(e) => setDocDate(e.target.value)} className={fld + " w-24 italic"} /></p>

          <div className="grid grid-cols-2 gap-6 mb-5">
            <div>
              <div className="font-bold mb-1">ДО:</div>
              <input value={doCompany} onChange={(e) => setDoCompany(e.target.value)} className={fld + " w-full font-bold"} placeholder="ФИРМА НА КЛИЕНТА" />
              <div className="mt-3">На Вниманието на:</div>
              <input value={attention} onChange={(e) => setAttention(e.target.value)} className={fld + " w-full font-bold"} placeholder="име на лице" />
              <div className="mt-2">Имейл: <input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className={fld + " w-56"} placeholder="имейл на клиента" /></div>
            </div>
            <div>
              <div className="font-bold mb-1">ОТ:</div>
              <div className="font-bold">„ЦВЕТИТА ХЕРБАЛ“ ЕООД</div>
              <div>ЕИК: 203492157</div>
              <div>гр. Бургас, п.к. 8000, ул. „Граф Игнатиев” № 17</div>
            </div>
          </div>

          <p className="mb-3"><b><u>ОТНОСНО:</u></b> Оферта по запитване за производство на хранителен продукт</p>
          <p className="mb-2">Уважаеми, <input value={greet} onChange={(e) => setGreet(e.target.value)} className={fld + " w-48"} placeholder="г-н/г-жо Име" />!</p>
          <p className="mb-2">Във връзка с постъпило Ваше запитване за производство на хранителна добавка, представяме наша оферта както следва:</p>
          <h2 className="text-center text-[26px] font-bold my-3">ОФЕРТА</h2>

          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {["№", "Субстанция", "Количество", "Разфасовка", "Дози в опаковка", "Единична доза", "Вид флакон", "Единична цена без ДДС"].map((h) => (
                  <th key={h} className="border border-black px-1.5 py-1 align-middle text-center font-semibold italic">{h}</th>
                ))}
                <th className="no-print w-6"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="border border-black px-1.5 py-1 text-center">{i + 1}</td>
                  <td className="border border-black px-1 py-1"><input value={r.name} onChange={(e) => upd(i, { name: e.target.value })} className={fld + " w-full"} /></td>
                  <td className="border border-black px-1 py-1 text-center"><input value={r.qty} onChange={(e) => upd(i, { qty: e.target.value })} className={fld + " w-20 text-center"} placeholder="бр." /></td>
                  <td className="border border-black px-1 py-1 text-center"><input value={r.pack} onChange={(e) => upd(i, { pack: e.target.value })} className={fld + " w-24 text-center"} placeholder="напр. 24 сашета" /></td>
                  <td className="border border-black px-1 py-1 text-center"><input value={r.doses} onChange={(e) => upd(i, { doses: e.target.value })} className={fld + " w-16 text-center"} /></td>
                  <td className="border border-black px-1 py-1 text-center"><input value={r.dose} onChange={(e) => upd(i, { dose: e.target.value })} className={fld + " w-24 text-center"} placeholder="напр. 1 саше" /></td>
                  <td className="border border-black px-1 py-1 text-center"><input value={r.container} onChange={(e) => upd(i, { container: e.target.value })} className={fld + " w-28 text-center"} placeholder="напр. Саше в кутия" /></td>
                  <td className="border border-black px-1 py-1 text-right whitespace-nowrap"><input value={r.price} onChange={(e) => upd(i, { price: e.target.value })} className={fld + " w-24 text-right"} /></td>
                  <td className="no-print px-1"><button onClick={() => setRows((a) => a.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><X size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setRows((a) => [...a, { name: "", qty: "", pack: "", doses: "", dose: "", container: "", price: "" }])} className="no-print mt-2 flex items-center gap-1 text-[12px] text-accent"><Plus size={13} /> Добави ред</button>

          <ol className="list-decimal ml-6 mt-4 space-y-0.5">
            <li>Цената е със срок на изпълнение – <input value={term} onChange={(e) => setTerm(e.target.value)} className={fld + " w-72"} />.</li>
            <li>Валидност на офертата – <input value={validity} onChange={(e) => setValidity(e.target.value)} className={fld + " w-24"} />.</li>
          </ol>

          <p className="font-bold mt-4">ЗАБЕЛЕЖКИ:</p>
          <p className="font-bold">Цената включва:</p>
          <div>
            {notes.map((nt, i) => (
              <div key={i} className="flex items-center gap-1">
                <span>*</span>
                <input value={nt} onChange={(e) => setNotes((a) => a.map((x, j) => (j === i ? e.target.value : x)))} className={fld + " flex-1"} />
                <button onClick={() => setNotes((a) => a.filter((_, j) => j !== i))} className="no-print text-gray-400 hover:text-red-500"><X size={12} /></button>
              </div>
            ))}
            <button onClick={() => setNotes((a) => [...a, ""])} className="no-print mt-1 flex items-center gap-1 text-[12px] text-accent"><Plus size={12} /> ред</button>
          </div>

          <p className="font-bold mt-4">Цената не включва:</p>
          <div>
            {notesNot.map((nt, i) => (
              <div key={i} className="flex items-center gap-1">
                <span>*</span>
                <input value={nt} onChange={(e) => setNotesNot((a) => a.map((x, j) => (j === i ? e.target.value : x)))} className={fld + " flex-1"} />
                <button onClick={() => setNotesNot((a) => a.filter((_, j) => j !== i))} className="no-print text-gray-400 hover:text-red-500"><X size={12} /></button>
              </div>
            ))}
            <button onClick={() => setNotesNot((a) => [...a, ""])} className="no-print mt-1 flex items-center gap-1 text-[12px] text-accent"><Plus size={12} /> ред</button>
          </div>

          {/* Футър — С уважение + печат */}
          <div className="flex justify-end mt-12">
            <div className="relative" style={{ width: 380 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/cvetita-stamp.png" alt="печат Цветита Хербал" style={{ position: "absolute", right: 30, top: -46, width: 150, height: "auto" }} />
              <div className="pt-2">С уважение: …………………………………………</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function OfferDoc({ mode }: { mode: Mode }) {
  return (
    <Suspense fallback={<div className="flex items-center gap-2 text-text-3 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Зареждане…</div>}>
      <Inner mode={mode} />
    </Suspense>
  );
}
