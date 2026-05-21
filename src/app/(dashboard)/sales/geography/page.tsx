"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { StoreSelector } from "@/components/shared/StoreSelector";
import { Card } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { CountryListPanel } from "@/components/sales/geography/CountryListPanel";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import type { CountrySales, CitySales } from "@/lib/sales-queries";
import type { Metric } from "@/components/sales/geography/WorldMap";

// ============================================================
// /sales/geography — branded world map of where customers buy from.
//
// The WorldMap component pulls in the 106kb world-110m topojson plus
// react-simple-maps runtime — heavy enough that we lazy-load it via
// next/dynamic so the rest of the page can render its skeleton + side
// list while the map streams in. The geography page is a drill-down
// (not landing), so this matches Progressive Disclosure (§7 in the
// platform principles): summary first, details on demand.
//
// Layout:
//
//   Desktop (lg+):
//     ┌──────────────────────────────────┬──────────────┐
//     │                                  │              │
//     │                                  │   Държави    │
//     │      WORLD MAP                   │   (list)     │
//     │      h: 600px                    │              │
//     │                                  │              │
//     │                                  │              │
//     └──────────────────────────────────┴──────────────┘
//
//   Mobile (default):
//     ┌──────────────────────────────────┐
//     │      WORLD MAP                   │
//     │      h: 400px                    │
//     └──────────────────────────────────┘
//     ┌──────────────────────────────────┐
//     │      Държави (list)              │
//     └──────────────────────────────────┘
//
// The map ↔ list are bidirectionally synced: clicking either side
// highlights the matching country on the other. The metric toggle in
// the header swaps which dimension drives the colour ramp (revenue,
// orders, customers).
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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CountriesResponse {
  countries: CountrySales[];
  error?: string;
}

interface CitiesResponse {
  cities: CitySales[];
  error?: string;
}

export default function SalesGeographyPage() {
  const { queryString } = useDateRange();
  const { storeParam } = useStoreSelection();
  const [metric, setMetric] = useState<Metric>("revenue");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  const { data, isLoading, error } = useSWR<CountriesResponse>(
    `/api/sales/geography/countries?${queryString}&${storeParam}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  // City-level pulse markers — separate SWR key so the choropleth can
  // render while the city resolution is still loading. No `keepPreviousData`
  // because the date / store filter genuinely invalidates the marker set.
  const { data: cityData } = useSWR<CitiesResponse>(
    `/api/sales/geography/cities?${queryString}&${storeParam}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  const countries = data?.countries ?? [];
  const cities = cityData?.cities ?? [];

  const metricChip = (
    <div className="inline-flex rounded-md bg-surface-2 p-0.5">
      {(["revenue", "orders", "customers"] as Metric[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMetric(m)}
          className={`
            px-2.5 py-1 rounded text-[12px] font-medium transition-colors
            ${
              metric === m
                ? "bg-surface text-text shadow-xs"
                : "text-text-3 hover:text-text-2"
            }
          `}
        >
          {m === "revenue" ? "Приходи" : m === "orders" ? "Поръчки" : "Клиенти"}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader title="География на продажбите">
        <Link
          href="/sales"
          className="inline-flex items-center gap-1.5 text-[13px] text-text-2 hover:text-text transition-colors"
        >
          <ArrowLeft size={14} />
          Продажби
        </Link>
        {metricChip}
        <StoreSelector />
        <DateRangePicker />
      </PageHeader>

      {error || data?.error ? (
        <Card>
          <div className="p-5 text-center text-[13px] text-text-2">
            Грешка при зареждане на географските данни
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <div className="lg:col-span-8 h-[400px] md:h-[520px] lg:h-[640px]">
            <WorldMap
              data={countries}
              cities={cities}
              metric={metric}
              selectedCountry={selectedCountry}
              onSelectCountry={setSelectedCountry}
            />
          </div>
          <div className="lg:col-span-4 h-[400px] lg:h-[640px]">
            <CountryListPanel
              data={countries}
              metric={metric}
              isLoading={isLoading}
              selectedCountry={selectedCountry}
              onSelectCountry={setSelectedCountry}
            />
          </div>
        </div>
      )}
    </>
  );
}
