"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calculator, Plus, Loader2, FileText, KeyRound, FileDown, Trash2 } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { eur, PL_TYPES, type PlProductType } from "@/lib/pricing";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Offer {
  id: number;
  product_name: string;
  client: string | null;
  product_type: PlProductType | null;
  total: number | null;
  updated_at: string;
}

export function OffersList({ mode }: { mode: "standard" | "key" }) {
  const base = mode === "key" ? "/pricing-key" : "/pricing";
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR<{ offers: Offer[] }>(`/api/pricing/offers?module=${mode}`, fetcher, { revalidateOnFocus: false });
  const offers = data?.offers ?? [];
  const [sel, setSel] = useState<number[]>([]);

  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  async function del(id: number, name: string) {
    if (!confirm(`Изтриване на офертата „${name || "без име"}"?`)) return;
    await fetch(`/api/pricing/offers?module=${mode}&id=${id}`, { method: "DELETE" });
    setSel((s) => s.filter((x) => x !== id));
    mutate();
  }
  const allChecked = offers.length > 0 && sel.length === offers.length;
  const genDoc = () => sel.length && router.push(`${base}/offer-doc?ids=${sel.join(",")}`);

  return (
    <div>
      <PageHeader
        title={
          <>
            {mode === "key" ? <KeyRound size={22} className="text-accent" /> : <Calculator size={22} className="text-accent" />}
            {mode === "key" ? "Оферти — Ключови клиенти" : "Оферти — Private Label"}
          </>
        }
      >
        {sel.length > 0 && (
          <button onClick={genDoc} className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg border border-accent text-accent hover:bg-accent-soft cursor-pointer">
            <FileDown size={16} /> Оферта PDF ({sel.length})
          </button>
        )}
        <Link href={`${base}/offer`} className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer">
          <Plus size={16} /> Нова оферта
        </Link>
      </PageHeader>

      <p className="text-[13px] text-text-3 mb-5">
        {mode === "key"
          ? "Реални цени и себестойности за ключови клиенти (без надценка) — всичко е редактируемо."
          : "Цени за Private Label оферти: суровини (доставна цена от PRIM) + операции = крайна цена без ДДС."}
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-text-3 py-12 justify-center">
          <Loader2 className="animate-spin" size={18} /> Зареждане…
        </div>
      )}
      {!isLoading && offers.length === 0 && (
        <Card className="p-6 text-[14px] text-text-2">
          Още няма оферти. Създай първата с <b>Нова оферта</b>.
        </Card>
      )}
      {offers.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-3">
                <th className="px-3 py-2.5 w-8"><input type="checkbox" checked={allChecked} onChange={(e) => setSel(e.target.checked ? offers.map((o) => o.id) : [])} /></th>
                <th className="text-left font-medium px-4 py-2.5">Продукт</th>
                <th className="text-left font-medium px-4 py-2.5">Клиент</th>
                <th className="text-right font-medium px-4 py-2.5">Цена/опаковка</th>
                <th className="text-right font-medium px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="px-3 py-2.5"><input type="checkbox" checked={sel.includes(o.id)} onChange={() => toggle(o.id)} /></td>
                  <td className="px-4 py-2.5 font-medium text-text">
                    {o.product_name || "—"}
                    <span className="ml-2 text-[10px] font-normal text-text-3 px-1.5 py-0.5 rounded bg-surface-2">{PL_TYPES[o.product_type ?? "tablet"]?.label ?? "Таблетки / Капсули"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-text-2">{o.client || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-accent tabular-nums">{o.total != null ? `${eur(o.total, 3)} €` : "—"}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Link href={`${base}/offer?id=${o.id}`} className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline">
                      <FileText size={14} /> Отвори
                    </Link>
                    <button onClick={() => del(o.id, o.product_name)} className="inline-flex items-center gap-1 text-[12px] text-text-3 hover:text-red-500 ml-3" title="Изтрий">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
