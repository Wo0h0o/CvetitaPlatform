"use client";

import useSWR from "swr";
import { AreaLineChart } from "@/components/charts";
import { TrendingUp } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ProductsData {
  summary?: { totalRevenue: number };
  timeSeries?: { date: string; revenue: number }[];
}

export function RevenueTrend() {
  const { data, isLoading } = useSWR<ProductsData>(
    "/api/dashboard/products-analytics?preset=30d",
    fetcher,
    { revalidateOnFocus: false }
  );

  const totalRevenue = data?.summary?.totalRevenue || 0;

  return (
    <AreaLineChart
      data={data?.timeSeries || []}
      xKey="date"
      yKey="revenue"
      title="Revenue (30 дни)"
      action={
        <div className="flex items-center gap-1.5">
          <TrendingUp size={14} className="text-accent" />
          <span className="text-[14px] font-semibold text-text">
            {totalRevenue.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
          </span>
        </div>
      }
      loading={isLoading}
      height={200}
      formatValue={(v) => `${v.toFixed(0)} EUR`}
    />
  );
}
