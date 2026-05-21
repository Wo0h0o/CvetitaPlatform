"use client";

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { MarketFlag } from "@/components/shared/MarketFlag";
import { countryDisplayName } from "@/lib/geo/country-codes";
import type { CountrySales } from "@/lib/sales-queries";
import type { Metric } from "./WorldMap";

// ============================================================
// CountryListPanel — the side rail next to the world map.
//
// Lists countries with sales in the period, sorted desc by the active
// metric. Rows are bidirectionally synced with the map:
//   * Click a row → selects the country on the map (accent stroke)
//   * Click on the map → highlights the matching row + scrolls it into view
//
// The first row is treated as the "anchor": shows its share of total
// revenue inline ("94% от приходи") as a contextual headline. Helps the
// operator read concentration without computing.
// ============================================================

interface CountryListPanelProps {
  data: CountrySales[];
  metric: Metric;
  isLoading: boolean;
  selectedCountry: string | null;
  onSelectCountry: (alpha2: string | null) => void;
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString("bg-BG")} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG");
}

function METRIC_LABEL(m: Metric): string {
  return m === "revenue" ? "Приходи" : m === "orders" ? "Поръчки" : "Клиенти";
}

function valueForMetric(c: CountrySales, m: Metric): number {
  return m === "revenue" ? c.revenue : m === "orders" ? c.orders : c.customers;
}

function formatValue(v: number, m: Metric): string {
  if (m === "revenue") return fmtEur(v);
  return fmtInt(v);
}

export function CountryListPanel({
  data,
  metric,
  isLoading,
  selectedCountry,
  onSelectCountry,
}: CountryListPanelProps) {
  // Sort by the active metric — the map renders the same hierarchy via
  // colour intensity, so the list mirrors what the eye sees.
  const sorted = useMemo(() => {
    return [...data].sort(
      (a, b) => valueForMetric(b, metric) - valueForMetric(a, metric)
    );
  }, [data, metric]);

  const total = useMemo(
    () => sorted.reduce((s, c) => s + valueForMetric(c, metric), 0),
    [sorted, metric]
  );

  const topShare =
    sorted.length > 0 && total > 0
      ? Math.round((valueForMetric(sorted[0], metric) / total) * 100)
      : null;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader>Държави</CardHeader>
        <CardBody className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader
        action={
          topShare !== null ? (
            <span className="text-[11px] text-text-3 tabular-nums">
              Топ:{" "}
              <span className="text-text font-semibold">{topShare}%</span>{" "}
              {METRIC_LABEL(metric).toLowerCase()}
            </span>
          ) : (
            <span className="text-[11px] text-text-3">{sorted.length} пазара</span>
          )
        }
      >
        Държави
      </CardHeader>
      <CardBody className="flex-1 overflow-y-auto space-y-1">
        {sorted.length === 0 ? (
          <div className="text-center py-8 text-text-2 text-[13px]">
            Няма продажби в периода
          </div>
        ) : (
          sorted.map((c) => {
            const v = valueForMetric(c, metric);
            const share = total > 0 ? (v / total) * 100 : 0;
            const isSelected = c.countryCode === selectedCountry;
            const displayName = countryDisplayName(c.countryCode, c.countryCode);
            return (
              <button
                key={c.countryCode}
                type="button"
                onClick={() =>
                  onSelectCountry(isSelected ? null : c.countryCode)
                }
                className={`
                  w-full text-left
                  flex items-center gap-3
                  px-3 py-2.5 -mx-2
                  rounded-lg
                  transition-colors
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
                  ${
                    isSelected
                      ? "bg-accent-soft"
                      : "hover:bg-surface-2"
                  }
                `}
              >
                <MarketFlag market={c.countryCode.toLowerCase()} size={16} labelled />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-text truncate">
                      {displayName}
                    </span>
                    <span className="text-[13px] font-semibold text-text tabular-nums flex-shrink-0">
                      {formatValue(v, metric)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-text-3 tabular-nums">
                      {fmtInt(c.orders)} поръчки · {fmtInt(c.customers)} клиенти
                    </span>
                    <span className="text-[11px] text-text-3 tabular-nums flex-shrink-0">
                      {share >= 1 ? `${share.toFixed(0)}%` : "<1%"}
                    </span>
                  </div>
                </div>
                {isSelected && (
                  <ArrowRight size={14} className="text-accent flex-shrink-0" />
                )}
              </button>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}
