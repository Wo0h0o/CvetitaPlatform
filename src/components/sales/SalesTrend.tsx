"use client";

import useSWR from "swr";
import { AreaLineChart } from "@/components/charts";
import { TrendingUp } from "lucide-react";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TrendResponse {
  series: { date: string; revenue: number; orders: number }[];
  granularity: string;
  error?: string;
}

export function SalesTrend() {
  const { queryString } = useDateRange();
  const { storeParam } = useStoreSelection();

  const { data, isLoading } = useSWR<TrendResponse>(
    `/api/sales/trend?${queryString}&${storeParam}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  const series = data?.series ?? [];
  const totalRevenue = series.reduce((sum, d) => sum + d.revenue, 0);

  return (
    <AreaLineChart
      data={series}
      xKey="date"
      yKey="revenue"
      title="Тренд на приходите"
      action={
        <div className="flex items-center gap-1.5">
          <TrendingUp size={14} className="text-accent" />
          <span className="text-[14px] font-semibold text-text">
            {totalRevenue.toLocaleString("bg-BG", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            EUR
          </span>
        </div>
      }
      loading={isLoading}
      height={200}
      formatValue={(v) => `${v.toFixed(0)} EUR`}
    />
  );
}
