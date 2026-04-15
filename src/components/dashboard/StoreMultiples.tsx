"use client";

import useSWR from "swr";
import { Skeleton } from "@/components/shared/Skeleton";
import { StoreCard, type StoreCardData } from "./StoreCard";

// ============================================================
// Types (mirror /api/dashboard/home/stores response)
// ============================================================

interface StoresResponse {
  stores: StoreCardData[];
  error?: string;
}

// ============================================================
// Loading skeleton — mirrors StoreCard shape (header + sparkline + stats)
// ============================================================

function StoreCardSkeleton() {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5 border-l-4 border-l-transparent">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-10 w-full mb-4" />
      <Skeleton className="h-6 w-32 mb-1.5" />
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-5 w-28" />
    </div>
  );
}

// ============================================================
// StoreMultiples
// ============================================================

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function StoreMultiples() {
  const { data, isLoading, error } = useSWR<StoresResponse>(
    "/api/dashboard/home/stores",
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false }
  );

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-text">Магазини</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        {isLoading || !data ? (
          Array.from({ length: 3 }).map((_, i) => <StoreCardSkeleton key={i} />)
        ) : error || data.error ? (
          <div className="col-span-full bg-surface rounded-xl shadow-sm p-5 text-center text-[13px] text-text-2">
            Грешка при зареждане на магазините
          </div>
        ) : (
          data.stores.map((store) => <StoreCard key={store.marketCode} data={store} />)
        )}
      </div>
    </section>
  );
}
