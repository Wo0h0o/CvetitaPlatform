"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft, Printer, Loader2 } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const d2 = (s: string | null) => (s ? s.split("-").reverse().join(".") : "—");

interface Req { id: number; store_id: number; period_from: string | null; period_to: string | null; items: { name: string; sku: string | null; qty: number; qty_sold?: number }[]; note: string | null; created_at: string; created_name: string | null }

function Inner() {
  const id = useSearchParams().get("id");
  const { data } = useSWR<{ request: Req }>(id ? `/api/store/restock?id=${id}` : null, fetcher, { revalidateOnFocus: false });
  const { data: storesData } = useSWR<{ stores: { id: number; name: string }[] }>("/api/store/stores", fetcher, { revalidateOnFocus: false });
  const r = data?.request;
  const storeName = storesData?.stores.find((s) => s.id === r?.store_id)?.name ?? "";

  if (!r) return <div className="flex items-center gap-2 text-text-3 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Зареждане…</div>;

  return (
    <div>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #restock-doc, #restock-doc * { visibility: visible !important; }
        #restock-doc { position: absolute; left: 0; top: 0; width: 100%; padding: 0 14mm; }
        .no-print { display: none !important; }
      }`}</style>

      <div className="no-print mb-5 flex items-center gap-3">
        <Link href="/store/restock" className="flex items-center gap-2 text-[13px] text-text-2 hover:text-text"><ArrowLeft size={16} /> Назад</Link>
        <button onClick={() => window.print()} className="ml-auto flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer">
          <Printer size={16} /> Печат / PDF
        </button>
      </div>

      <div id="restock-doc" className="bg-white text-black rounded-xl p-8 md:p-10 max-w-[820px] mx-auto shadow-sm" style={{ fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        <h1 className="text-[22px] font-bold text-center mb-1">ЗАЯВКА ЗА ЗАРЕЖДАНЕ</h1>
        <div className="text-center text-[13px] mb-5">№ {r.id} / {new Date(r.created_at).toLocaleDateString("bg-BG")}</div>

        <div className="grid grid-cols-2 gap-4 mb-5 text-[13px]">
          <div><b>Магазин:</b> {storeName}</div>
          <div className="text-right"><b>Период на продажбите:</b> {d2(r.period_from)} – {d2(r.period_to)}</div>
        </div>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {["№", "Продукт", "SKU", "Продадено", "За зареждане"].map((h) => (
                <th key={h} className="border border-black px-2 py-1 text-center font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.items.map((it, i) => (
              <tr key={i}>
                <td className="border border-black px-2 py-1 text-center">{i + 1}</td>
                <td className="border border-black px-2 py-1">{it.name}</td>
                <td className="border border-black px-2 py-1 text-center">{it.sku || "—"}</td>
                <td className="border border-black px-2 py-1 text-center">{it.qty_sold ?? "—"}</td>
                <td className="border border-black px-2 py-1 text-center font-semibold">{it.qty}</td>
              </tr>
            ))}
            <tr>
              <td className="border border-black px-2 py-1 text-right font-bold" colSpan={4}>Общо бройки:</td>
              <td className="border border-black px-2 py-1 text-center font-bold">{r.items.reduce((s, it) => s + (Number(it.qty) || 0), 0)}</td>
            </tr>
          </tbody>
        </table>

        {r.note && <p className="mt-4 text-[13px]"><b>Бележка:</b> {r.note}</p>}
        <p className="mt-6 text-[12px] text-gray-600">Заявката е създадена от: {r.created_name || "—"}</p>
      </div>
    </div>
  );
}

export function RestockDoc() {
  return (
    <Suspense fallback={<div className="flex items-center gap-2 text-text-3 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Зареждане…</div>}>
      <Inner />
    </Suspense>
  );
}
