"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import { Package } from "lucide-react";
import type { TopProduct } from "@/lib/sales-queries";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtEur(n: number) {
  return n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface TopProductsResponse {
  products: TopProduct[];
  error?: string;
}

export function TopProductsAggregate() {
  const { queryString } = useDateRange();
  const { storeParam } = useStoreSelection();

  const { data, isLoading } = useSWR<TopProductsResponse>(
    `/api/sales/top-products?${queryString}&${storeParam}&limit=10`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <Skeleton className="h-48 w-full" />
        </CardBody>
      </Card>
    );
  }

  const products = data?.products ?? [];
  const maxRevenue = products.length > 0 ? products[0].revenue : 0;

  return (
    <Card>
      <CardHeader
        action={
          <span className="text-[12px] text-text-3">Топ 10</span>
        }
      >
        <span className="inline-flex items-center gap-2">
          <Package size={16} />
          Топ продукти
        </span>
      </CardHeader>
      <CardBody className="space-y-2">
        {products.length === 0 ? (
          <div className="text-center py-8 text-text-2 text-[13px]">
            Няма данни за продукти
          </div>
        ) : (
          products.map((p, i) => (
            <div key={p.title} className="flex items-center gap-3">
              <span className="text-[12px] text-text-3 w-5 text-right flex-shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[13px] text-text truncate">{p.title}</span>
                  <span className="text-[13px] font-medium text-text flex-shrink-0">
                    {fmtEur(p.revenue)} EUR
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-300"
                      style={{ width: `${maxRevenue > 0 ? (p.revenue / maxRevenue) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-text-3 flex-shrink-0">
                    {p.quantity} бр.
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}
