"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/shared/Badge";
import { Skeleton } from "@/components/shared/Skeleton";
import { useDateRange } from "@/hooks/useDateRange";
import { ShoppingCart } from "lucide-react";
import type { OrderRow } from "@/lib/sales-queries";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtEur(n: number) {
  return `${n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("bg-BG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const statusVariant: Record<string, "green" | "orange" | "red" | "blue" | "neutral"> = {
  paid: "green",
  pending: "orange",
  authorized: "blue",
  partially_refunded: "orange",
  refunded: "red",
  voided: "red",
  partially_paid: "orange",
};

const STATUS_LABEL_BG: Record<string, string> = {
  paid: "Платена",
  pending: "Чакаща",
  authorized: "Авторизирана",
  partially_refunded: "Частично възстановена",
  refunded: "Възстановена",
  voided: "Анулирана",
  partially_paid: "Частично платена",
};

const fulfillmentVariant: Record<string, "green" | "orange" | "neutral"> = {
  fulfilled: "green",
  partial: "orange",
  unfulfilled: "neutral",
};

const FULFILLMENT_LABEL_BG: Record<string, string> = {
  fulfilled: "Изпратена",
  partial: "Частична",
  unfulfilled: "Неизпратена",
};

const columns: Column<OrderRow>[] = [
  {
    key: "shopify_order_number",
    label: "#",
    render: (row) => (
      <span className="font-medium text-text">#{row.shopify_order_number}</span>
    ),
    sortFn: (a, b) => Number(a.shopify_order_number) - Number(b.shopify_order_number),
  },
  {
    key: "shopify_created_at",
    label: "Дата",
    render: (row) => <span className="text-text-2">{fmtDate(row.shopify_created_at)}</span>,
    sortFn: (a, b) =>
      new Date(a.shopify_created_at).getTime() - new Date(b.shopify_created_at).getTime(),
  },
  {
    key: "email",
    label: "Клиент",
    render: (row) => (
      <span className="text-text-2 truncate max-w-[180px] inline-block">
        {row.email || "—"}
      </span>
    ),
    hideOnMobile: true,
  },
  {
    key: "total_price",
    label: "Сума",
    className: "text-right",
    render: (row) => <span className="font-medium">{fmtEur(row.total_price)}</span>,
    sortFn: (a, b) => a.total_price - b.total_price,
  },
  {
    key: "financial_status",
    label: "Плащане",
    render: (row) => (
      <Badge variant={statusVariant[row.financial_status] ?? "neutral"}>
        {STATUS_LABEL_BG[row.financial_status] ?? row.financial_status}
      </Badge>
    ),
    hideOnMobile: true,
  },
  {
    key: "fulfillment_status",
    label: "Доставка",
    render: (row) => (
      <Badge variant={fulfillmentVariant[row.fulfillment_status ?? "unfulfilled"] ?? "neutral"}>
        {FULFILLMENT_LABEL_BG[row.fulfillment_status ?? "unfulfilled"] ?? row.fulfillment_status ?? "Неизпратена"}
      </Badge>
    ),
    hideOnMobile: true,
  },
];

interface OrdersResponse {
  orders: OrderRow[];
  total: number;
  error?: string;
}

export function StoreOrdersTable({ storeId }: { storeId: string }) {
  const { queryString } = useDateRange();

  const { data, isLoading } = useSWR<OrdersResponse>(
    `/api/sales/store/${storeId}/orders?${queryString}&limit=50`,
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

  const orders = data?.orders ?? [];

  return (
    <Card>
      <CardHeader
        action={
          <span className="text-[12px] text-text-3">
            {data?.total ?? 0} поръчки
          </span>
        }
      >
        <span className="inline-flex items-center gap-2">
          <ShoppingCart size={16} />
          Поръчки
        </span>
      </CardHeader>
      <CardBody>
        <DataTable
          columns={columns}
          data={orders}
          rowKey={(row) => String(row.shopify_order_id)}
          pageSize={15}
          renderMobileCard={(row) => (
            <div className="bg-surface-2 rounded-lg p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-text text-[14px]">
                  #{row.shopify_order_number}
                </span>
                <span className="font-medium text-text text-[14px]">
                  {fmtEur(row.total_price)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-text-2">{fmtDate(row.shopify_created_at)}</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant={statusVariant[row.financial_status] ?? "neutral"}>
                    {STATUS_LABEL_BG[row.financial_status] ?? row.financial_status}
                  </Badge>
                  <Badge variant={fulfillmentVariant[row.fulfillment_status ?? "unfulfilled"] ?? "neutral"}>
                    {FULFILLMENT_LABEL_BG[row.fulfillment_status ?? "unfulfilled"] ?? row.fulfillment_status ?? "Неизпратена"}
                  </Badge>
                </div>
              </div>
              {row.email && (
                <div className="text-[12px] text-text-3 truncate">{row.email}</div>
              )}
            </div>
          )}
          emptyMessage="Няма поръчки за избрания период"
        />
      </CardBody>
    </Card>
  );
}
