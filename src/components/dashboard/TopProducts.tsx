"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { Package } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TopProduct {
  title: string;
  quantity: number;
  revenue: number;
}

export function TopProducts() {
  const { data, isLoading, error } = useSWR<TopProduct[]>(
    "/api/dashboard/top-products",
    fetcher,
    { refreshInterval: 300_000 }
  );

  return (
    <Card>
      <CardHeader>Топ продукти днес</CardHeader>
      <CardBody>
        {error ? (
          <div className="flex flex-col items-center justify-center py-8 text-text-3">
            <Package size={24} className="mb-2 opacity-50" />
            <span className="text-[13px] text-text-2">Грешка при зареждане</span>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : data && data.length > 0 ? (
          <div className="space-y-1">
            {data.map((product, i) => (
              <div
                key={product.title}
                className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-accent-soft text-accent text-[12px] font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-text truncate">
                    {product.title}
                  </div>
                  <div className="text-[12px] text-text-2">
                    {product.quantity} бр.
                  </div>
                </div>
                <div className="text-[14px] font-semibold text-text flex-shrink-0">
                  {product.revenue.toFixed(2)} EUR
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-text-3">
            <Package size={24} className="mb-2 opacity-50" />
            <span className="text-[13px] text-text-2">Все още няма поръчки днес</span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
