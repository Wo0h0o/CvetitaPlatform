"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { TrendingUp } from "lucide-react";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import { formatBgDate } from "@/lib/dates";

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

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <Skeleton className="h-40 w-full" />
        </CardBody>
      </Card>
    );
  }

  const series = data?.series ?? [];
  const totalRevenue = series.reduce((sum, d) => sum + d.revenue, 0);
  const maxRevenue =
    series.length > 0 ? Math.max(...series.map((d) => d.revenue)) : 0;

  return (
    <Card className="flex flex-col">
      <CardHeader
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
      >
        Тренд на приходите
      </CardHeader>
      <CardBody className="flex-1 flex flex-col">
        {series.length > 1 ? (
          <div className="flex-1 flex flex-col">
            <div className="flex items-end gap-[2px] h-32">
              {series.map((d) => {
                const pct =
                  maxRevenue > 0 ? (d.revenue / maxRevenue) * 100 : 0;
                return (
                  <div
                    key={d.date}
                    className="flex-1 bg-accent/20 hover:bg-accent/40 rounded-t transition-colors relative group"
                    style={{ height: `${Math.max(pct, 2)}%` }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-text text-surface text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                      {formatBgDate(d.date)}: {d.revenue.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
                      <br />
                      {d.orders} поръчки
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-[11px] text-text-2">
              <span>{formatBgDate(series[0].date)}</span>
              <span>{formatBgDate(series[series.length - 1].date)}</span>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-text-2 text-[13px]">
            Няма данни за избрания период
          </div>
        )}
      </CardBody>
    </Card>
  );
}
