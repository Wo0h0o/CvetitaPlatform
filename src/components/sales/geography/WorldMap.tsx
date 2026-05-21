"use client";

import { useState, useMemo, useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import { MarketFlag } from "@/components/shared/MarketFlag";
import { numericToAlpha2, countryDisplayName } from "@/lib/geo/country-codes";
import worldTopojson from "@/lib/geo/world-110m.json";
import type { CountrySales } from "@/lib/sales-queries";

// ============================================================
// WorldMap — branded choropleth for /sales/geography.
//
// Renders the world via the world-atlas 110m topojson (ISO numeric ids)
// with countries fill-scaled by sales activity. Single-hue accent ladder
// (design-contract §1, §9.5) — never categorical colours.
//
// Three interactions:
//
//   1. **Pan + zoom** — ZoomableGroup with a 1-8× clamped scale. Wheel
//      to zoom, drag to pan. Reset button in the corner.
//
//   2. **Glass hover tooltip** — same vocabulary as KpiStrip's
//      TempoTooltip (bg-surface/85 backdrop-blur, hairline divider,
//      label→value grid). Position follows the mouse with a 12px
//      offset so the cursor doesn't hide the tooltip arrow.
//
//   3. **Click** — emits the country code to the parent for
//      synchronisation with the side list (highlight the row).
//
// Colour scale: log10(value) percentile within the active dataset, then
// mapped to accent opacity 0.18 → 1.0. Log is critical — Cvetita has 94%
// in BG, ~4% in GR, the rest in long tail. A linear scale would render
// everything except BG as invisible.
//
// Countries with no data render in `--surface-2` with a faint
// `--border` stroke, so the eye can still navigate the geography even
// where we haven't shipped.
// ============================================================

export type Metric = "revenue" | "orders" | "customers";

interface WorldMapProps {
  data: CountrySales[];
  metric: Metric;
  /** Optional currently-highlighted country (sync from side list). */
  selectedCountry?: string | null;
  onSelectCountry?: (alpha2: string | null) => void;
}

interface HoverState {
  alpha2: string | null;
  englishName: string;
  x: number;
  y: number;
  geoCenterX?: number;
  geoCenterY?: number;
}

// Recharts/react-simple-maps types are loose — geography feature.id is
// `string | number` depending on the source. We coerce in a single place.
interface GeoFeature {
  rsmKey: string;
  id?: string | number;
  properties?: { name?: string };
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString("bg-BG")} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG");
}

// ============================================================
// CountryTooltip — glass card, same grammar as TempoTooltip
// ============================================================

interface CountryTooltipProps {
  hover: HoverState;
  data: CountrySales | undefined;
  totalRevenue: number;
  totalOrders: number;
  totalCustomers: number;
}

function CountryTooltip({
  hover,
  data,
  totalRevenue,
  totalOrders,
  totalCustomers,
}: CountryTooltipProps) {
  const displayName = countryDisplayName(hover.alpha2, hover.englishName);
  const sharePct = data && totalRevenue > 0
    ? Math.round((data.revenue / totalRevenue) * 100)
    : null;

  return (
    <div
      className="
        pointer-events-none absolute z-50
        bg-surface/85 backdrop-blur-xl
        border border-border/60 rounded-xl shadow-xl
        px-3 py-2.5 min-w-[200px]
        text-[11px] leading-tight
      "
      style={{
        // 12px offset from cursor so the arrow tip doesn't sit on the
        // tooltip box (which would block hover events on adjacent
        // countries).
        left: `${hover.x + 12}px`,
        top: `${hover.y + 12}px`,
      }}
    >
      <div className="flex items-center gap-2 text-text font-medium text-[11.5px]">
        {hover.alpha2 && <MarketFlag market={hover.alpha2.toLowerCase()} size={14} />}
        <span>{displayName}</span>
      </div>
      <div className="h-px bg-border/70 my-1.5" />
      {data ? (
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
          <span className="text-text-3">Приходи</span>
          <span className="text-text font-semibold tabular-nums text-right">
            {fmtEur(data.revenue)}
          </span>
          <span className="text-text-3">Поръчки</span>
          <span className="text-text-2 tabular-nums text-right">
            {fmtInt(data.orders)}
          </span>
          <span className="text-text-3">Клиенти</span>
          <span className="text-text-2 tabular-nums text-right">
            {fmtInt(data.customers)}
          </span>
          {sharePct !== null && (
            <>
              <span className="text-text-3">Дял</span>
              <span className="text-accent font-semibold tabular-nums text-right">
                {sharePct >= 1 ? `${sharePct}%` : "<1%"}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="text-text-3 italic">няма продажби за периода</div>
      )}
      {!data && (totalOrders > 0 || totalCustomers > 0) && (
        <div className="mt-1.5 pt-1.5 border-t border-border/70 text-[10px] text-text-3">
          потенциален пазар
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main export
// ============================================================

export function WorldMap({
  data,
  metric,
  selectedCountry,
  onSelectCountry,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [zoom, setZoom] = useState<{ coordinates: [number, number]; zoom: number }>({
    coordinates: [15, 35], // roughly centred on Europe/Med — our home base
    zoom: 1.4,
  });

  // Index sales data by alpha-2 for O(1) lookup during the per-country
  // render in <Geographies>.
  const byAlpha2 = useMemo(() => {
    const map = new Map<string, CountrySales>();
    for (const c of data) map.set(c.countryCode, c);
    return map;
  }, [data]);

  // Aggregate totals for tooltip share-% and overall narrative.
  const totals = useMemo(() => {
    let revenue = 0;
    let orders = 0;
    let customers = 0;
    for (const c of data) {
      revenue += c.revenue;
      orders += c.orders;
      customers += c.customers;
    }
    return { revenue, orders, customers };
  }, [data]);

  // Log-percentile color scale. Cvetita's distribution is "94% BG, 4% GR,
  // 2% RO, < 1% rest" — a linear scale would render everything except BG
  // as invisible. Log compresses the head and stretches the tail so all
  // markets read as distinguishable from background.
  const colorFor = useMemo(() => {
    const values = data
      .map((c) => c[metric])
      .filter((v) => v > 0)
      .map((v) => Math.log10(v + 1)); // +1 so log10(0) → 0 not -∞

    if (values.length === 0) return () => "var(--surface-2)";

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return (alpha2: string | null): string => {
      if (!alpha2) return "var(--surface-2)";
      const sale = byAlpha2.get(alpha2);
      if (!sale || sale[metric] <= 0) return "var(--surface-2)";
      const v = Math.log10(sale[metric] + 1);
      const ratio = (v - min) / range;
      // 0.18 floor so even the smallest market is visibly accent-tinted,
      // not blending into the background.
      const opacity = 0.18 + ratio * 0.82;
      return `color-mix(in srgb, var(--accent) ${(opacity * 100).toFixed(1)}%, transparent)`;
    };
  }, [data, metric, byAlpha2]);

  function handleMouseMove(
    e: React.MouseEvent<SVGPathElement>,
    geo: GeoFeature
  ) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setHover({
      alpha2: numericToAlpha2(geo.id),
      englishName: geo.properties?.name ?? "—",
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  function handleMouseLeave() {
    setHover(null);
  }

  function handleCountryClick(geo: GeoFeature) {
    const alpha2 = numericToAlpha2(geo.id);
    if (alpha2 && onSelectCountry) {
      onSelectCountry(alpha2 === selectedCountry ? null : alpha2);
    }
  }

  function zoomIn() {
    setZoom((z) => ({ ...z, zoom: Math.min(z.zoom * 1.4, 8) }));
  }

  function zoomOut() {
    setZoom((z) => ({ ...z, zoom: Math.max(z.zoom / 1.4, 1) }));
  }

  function resetZoom() {
    setZoom({ coordinates: [15, 35], zoom: 1.4 });
  }

  const hoverData = hover?.alpha2 ? byAlpha2.get(hover.alpha2) : undefined;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-surface rounded-xl overflow-hidden border border-border"
    >
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 140 }}
        style={{ width: "100%", height: "100%" }}
      >
        <ZoomableGroup
          center={zoom.coordinates}
          zoom={zoom.zoom}
          onMoveEnd={(pos) => setZoom(pos)}
          maxZoom={8}
          minZoom={1}
        >
          <Geographies geography={worldTopojson}>
            {({ geographies }: { geographies: GeoFeature[] }) =>
              geographies.map((geo) => {
                const alpha2 = numericToAlpha2(geo.id);
                const isSelected = alpha2 === selectedCountry;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    onMouseMove={(e: React.MouseEvent<SVGPathElement>) =>
                      handleMouseMove(e, geo)
                    }
                    onMouseLeave={handleMouseLeave}
                    onClick={() => handleCountryClick(geo)}
                    style={{
                      default: {
                        fill: colorFor(alpha2),
                        stroke: isSelected
                          ? "var(--accent)"
                          : "var(--border-strong)",
                        strokeWidth: isSelected ? 1.5 : 0.5,
                        outline: "none",
                        cursor: alpha2 ? "pointer" : "default",
                        transition: "fill 150ms, stroke 150ms",
                      },
                      hover: {
                        fill: colorFor(alpha2),
                        stroke: "var(--accent)",
                        strokeWidth: 1.2,
                        outline: "none",
                      },
                      pressed: {
                        fill: colorFor(alpha2),
                        outline: "none",
                      },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {/* Zoom controls — minimal, top-right corner. Glass treatment so
          they read as floating chrome, not part of the page chrome. */}
      <div
        className="
          absolute top-3 right-3 z-10
          flex flex-col
          bg-surface/85 backdrop-blur-xl
          border border-border/60 rounded-lg shadow-sm
          overflow-hidden
        "
      >
        <button
          type="button"
          onClick={zoomIn}
          className="px-2.5 py-1.5 text-[14px] text-text hover:bg-surface-2 transition-colors"
          aria-label="Приближи"
        >
          +
        </button>
        <div className="h-px bg-border/60" />
        <button
          type="button"
          onClick={zoomOut}
          className="px-2.5 py-1.5 text-[14px] text-text hover:bg-surface-2 transition-colors"
          aria-label="Отдалечи"
        >
          −
        </button>
        <div className="h-px bg-border/60" />
        <button
          type="button"
          onClick={resetZoom}
          className="px-2.5 py-1.5 text-[10px] text-text-2 hover:bg-surface-2 transition-colors"
          aria-label="Възстанови изглед"
          title="Възстанови изглед"
        >
          ⊙
        </button>
      </div>

      {/* Hover tooltip — anchored to mouse position within the card. */}
      {hover && (
        <CountryTooltip
          hover={hover}
          data={hoverData}
          totalRevenue={totals.revenue}
          totalOrders={totals.orders}
          totalCustomers={totals.customers}
        />
      )}
    </div>
  );
}
