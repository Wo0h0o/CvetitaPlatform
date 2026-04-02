"use client";

import useSWR from "swr";
import { KpiCard } from "./KpiCard";
import { KpiSkeleton } from "@/components/shared/Skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface KpiResponse {
  sales: { value: number; change: number };
  orders: { value: number; change: number };
  aov: { value: number; change: number };
  sessions: { value: number; change: number };
  conversionRate: { value: number; change: number };
}

export function KpiGrid() {
  const { data, isLoading, error } = useSWR<KpiResponse>(
    "/api/dashboard/kpis",
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-xl shadow-sm p-6 mb-6 text-center">
        <p className="text-[13px] text-text-3">Грешка при зареждане на KPI данните</p>
      </div>
    );
  }

  const kpis = [
    {
      label: "Продажби днес",
      value: `${data.sales.value.toLocaleString("bg-BG")} EUR`,
      change: data.sales.change,
    },
    {
      label: "Поръчки",
      value: String(data.orders.value),
      change: data.orders.change,
    },
    {
      label: "Среден чек",
      value: `${data.aov.value.toFixed(2)} EUR`,
      change: data.aov.change,
    },
    {
      label: "Сесии",
      value: data.sessions.value.toLocaleString("bg-BG"),
      change: data.sessions.change,
    },
    {
      label: "Конверсия",
      value: `${data.conversionRate.value.toFixed(2)}%`,
      change: data.conversionRate.change,
      suffix: "пп",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.label} {...kpi} />
      ))}
    </div>
  );
}
