"use client";

import useSWR from "swr";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { KpiSkeleton } from "@/components/shared/Skeleton";
import { useDateRange } from "@/hooks/useDateRange";
import type { KpiMetric } from "@/lib/sales-queries";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface StoreKpiResponse {
  revenue: KpiMetric;
  orders: KpiMetric;
  aov: KpiMetric;
  refunded: KpiMetric;
  customers: KpiMetric;
  error?: string;
}

export function StoreKpiGrid({ storeId }: { storeId: string }) {
  const { queryString } = useDateRange();

  const { data, isLoading, error } = useSWR<StoreKpiResponse>(
    `/api/sales/store/${storeId}/kpis?${queryString}`,
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

  if (error || data.error) {
    return (
      <div className="bg-surface rounded-xl shadow-sm p-6 mb-6 text-center">
        <p className="text-[13px] text-text-2">
          Грешка при зареждане на KPI данните
        </p>
      </div>
    );
  }

  const kpis = [
    {
      label: "Приходи",
      value: `${data.revenue.value.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`,
      change: data.revenue.change,
    },
    {
      label: "Поръчки",
      value: String(data.orders.value),
      change: data.orders.change,
    },
    {
      label: "Среден чек",
      value: `${data.aov.value.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`,
      change: data.aov.change,
    },
    {
      label: "Възстановени",
      value: `${data.refunded.value.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`,
      change: data.refunded.change,
    },
    {
      label: "Уникални клиенти",
      value: data.customers.value.toLocaleString("bg-BG"),
      change: data.customers.change,
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
