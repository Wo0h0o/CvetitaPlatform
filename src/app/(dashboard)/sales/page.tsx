"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useAnalyticsSWR } from "@/hooks/useAnalyticsSWR";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricChips } from "@/components/shared/MetricChips";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { StoreSelector } from "@/components/shared/StoreSelector";
import { Card } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { SalesHeroStrip } from "@/components/sales/SalesHeroStrip";
import { SalesSignalStrip } from "@/components/sales/SalesSignalStrip";
import { SalesTrend } from "@/components/sales/SalesTrend";
import { SalesRhythmPanel } from "@/components/sales/SalesRhythmPanel";
import { TopProductsAggregate } from "@/components/sales/TopProductsAggregate";
import { CountryListPanel } from "@/components/sales/geography/CountryListPanel";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import type {
  CountrySales,
  CitySales,
  OfficePoint,
} from "@/lib/sales-queries";
import type { Metric } from "@/components/sales/geography/WorldMap";

// ============================================================
// /sales — single landing surface for the sales story.
//
//   1. Hero strip      — Приходи + Поръчки + Среден чек
//   2. Signal strip    — secondary KPIs (клиенти, refund, top SKU…)
//   3. Тренд           — full-width revenue line with comparison overlay
//   4. География       — world map + countries side panel. Folded in
//                        from the standalone /sales/geography route so
//                        the dashboard tells the "where from" story at
//                        a glance, not behind a click. The Countries
//                        list to the right of the map replaces the
//                        prior Магазини table below — for our 1:1
//                        store↔country shape they answer the same
//                        question, and two adjacent right-rail lists
//                        of the same markets read as duplication.
//   5. Топ продукти    — full-width (gets to breathe now that its
//                        former row companion is gone).
//   6. Ритъм / Пулс    — adaptive "when do customers buy?":
//                          • single-day window → 24h combo (Пулс)
//                          • multi-day window  → 7 weekday small
//                            multiples + 24h aggregate strip (Ритъм)
//                        Replaces the prior 7×24 heatmap — that view
//                        now lives on /sales/store/[id] as the
//                        drill-down "full matrix" surface.
//
// The metric chip (Приходи/Поръчки/Клиенти) lives inside the География
// section header — it only changes what the map and the Countries
// list paint, not the hero/trend numbers above. Putting it in the
// page-level PageHeader would imply it controls everything, which is
// wrong and confusing.
// ============================================================

const WorldMap = dynamic(
  () =>
    import("@/components/sales/geography/WorldMap").then((m) => m.WorldMap),
  {
    ssr: false,
    loading: () => (
      <Card className="h-full">
        <Skeleton className="h-full w-full rounded-xl" />
      </Card>
    ),
  }
);

interface CountriesResponse {
  countries: CountrySales[];
  error?: string;
}

interface CitiesResponse {
  cities: CitySales[];
  error?: string;
}

interface OrderPointsResponse {
  points: OfficePoint[];
  error?: string;
}

export default function SalesPage() {
  const { queryString } = useDateRange();
  const { storeParam } = useStoreSelection();
  const [metric, setMetric] = useState<Metric>("revenue");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  // Three parallel SWR sources — choropleth outlines + city centroids
  // fallback + per-office points. The map renders progressively as
  // each lands; the side panel only needs the countries call.
  const { data: countriesData, isLoading } = useAnalyticsSWR<CountriesResponse>(
    `/api/sales/geography/countries?${queryString}&${storeParam}`
  );
  const { data: citiesData } = useAnalyticsSWR<CitiesResponse>(
    `/api/sales/geography/cities?${queryString}&${storeParam}`
  );
  const { data: orderPointsData } = useAnalyticsSWR<OrderPointsResponse>(
    `/api/sales/geography/order-points?${queryString}&${storeParam}`
  );

  const countries = countriesData?.countries ?? [];
  const cities = citiesData?.cities ?? [];
  const orderPoints = orderPointsData?.points ?? [];

  const metricChip = (
    <MetricChips<Metric>
      value={metric}
      onChange={setMetric}
      options={[
        { value: "revenue", label: "Приходи" },
        { value: "orders", label: "Поръчки" },
        { value: "customers", label: "Клиенти" },
      ]}
    />
  );

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

      {/* География — section header carries the metric chip so its
          scope is unambiguous. Same 8/4 split as the prior standalone
          page; slightly shorter overall height because the page is
          dense already. */}
      <div className="mb-4 md:mb-6">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-[15px] font-semibold text-text">География</h2>
          {metricChip}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <div className="lg:col-span-8 h-[400px] md:h-[520px] lg:h-[600px]">
            <WorldMap
              data={countries}
              cities={cities}
              orderPoints={orderPoints}
              metric={metric}
              selectedCountry={selectedCountry}
              onSelectCountry={setSelectedCountry}
            />
          </div>
          <div className="lg:col-span-4 h-[400px] lg:h-[600px]">
            <CountryListPanel
              data={countries}
              metric={metric}
              isLoading={isLoading}
              selectedCountry={selectedCountry}
              onSelectCountry={setSelectedCountry}
            />
          </div>
        </div>
      </div>

      <div className="mb-4 md:mb-6">
        <TopProductsAggregate />
      </div>

      <div className="mb-4 md:mb-6">
        <SalesRhythmPanel />
      </div>
    </>
  );
}
