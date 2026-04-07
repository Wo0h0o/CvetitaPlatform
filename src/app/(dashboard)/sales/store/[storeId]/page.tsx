"use client";

import { use } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { StoreKpiGrid } from "@/components/sales/StoreKpiGrid";
import { StoreTrend } from "@/components/sales/StoreTrend";
import { StoreTopProducts } from "@/components/sales/StoreTopProducts";
import { StoreOrdersTable } from "@/components/sales/StoreOrdersTable";
import { StoreInfo } from "@/components/sales/StoreInfo";
import { ArrowLeft } from "lucide-react";

export default function StoreDetailPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = use(params);

  return (
    <>
      <PageHeader title="Детайли за магазин">
        <Link
          href="/sales"
          className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text transition-colors"
        >
          <ArrowLeft size={14} />
          Продажби
        </Link>
        <DateRangePicker />
      </PageHeader>

      <StoreKpiGrid storeId={storeId} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <StoreTrend storeId={storeId} />
        </div>
        <StoreInfo storeId={storeId} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <StoreOrdersTable storeId={storeId} />
        </div>
        <StoreTopProducts storeId={storeId} />
      </div>
    </>
  );
}
