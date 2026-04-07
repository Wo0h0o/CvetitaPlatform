"use client";

import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { ChangeBadge, Badge } from "@/components/shared/Badge";
import { Skeleton } from "@/components/shared/Skeleton";
import { useDateRange } from "@/hooks/useDateRange";
import type { StorePerformance } from "@/lib/sales-queries";
import { Store } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const marketColors: Record<string, "green" | "blue" | "orange" | "red"> = {
  bg: "green",
  gr: "blue",
  ro: "orange",
  hu: "red",
};

function fmtEur(n: number) {
  return `${n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

interface StorePerformanceResponse {
  stores: StorePerformance[];
  error?: string;
}

const columns: Column<StorePerformance>[] = [
  {
    key: "storeName",
    label: "Магазин",
    render: (row) => (
      <span className="inline-flex items-center gap-2">
        <Badge variant={marketColors[row.marketCode] ?? "neutral"}>
          {row.marketCode.toUpperCase()}
        </Badge>
        <span className="font-medium text-text">{row.storeName}</span>
      </span>
    ),
    sortFn: (a, b) => a.storeName.localeCompare(b.storeName),
  },
  {
    key: "revenue",
    label: "Приходи",
    className: "text-right",
    render: (row) => <span className="font-medium">{fmtEur(row.revenue)}</span>,
    sortFn: (a, b) => a.revenue - b.revenue,
  },
  {
    key: "revenueChange",
    label: "Δ Приходи",
    className: "text-right",
    render: (row) => <ChangeBadge value={row.revenueChange} />,
    sortFn: (a, b) => (a.revenueChange ?? 0) - (b.revenueChange ?? 0),
    hideOnMobile: true,
  },
  {
    key: "orders",
    label: "Поръчки",
    className: "text-right",
    render: (row) => row.orders.toLocaleString("bg-BG"),
    sortFn: (a, b) => a.orders - b.orders,
  },
  {
    key: "ordersChange",
    label: "Δ Поръчки",
    className: "text-right",
    render: (row) => <ChangeBadge value={row.ordersChange} />,
    sortFn: (a, b) => (a.ordersChange ?? 0) - (b.ordersChange ?? 0),
    hideOnMobile: true,
  },
  {
    key: "aov",
    label: "AOV",
    className: "text-right",
    render: (row) => fmtEur(row.aov),
    sortFn: (a, b) => a.aov - b.aov,
    hideOnMobile: true,
  },
];

export function StorePerformanceTable() {
  const { queryString } = useDateRange();
  const router = useRouter();

  const { data, isLoading } = useSWR<StorePerformanceResponse>(
    `/api/sales/store-performance?${queryString}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <Skeleton className="h-32 w-full" />
        </CardBody>
      </Card>
    );
  }

  const stores = data?.stores ?? [];

  if (stores.length <= 1) return null; // No point showing table for single store

  return (
    <Card>
      <CardHeader
        action={
          <span className="text-[12px] text-text-3">{stores.length} магазина</span>
        }
      >
        <span className="inline-flex items-center gap-2">
          <Store size={16} />
          Представяне по магазин
        </span>
      </CardHeader>
      <CardBody>
        <DataTable
          columns={columns}
          data={stores}
          rowKey={(row) => row.storeId}
          pageSize={0}
          onRowClick={(row) => router.push(`/sales/store/${row.storeId}`)}
          renderMobileCard={(row) => (
            <div className="bg-surface-2 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <Badge variant={marketColors[row.marketCode] ?? "neutral"}>
                    {row.marketCode.toUpperCase()}
                  </Badge>
                  <span className="font-medium text-text text-[14px]">{row.storeName}</span>
                </span>
                <ChangeBadge value={row.revenueChange} />
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-text-2">Приходи</span>
                <span className="font-medium text-text">{fmtEur(row.revenue)}</span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-text-2">Поръчки</span>
                <span className="text-text">{row.orders}</span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-text-2">AOV</span>
                <span className="text-text">{fmtEur(row.aov)}</span>
              </div>
            </div>
          )}
          emptyMessage="Няма данни за магазини"
        />
      </CardBody>
    </Card>
  );
}
