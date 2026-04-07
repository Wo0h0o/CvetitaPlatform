"use client";

import useSWR from "swr";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { StoreWizard } from "@/components/onboarding/StoreWizard";
import { Skeleton } from "@/components/shared/Skeleton";
import { ArrowLeft } from "lucide-react";
import type { StoreRow } from "@/types/store";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function NewStorePage() {
  // Get org ID from existing stores — all stores belong to the same org
  const { data, isLoading } = useSWR<{ stores: StoreRow[] }>(
    "/api/stores",
    fetcher,
    { revalidateOnFocus: false }
  );

  const organizationId = data?.stores?.[0]?.organization_id;

  return (
    <>
      <PageHeader title="Нов магазин">
        <Link
          href="/settings/stores"
          className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text transition-colors"
        >
          <ArrowLeft size={14} />
          Магазини
        </Link>
      </PageHeader>

      {isLoading ? (
        <div className="max-w-2xl mx-auto">
          <Skeleton className="h-60 w-full" />
        </div>
      ) : organizationId ? (
        <StoreWizard organizationId={organizationId} />
      ) : (
        <div className="max-w-2xl mx-auto text-center py-12 text-text-2 text-[14px]">
          Не е намерена организация. Моля свържете се с администратор.
        </div>
      )}
    </>
  );
}
