"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { Skeleton } from "@/components/shared/Skeleton";
import { Link2, Globe } from "lucide-react";
import type { StoreRow } from "@/types/store";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Connection {
  service: string;
  status: string;
  connectedAt: string;
}

interface ConnectionsResponse {
  store: StoreRow;
  connections: Connection[];
  error?: string;
}

const connectionStatus: Record<string, "green" | "red" | "orange"> = {
  active: "green",
  expired: "red",
  error: "red",
};

export function StoreInfo({ storeId }: { storeId: string }) {
  const { data, isLoading } = useSWR<ConnectionsResponse>(
    `/api/sales/store/${storeId}/connections`,
    fetcher,
    { refreshInterval: 600_000, revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <Skeleton className="h-24 w-full" />
        </CardBody>
      </Card>
    );
  }

  const store = data?.store;
  const connections = data?.connections ?? [];

  if (!store) return null;

  return (
    <Card>
      <CardHeader>
        <span className="inline-flex items-center gap-2">
          <Link2 size={16} />
          Информация
        </span>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-text-2">Платформа</span>
          <Badge variant="blue">{store.platform}</Badge>
        </div>
        {store.domain && (
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-text-2">Домейн</span>
            <span className="inline-flex items-center gap-1 text-text">
              <Globe size={12} />
              {store.domain}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-text-2">Пазар</span>
          <Badge variant="green">{store.market_code.toUpperCase()}</Badge>
        </div>

        {connections.length > 0 && (
          <>
            <div className="border-t border-border pt-3 mt-3">
              <div className="text-[12px] font-semibold text-text-2 mb-2">Интеграции</div>
              <div className="space-y-2">
                {connections.map((c) => (
                  <div key={c.service} className="flex items-center justify-between text-[13px]">
                    <span className="text-text capitalize">{c.service}</span>
                    <Badge variant={connectionStatus[c.status] ?? "neutral"}>
                      {c.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
