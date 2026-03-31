"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { Skeleton } from "@/components/shared/Skeleton";
import { RefreshCw } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface NewsItem {
  title: string;
  type: string;
  meta: string;
}

const typeVariant: Record<string, "green" | "red" | "blue" | "orange"> = {
  "Тенденция": "green",
  "Конкурент": "red",
  "Възможност": "orange",
  "Внимание": "red",
};

export function NewsFeed() {
  const { data, isLoading, mutate } = useSWR<NewsItem[]>(
    "/api/news",
    fetcher,
    { revalidateOnFocus: false }
  );

  return (
    <Card>
      <CardHeader
        action={
          <button
            onClick={() => mutate()}
            className="text-[13px] text-accent hover:text-accent-hover font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw size={14} />
            Обнови
          </button>
        }
      >
        Пазарни новини
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-5 w-20 rounded-full flex-shrink-0" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-full mb-1.5" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : data && data.length > 0 ? (
          <div className="space-y-4">
            {data.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 pb-4 border-b border-border last:border-0 last:pb-0"
              >
                <Badge variant={typeVariant[item.type] || "neutral"}>
                  {item.type}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-text leading-snug">
                    {item.title}
                  </div>
                  <div className="text-[12px] text-text-3 mt-0.5">
                    {item.meta}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-text-3 text-[13px]">
            Натисни &quot;Обнови&quot; за актуални новини
          </div>
        )}
      </CardBody>
    </Card>
  );
}
