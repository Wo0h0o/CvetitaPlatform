"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { StoreSelector } from "@/components/shared/StoreSelector";
import { SalesHeroStrip } from "@/components/sales/SalesHeroStrip";
import { SalesSignalStrip } from "@/components/sales/SalesSignalStrip";
import { SalesTrend } from "@/components/sales/SalesTrend";
import { SalesHourHeatmap } from "@/components/sales/SalesHourHeatmap";
import { StorePerformanceTable } from "@/components/sales/StorePerformanceTable";
import { TopProductsAggregate } from "@/components/sales/TopProductsAggregate";

// ============================================================
// /sales — three deliberate zones, deliberately asymmetric.
//
//   1. Hero strip      — Приходи (6) + Поръчки (3) + Среден чек (3)
//                        with sparklines + delta + "Най-силен ден" sub.
//
//   2. Signal strip    — 5 micro-tiles answering the secondary questions
//                        (клиенти, ст-ст/клиент, refund, top SKU, top market).
//                        Mobile = horizontal snap carousel.
//
//   3. Trend           — full-width revenue line with comparison overlay
//                        + peak annotation. The "how is the period
//                        shaped" answer.
//
//   4. Breakdown row   — Топ продукти (lg:7) + Магазини (lg:5).
//                        Asymmetric so the products card breathes.
//
// Mobile order is identical to desktop — stacking is implicit because the
// 12-col grid degrades to grid-cols-1 below `lg`. No mobile-specific
// reordering needed.
// ============================================================

export default function SalesPage() {
  return (
    <>
      <PageHeader title="Продажби">
        <StoreSelector />
        <DateRangePicker />
      </PageHeader>

      <SalesHeroStrip />
      <SalesSignalStrip />

      <div className="mb-4 md:mb-6">
        <SalesTrend />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 mb-4 md:mb-6">
        <div className="lg:col-span-7">
          <TopProductsAggregate />
        </div>
        <div className="lg:col-span-5">
          <StorePerformanceTable />
        </div>
      </div>

      <div className="mb-4 md:mb-6">
        <SalesHourHeatmap />
      </div>
    </>
  );
}
