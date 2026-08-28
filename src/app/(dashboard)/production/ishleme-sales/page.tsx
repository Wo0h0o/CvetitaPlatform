"use client";

import useSWR from "swr";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Loader2, FileText, RefreshCw, User } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface SaleItem { item_id: string; name: string; sku: string; qty: number }
interface Sale { num: string; date: string; partner: string; partner_eik?: string; items: SaleItem[] }

const nf = (x: number) => x.toLocaleString("bg-BG");
const fmt = (s: string) => (s ? s.split("-").reverse().join(".") : "—");

export default function IshlemeSalesPage() {
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR<{ snapshot: { ishlemeSales?: Sale[] } | null }>(
    "/api/production/forecast",
    fetcher,
    { revalidateOnFocus: false }
  );
  const [syncing, setSyncing] = useState(false);
  const sales = data?.snapshot?.ishlemeSales ?? [];

  const syncNow = async () => {
    setSyncing(true);
    try {
      await fetch("/api/production/sync", { method: "POST" });
      await mutate();
    } finally {
      setSyncing(false);
    }
  };

  const createLetter = (sale: Sale) => {
    const sel = sale.items.map((it) => `${it.item_id}~${it.qty}`).join(",");
    const firma = sale.partner_eik ? `&firma=${encodeURIComponent(sale.partner_eik)}` : "";
    router.push(`/production/zayavka?sel=${encodeURIComponent(sel)}&so=${encodeURIComponent(sale.num)}${firma}`);
  };

  return (
    <div>
      <PageHeader
        title={
          <>
            <ShoppingCart size={22} className="text-accent" /> Ишлеме продажби
          </>
        }
      >
        <button
          onClick={syncNow}
          disabled={syncing}
          className="flex items-center gap-2 text-[13px] font-medium px-3 py-2 rounded-lg border border-border text-text-2 hover:bg-surface-2 cursor-pointer disabled:opacity-50"
          title="Дръпни най-новите продажби от PRIM"
        >
          <RefreshCw size={15} className={syncing ? "animate-spin" : ""} /> {syncing ? "Обновявам…" : "Обнови от PRIM"}
        </button>
      </PageHeader>
      <p className="text-[13px] text-text-3 mb-5">
        Продажби на ишлеме продукти от последните 30 дни. С един бутон създай възлагателно писмо за производство от продажбата.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-text-3 py-12 justify-center">
          <Loader2 className="animate-spin" size={18} /> Зареждане…
        </div>
      )}

      {!isLoading && sales.length === 0 && (
        <Card className="p-6 text-[14px] text-text-2">
          Няма ишлеме продажби за последните 30 дни. Създай продажба в PRIM и натисни <b>Обнови от PRIM</b>.
        </Card>
      )}

      <div className="space-y-4">
        {sales.map((s) => {
          const total = s.items.reduce((a, it) => a + it.qty, 0);
          return (
            <Card key={s.num} className="overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-[15px] font-semibold text-text">Продажба {s.num}</h3>
                  <p className="text-[12px] text-text-3 mt-0.5 flex items-center gap-1.5">
                    <User size={13} /> {s.partner || "—"} · {fmt(s.date)} · {s.items.length} продукта · {nf(total)} бр
                  </p>
                </div>
                <button
                  onClick={() => createLetter(s)}
                  className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer"
                >
                  <FileText size={16} /> Създай възлагателно писмо
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[480px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-text-3">
                      <th className="text-left font-medium px-4 py-2">Продукт</th>
                      <th className="text-right font-medium px-4 py-2">Количество</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.items.map((it, i) => (
                      <tr key={it.item_id + i} className="border-t border-border">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-text">{it.name}</div>
                          <div className="text-[11px] text-text-3">SKU {it.sku}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{nf(it.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
