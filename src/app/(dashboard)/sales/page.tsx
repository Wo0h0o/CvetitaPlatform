"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { StoreSelector } from "@/components/shared/StoreSelector";
import { SalesKpiGrid } from "@/components/sales/SalesKpiGrid";
import { SalesTrend } from "@/components/sales/SalesTrend";
import { StorePerformanceTable } from "@/components/sales/StorePerformanceTable";
import { TopProductsAggregate } from "@/components/sales/TopProductsAggregate";

export default function SalesPage() {
  return (
    <>
      <PageHeader title="Продажби">
        <StoreSelector />
        <DateRangePicker />
      </PageHeader>
      <SalesKpiGrid />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <SalesTrend />
        <TopProductsAggregate />
      </div>
      <StorePerformanceTable />
    </>
  );
}
