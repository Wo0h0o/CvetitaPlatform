"use client";

import useSWR from "swr";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/shared/Badge";
import { Skeleton } from "@/components/shared/Skeleton";
import { Plus, ExternalLink } from "lucide-react";
import type { StoreRow } from "@/types/store";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const marketColors: Record<string, "green" | "blue" | "orange" | "red" | "neutral"> = {
  bg: "green",
  gr: "blue",
  ro: "orange",
  hu: "red",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("bg-BG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const columns: Column<StoreRow>[] = [
  {
    key: "name",
    label: "Магазин",
    render: (row) => (
      <span className="inline-flex items-center gap-2">
        <Badge variant={marketColors[row.market_code] ?? "neutral"}>
          {row.market_code.toUpperCase()}
        </Badge>
        <span className="font-medium text-text">{row.name}</span>
      </span>
    ),
    sortFn: (a, b) => a.name.localeCompare(b.name),
  },
  {
    key: "platform",
    label: "Платформа",
    render: (row) => (
      <Badge variant="blue">{row.platform}</Badge>
    ),
  },
  {
    key: "domain",
    label: "Домейн",
    render: (row) =>
      row.domain ? (
        <span className="inline-flex items-center gap-1 text-text-2">
          {row.domain}
          <ExternalLink size={12} />
        </span>
      ) : (
        <span className="text-text-3">—</span>
      ),
    hideOnMobile: true,
  },
  {
    key: "is_active",
    label: "Статус",
    render: (row) => (
      <Badge variant={row.is_active ? "green" : "neutral"}>
        {row.is_active ? "Активен" : "Неактивен"}
      </Badge>
    ),
  },
  {
    key: "created_at",
    label: "Създаден",
    render: (row) => <span className="text-text-2">{fmtDate(row.created_at)}</span>,
    sortFn: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    hideOnMobile: true,
  },
];

export default function StoresPage() {
  const { data, isLoading } = useSWR<{ stores: StoreRow[] }>(
    "/api/stores",
    fetcher,
    { revalidateOnFocus: false }
  );

  const stores = data?.stores ?? [];

  return (
    <>
      <PageHeader title="Магазини">
        <Link href="/settings/stores/new">
          <Button>
            <Plus size={16} />
            Добави магазин
          </Button>
        </Link>
      </PageHeader>

      <Card>
        <CardBody>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <DataTable
              columns={columns}
              data={stores}
              rowKey={(row) => row.id}
              pageSize={20}
              renderMobileCard={(row) => (
                <div className="bg-surface-2 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2">
                      <Badge variant={marketColors[row.market_code] ?? "neutral"}>
                        {row.market_code.toUpperCase()}
                      </Badge>
                      <span className="font-medium text-text">{row.name}</span>
                    </span>
                    <Badge variant={row.is_active ? "green" : "neutral"}>
                      {row.is_active ? "Активен" : "Неактивен"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-[12px] text-text-2">
                    <span>{row.platform}</span>
                    <span>{row.domain ?? "—"}</span>
                  </div>
                </div>
              )}
              emptyMessage="Няма добавени магазини"
            />
          )}
        </CardBody>
      </Card>
    </>
  );
}
