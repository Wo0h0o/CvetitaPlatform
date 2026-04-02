"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
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

  if (isLoading) {
    return (
      <Card>
        <CardBody><Skeleton className="h-40 w-full" /></CardBody>
      </Card>
    );
  }

  const series = data?.timeSeries || [];
  const totalRevenue = data?.summary?.totalRevenue || 0;
  const maxRevenue = series.length > 0 ? Math.max(...series.map((d) => d.revenue)) : 0;

  return (
    <Card className="flex flex-col">
      <CardHeader
        action={
          <div className="flex items-center gap-1.5">
            <TrendingUp size={14} className="text-accent" />
            <span className="text-[14px] font-semibold text-text">
              {totalRevenue.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
            </span>
          </div>
        }
      >
        Revenue (30 дни)
      </CardHeader>
      <CardBody className="flex-1 flex flex-col">
        {series.length > 1 ? (
          <div className="flex-1 flex flex-col">
            <div className="flex items-end gap-[2px] h-32">
              {series.map((d) => {
                const pct = maxRevenue > 0 ? (d.revenue / maxRevenue) * 100 : 0;
                return (
                  <div
                    key={d.date}
                    className="flex-1 bg-accent/20 hover:bg-accent/40 rounded-t transition-colors relative group"
                    style={{ height: `${Math.max(pct, 2)}%` }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-text text-surface text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                      {d.date}: {d.revenue.toFixed(2)} EUR
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-[11px] text-text-2">
              <span>{series[0]?.date}</span>
              <span>{series[series.length - 1]?.date}</span>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-text-2 text-[13px]">Няма данни</div>
        )}
      </CardBody>
    </Card>
  );
}
