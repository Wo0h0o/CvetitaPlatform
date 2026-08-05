"use client";

import useSWR from "swr";
import { useState } from "react";
import { Factory, Loader2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Row {
  id: string;
  name: string;
  sku: number | string;
  free: number;
  q30: number;
  q90: number;
  d30: number;
  d90: number;
  daily: number;
  cover: number;
  stockout: string;
  suggest: number;
  trend: number;
}

interface Snapshot {
  today?: string;
  buckets: { crit: number; order: number; watch: number; ok: number };
  singles: Row[];
  bundles: Row[];
  noStock: { name: string }[];
}

const nf = (x: number, dp = 0) =>
  x.toLocaleString("bg-BG", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtDate = (s: string) => (s ? s.split("-").reverse().join(".") : "—");

function statusOf(c: number) {
  if (c <= 30) return { k: "crit", t: "КРИТИЧНО" } as const;
  if (c <= 60) return { k: "order", t: "ЗАЯВИ СЕГА" } as const;
  if (c <= 90) return { k: "watch", t: "НАБЛЮДАВАЙ" } as const;
  return { k: "ok", t: "ОК" } as const;
}

const PILL: Record<string, string> = {
  crit: "bg-red-500/15 text-red-600 dark:text-red-400",
  order: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  watch: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  ok: "bg-green-500/15 text-green-600 dark:text-green-400",
};
const STRIPE: Record<string, string> = {
  crit: "border-l-red-500",
  order: "border-l-amber-500",
  watch: "border-l-transparent",
  ok: "border-l-transparent",
};

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  const color: Record<string, string> = {
    crit: "text-red-600 dark:text-red-400",
    order: "text-amber-600 dark:text-amber-400",
    watch: "text-blue-600 dark:text-blue-400",
    ok: "text-green-600 dark:text-green-400",
  };
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-text-3">{label}</div>
      <div className={`text-[30px] font-bold mt-1 ${color[tone]}`}>{value}</div>
    </Card>
  );
}

function ForecastTable({ rows, title, note }: { rows: Row[]; title: string; note: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-[15px] font-semibold text-text">{title}</h3>
        <p className="text-[12px] text-text-3 mt-0.5">{note}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[820px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-text-3">
              <th className="text-left font-medium px-4 py-2.5">Продукт</th>
              <th className="text-right font-medium px-4 py-2.5">Своб.</th>
              <th className="text-right font-medium px-4 py-2.5">Дн. прод.</th>
              <th className="text-center font-medium px-4 py-2.5">Тренд</th>
              <th className="text-right font-medium px-4 py-2.5">Дни до 0</th>
              <th className="text-left font-medium px-4 py-2.5">Изчерпва се</th>
              <th className="text-left font-medium px-4 py-2.5">Статус</th>
              <th className="text-right font-medium px-4 py-2.5">Препоръчано</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = statusOf(r.cover);
              const ti = r.trend >= 1.25 ? "▲" : r.trend <= 0.8 ? "▼" : "·";
              const tc =
                r.trend >= 1.25
                  ? "text-red-500"
                  : r.trend <= 0.8
                    ? "text-green-500"
                    : "text-text-3";
              return (
                <tr
                  key={r.id}
                  className={`border-t border-border border-l-2 ${STRIPE[s.k]}`}
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-text max-w-[320px]">{r.name}</div>
                    <div className="text-[11px] text-text-3">SKU {r.sku}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{nf(r.free)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {nf(r.daily, 1)}
                    <div className="text-[10px] text-text-3">
                      30д {nf(r.d30, 1)} / 90д {nf(r.d90, 1)}
                    </div>
                  </td>
                  <td className={`px-4 py-2.5 text-center ${tc}`}>{ti}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[15px] font-bold text-text">
                    {r.cover > 900 ? ">900" : nf(r.cover)}
                  </td>
                  <td className="px-4 py-2.5 text-text-3 whitespace-nowrap">
                    {r.cover > 900 ? "—" : fmtDate(r.stockout)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${PILL[s.k]}`}>
                      {s.t}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-accent">
                    {r.suggest > 0 ? nf(r.suggest) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function ProductionPage() {
  const { data, isLoading } = useSWR<{
    snapshot: Snapshot | null;
    as_of?: string;
    created_at?: string;
  }>("/api/production/forecast", fetcher, { revalidateOnFocus: false });

  const [showBundles, setShowBundles] = useState(false);
  const snap = data?.snapshot ?? null;

  return (
    <div>
      <PageHeader
        title={
          <>
            <Factory size={22} className="text-accent" /> Производство — прогноза
          </>
        }
      >
        {data?.as_of && (
          <span className="text-[13px] text-text-3">към {fmtDate(data.as_of)}</span>
        )}
      </PageHeader>

      {isLoading && (
        <div className="flex items-center gap-2 text-text-3 py-12 justify-center">
          <Loader2 className="animate-spin" size={18} /> Зареждане…
        </div>
      )}

      {!isLoading && !snap && (
        <Card className="p-6 flex items-start gap-3">
          <AlertTriangle className="text-amber-500 flex-shrink-0" size={20} />
          <div className="text-[14px] text-text-2">
            Още няма качена прогноза. Пусни локалната сутрешна рутина
            <code className="mx-1 px-1.5 py-0.5 rounded bg-surface-2 text-[12px]">/nalichnosti</code>
            — тя изчислява от ПРИМ и качва снимката тук.
          </div>
        </Card>
      )}

      {!isLoading && snap && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard label="Критично ≤30д" value={snap.buckets.crit} tone="crit" />
            <SummaryCard label="Заяви сега 31–60д" value={snap.buckets.order} tone="order" />
            <SummaryCard label="Наблюдавай 61–90д" value={snap.buckets.watch} tone="watch" />
            <SummaryCard label="ОК >90д" value={snap.buckets.ok} tone="ok" />
          </div>

          <ForecastTable
            rows={snap.singles}
            title="Единични продукти — по спешност"
            note='„Дни" = свободна наличност (Офис Склад) ÷ по-бързата дневна скорост (30д/90д). „Препоръчано" = за 45+90 дни покритие.'
          />

          <div>
            <button
              onClick={() => setShowBundles((v) => !v)}
              className="text-[13px] text-text-3 hover:text-text mb-3 cursor-pointer"
            >
              {showBundles ? "▾" : "▸"} Комбо/промо пакети ({snap.bundles.length}) ·
              продава се без запис в Офис Склад ({snap.noStock.length})
            </button>
            {showBundles && (
              <div className="space-y-4">
                <ForecastTable
                  rows={snap.bundles}
                  title="Комбо / промо пакети (справочно)"
                  note="Стоят на отделни SKU; продажбата им изписва и компонентите — да се потвърди дали да ги приспадаме."
                />
                <Card className="p-5">
                  <h3 className="text-[14px] font-semibold text-text mb-2">
                    Продава се, но няма запис в Офис Склад ({snap.noStock.length})
                  </h3>
                  <p className="text-[12px] text-text-3 leading-relaxed">
                    {snap.noStock.map((x) => x.name).join(" · ") || "—"}
                  </p>
                </Card>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
