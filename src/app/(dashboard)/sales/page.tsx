"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { StoreSelector } from "@/components/shared/StoreSelector";
import { SalesKpiGrid } from "@/components/sales/SalesKpiGrid";
import { SalesTrend } from "@/components/sales/SalesTrend";

export default function SalesPage() {
  return (
    <>
      <PageHeader title="Продажби">
        <StoreSelector />
        <DateRangePicker />
      </PageHeader>
      <SalesKpiGrid />
      <SalesTrend />
    </>
  );
}
