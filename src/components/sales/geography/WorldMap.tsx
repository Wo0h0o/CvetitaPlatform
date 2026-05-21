"use client";

import { useState, useMemo, useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from "react-simple-maps";
import { MarketFlag } from "@/components/shared/MarketFlag";
import { numericToAlpha2, countryDisplayName } from "@/lib/geo/country-codes";
import { lookupCity, type CityEntry } from "@/lib/geo/cities";
import worldTopojson from "@/lib/geo/world-110m.json";
import type { CountrySales, CitySales } from "@/lib/sales-queries";

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
  /** City-level data for pulsing marker overlay. Optional — if absent
   *  the map renders the choropleth only. Markers are filtered to
   *  cities our lookup table can resolve to lat/lng; the rest fold
   *  silently into the country aggregate (which is shown via choropleth
   *  intensity anyway). */
  cities?: CitySales[];
  metric: Metric;
  /** Optional currently-highlighted country (sync from side list). */
  selectedCountry?: string | null;
  onSelectCountry?: (alpha2: string | null) => void;
}

/** A resolved city — sales joined with its lat/lng entry. */
interface ResolvedCity extends CitySales {
  entry: CityEntry;
}

type HoverState =
  | {
      kind: "country";
      alpha2: string | null;
      englishName: string;
      x: number;
      y: number;
    }
  | {
      kind: "city";
      city: ResolvedCity;
      x: number;
      y: number;
    };

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
// TooltipShell — shared glass container for both country + city
// tooltips, anchored to the hover xy with the standard 12px offset.
// ============================================================

function TooltipShell({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
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
        // 12px offset from cursor so the tooltip doesn't sit on
        // adjacent hover targets (countries / markers).
        left: `${x + 12}px`,
        top: `${y + 12}px`,
      }}
    >
      {children}
    </div>
  );
}

// ============================================================
// Country tooltip body — three states:
//
//   1. Has sales       → flag + name + full breakdown (revenue, orders,
//                        customers, share %).
//   2. Mapped, no data → "Няма продажби в периода." That's it. No
//                        editorial "потенциален пазар" hint — the
//                        dashboard reports reality, it doesn't suggest
//                        expansion strategies.
//   3. Unmapped        → "Извън ISO модела. Поръчки от тук се отчитат
//                        към съседна държава." Honest about why we
//                        can't show numbers (no ISO code → can't
//                        attribute).
// ============================================================

interface CountryTooltipProps {
  alpha2: string | null;
  englishName: string;
  data: CountrySales | undefined;
  totalRevenue: number;
}

function CountryTooltipBody({
  alpha2,
  englishName,
  data,
  totalRevenue,
}: CountryTooltipProps) {
  const displayName = countryDisplayName(alpha2, englishName);
  const isUnmapped = alpha2 === null;
  const sharePct = data && totalRevenue > 0
    ? Math.round((data.revenue / totalRevenue) * 100)
    : null;

  return (
    <>
      <div className="flex items-center gap-2 text-text font-medium text-[11.5px]">
        {alpha2 && <MarketFlag market={alpha2.toLowerCase()} size={14} />}
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
      ) : isUnmapped ? (
        <div className="text-text-3 text-[11px] leading-snug max-w-[220px]">
          Извън ISO модела. Поръчки от тук се отчитат към съседна държава.
        </div>
      ) : (
        <div className="text-text-3 italic">Няма продажби в периода</div>
      )}
    </>
  );
}

// ============================================================
// City tooltip body — same grammar, surfaces the city + country
// breakdown for a single marker.
// ============================================================

function CityTooltipBody({ city }: { city: ResolvedCity }) {
  return (
    <>
      <div className="flex items-center gap-2 text-text font-medium text-[11.5px]">
        <MarketFlag market={city.countryCode.toLowerCase()} size={14} />
        <span>{city.entry.name}</span>
        <span className="text-text-3 text-[10px]">
          ({countryDisplayName(city.countryCode, city.countryCode)})
        </span>
      </div>
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        <span className="text-text-3">Приходи</span>
        <span className="text-text font-semibold tabular-nums text-right">
          {fmtEur(city.revenue)}
        </span>
        <span className="text-text-3">Поръчки</span>
        <span className="text-text-2 tabular-nums text-right">
          {fmtInt(city.orders)}
        </span>
        <span className="text-text-3">Клиенти</span>
        <span className="text-text-2 tabular-nums text-right">
          {fmtInt(city.customers)}
        </span>
      </div>
    </>
  );
}

// ============================================================
// IntelMarker — constant-pixel city marker with tiered hierarchy.
//
// Design philosophy: "Calm by default, alive on interaction." Markers
// are UI overlays, not geographic features — they live in SCREEN
// coordinate space, not SVG world space. ZoomableGroup scales the
// geography; this marker counter-scales itself by `1/currentZoom` so
// it stays at a constant pixel size on screen, locked to its lat/lng.
//
// Three tiers, three visual states:
//
//   T1 (top 1 per country) — 7px dot + static accent halo. The halo
//      doesn't animate; it just "is" there, giving the marker quiet
//      visual prominence without screaming. Like the bright outpost on
//      an intelligence map.
//
//   T2 (next 4 per country) — 5px dot, no halo. Important but secondary.
//
//   T3 (rest)            — 4px dot, no halo. Present, not loud.
//
// And three interaction states layered on top:
//
//   * Idle (default)   — just the tier visuals. No animation. Calm.
//   * Hovered          — a single elegant pulse ring expands from the
//                        dot, 1.6s cycle, ~2.2× expansion. Subtle and
//                        purposeful: "you are looking at me."
//   * Selected country — accent stroke on the dot. No pulse (selection
//                        is communicated via the country choropleth +
//                        side list — adding a pulse would double-state).
//
// Hit area: a transparent 12-screen-px circle (counter-scaled) sits
// behind everything so even the smallest 4px T3 dot remains comfortably
// clickable on mouse and touch.
// ============================================================

type MarkerTier = 1 | 2 | 3;

// Base sizes in SVG units (pre-zoom). At runtime each is divided by the
// current zoom factor so the screen size stays constant.
const TIER_VISUAL: Record<MarkerTier, {
  dotR: number;
  haloR: number;
  haloOpacity: number;
  dotStroke: number;
}> = {
  1: { dotR: 7, haloR: 12, haloOpacity: 0.18, dotStroke: 1.5 },
  2: { dotR: 5, haloR: 0, haloOpacity: 0, dotStroke: 1 },
  3: { dotR: 4, haloR: 0, haloOpacity: 0, dotStroke: 1 },
};

interface IntelMarkerProps {
  city: ResolvedCity;
  tier: MarkerTier;
  /** Current ZoomableGroup zoom — used to counter-scale dimensions. */
  currentZoom: number;
  isHovered: boolean;
  isSelected: boolean;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onClick: () => void;
}

function IntelMarker({
  city,
  tier,
  currentZoom,
  isHovered,
  isSelected,
  onMouseMove,
  onMouseLeave,
  onClick,
}: IntelMarkerProps) {
  const v = TIER_VISUAL[tier];
  const z = currentZoom;

  // All visual dimensions counter-scale by z, so each marker remains
  // exactly its base pixel size on screen regardless of map zoom.
  const r = v.dotR / z;
  const haloR = v.haloR / z;
  const dotStroke = v.dotStroke / z;
  const hitR = 12 / z; // ≥12px hit area on screen — comfortable mouse target.

  // Hover pulse — one ring expanding from the dot edge to ~2.2× the dot
  // radius, then fading. Short cycle (1.6s) makes it feel responsive,
  // not lingering. Only rendered when isHovered, so the canvas stays
  // calm during normal browsing.
  const pulseMax = (v.dotR * 2.2) / z;
  const pulseStroke = 1.2 / z;

  return (
    <Marker coordinates={[city.entry.lng, city.entry.lat]}>
      {/* Static halo — only T1 has a halo. Not animated; the halo is
          structural presence, not motion. */}
      {haloR > 0 && (
        <circle
          r={haloR}
          fill="var(--accent)"
          opacity={v.haloOpacity}
          pointerEvents="none"
        />
      )}
      {/* Hover pulse ring — drawn only while this marker is hovered. */}
      {isHovered && (
        <circle
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={pulseStroke}
          opacity={0.55}
          pointerEvents="none"
        >
          <animate
            attributeName="r"
            from={r}
            to={pulseMax}
            dur="1.6s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            from="0.55"
            to="0"
            dur="1.6s"
            repeatCount="indefinite"
          />
        </circle>
      )}
      {/* Transparent hit area — sized for comfortable clicking even at
          tiny dot sizes. Pointer events live here, not on the visible
          dot, so the hover region is forgiving. */}
      <circle
        r={hitR}
        fill="transparent"
        style={{ cursor: "pointer" }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      />
      {/* The visible dot — tier-sized, surface-bordered for crisp edges
          against varying country fills. Selection swaps the border to
          accent for a clear "this country is selected" signal without
          adding any pulse (selection is already communicated via the
          country fill stroke and the side list). */}
      <circle
        r={r}
        fill="var(--accent)"
        stroke={isSelected ? "var(--accent)" : "var(--surface)"}
        strokeWidth={dotStroke}
        opacity={0.95}
        pointerEvents="none"
      />
    </Marker>
  );
}

// ============================================================
// Main export
// ============================================================

// Cap on rendered markers. SMIL animations on hundreds of nodes start
// to chug; top-N by metric value keeps the canvas responsive while still
// covering the long tail visually via the country choropleth underneath.
const MAX_MARKERS = 80;

export function WorldMap({
  data,
  cities = [],
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

  // Total revenue across the active dataset — sole purpose is the
  // share-% line in the country tooltip. Orders / customers totals
  // were dropped along with the "потенциален пазар" footer (editorial
  // commentary, not data).
  const totals = useMemo(() => {
    let revenue = 0;
    for (const c of data) revenue += c.revenue;
    return { revenue };
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
      // alpha2 === null → territory has no ISO code in our model
      // (Kosovo, N. Cyprus, disputed enclaves). These get a diagonal
      // hatch via the <pattern> defined inline below, so they read
      // visually as "outside the model" rather than as "zero sales".
      if (!alpha2) return "url(#worldMapUnmapped)";
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

  // Resolve cities → lat/lng entries via the alias lookup. Cities we
  // can't match drop silently (the country choropleth still counts
  // their revenue). Sorted by the active metric so MAX_MARKERS keeps
  // the top performers visible.
  const resolvedCities = useMemo<ResolvedCity[]>(() => {
    const matched: ResolvedCity[] = [];
    for (const c of cities) {
      const entry = lookupCity(c.countryCode, c.city);
      if (entry) matched.push({ ...c, entry });
    }
    matched.sort((a, b) => b[metric] - a[metric]);
    return matched.slice(0, MAX_MARKERS);
  }, [cities, metric]);

  // Tier assignment — per country, not global. Sorting by the active
  // metric globally then walking the list lets us assign:
  //   * T1 to the first occurrence of each country (its top city)
  //   * T2 to the next four occurrences
  //   * T3 to everyone else
  //
  // Three discrete tiers (not a continuous gradient) so the eye reads
  // hierarchy at a glance — "this is the country's anchor city, these
  // are its supporting cities, these are the rest" — instead of trying
  // to compare 30 slightly-different dot sizes.
  const tieredCities = useMemo<Array<ResolvedCity & { tier: MarkerTier }>>(() => {
    const rankPerCountry = new Map<string, number>();
    return resolvedCities.map((c) => {
      const rank = rankPerCountry.get(c.countryCode) ?? 0;
      rankPerCountry.set(c.countryCode, rank + 1);
      const tier: MarkerTier = rank === 0 ? 1 : rank < 5 ? 2 : 3;
      return { ...c, tier };
    });
  }, [resolvedCities]);

  function handleCountryMouseMove(
    e: React.MouseEvent<SVGPathElement>,
    geo: GeoFeature
  ) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setHover({
      kind: "country",
      alpha2: numericToAlpha2(geo.id),
      englishName: geo.properties?.name ?? "—",
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  function handleCityMouseMove(e: React.MouseEvent, city: ResolvedCity) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setHover({
      kind: "city",
      city,
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

  function handleCityClick(city: ResolvedCity) {
    if (onSelectCountry) {
      onSelectCountry(
        city.countryCode === selectedCountry ? null : city.countryCode
      );
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
        {/* Hatch pattern for territories without an ISO code (Kosovo,
            N. Cyprus, etc.) — reads visually as "outside the model"
            rather than as zero-sales grey. Lines are deliberately
            subtle (border-strong at 1px) so it doesn't shout. */}
        <defs>
          <pattern
            id="worldMapUnmapped"
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--surface-2)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="var(--border-strong)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
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
                const isSelected = alpha2 !== null && alpha2 === selectedCountry;
                const isUnmapped = alpha2 === null;
                const hasSales = alpha2 !== null && (byAlpha2.get(alpha2)?.[metric] ?? 0) > 0;

                // Three-state stroke palette:
                //   * sales country, selected → accent (strong)
                //   * sales country, hover → accent
                //   * mapped, no sales → border-strong (neutral, no
                //     "this is a target market" connotation)
                //   * unmapped → border (faintest) — hover stays muted
                //     so disputed territories don't appear actionable
                const defaultStroke = isSelected
                  ? "var(--accent)"
                  : isUnmapped
                    ? "var(--border)"
                    : "var(--border-strong)";
                const hoverStroke = isUnmapped
                  ? "var(--border-strong)"
                  : "var(--accent)";
                const fill = colorFor(alpha2);
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    onMouseMove={(e: React.MouseEvent<SVGPathElement>) =>
                      handleCountryMouseMove(e, geo)
                    }
                    onMouseLeave={handleMouseLeave}
                    // Click only flips selection for mapped countries —
                    // selecting an unmapped territory has nothing in
                    // byAlpha2 to highlight in the side list, so the
                    // click would be a no-op surfaced as a UI change.
                    onClick={() =>
                      isUnmapped ? undefined : handleCountryClick(geo)
                    }
                    style={{
                      default: {
                        fill,
                        stroke: defaultStroke,
                        strokeWidth: isSelected ? 1.5 : 0.5,
                        outline: "none",
                        cursor: isUnmapped
                          ? "help"
                          : hasSales
                            ? "pointer"
                            : "default",
                        transition: "fill 150ms, stroke 150ms",
                      },
                      hover: {
                        fill,
                        stroke: hoverStroke,
                        strokeWidth: isUnmapped ? 0.8 : 1.2,
                        outline: "none",
                      },
                      pressed: {
                        fill,
                        outline: "none",
                      },
                    }}
                  />
                );
              })
            }
          </Geographies>
          {/* Intel-style city markers — rendered AFTER Geographies so
              they paint on top of the country fills. Constant-pixel
              sized (counter-scaled by currentZoom), three discrete
              tiers, calm by default, pulse only on hover. */}
          {tieredCities.map((city) => {
            const key = `${city.countryCode}|${city.entry.name}`;
            const isHovered =
              hover?.kind === "city" &&
              `${hover.city.countryCode}|${hover.city.entry.name}` === key;
            return (
              <IntelMarker
                key={key}
                city={city}
                tier={city.tier}
                currentZoom={zoom.zoom}
                isHovered={isHovered}
                isSelected={city.countryCode === selectedCountry}
                onMouseMove={(e) => handleCityMouseMove(e, city)}
                onMouseLeave={handleMouseLeave}
                onClick={() => handleCityClick(city)}
              />
            );
          })}
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

      {/* Hover tooltip — anchored to mouse position within the card.
          Two variants: country (when hovering a country fill) and city
          (when hovering a marker). The marker tooltip wins because
          markers paint on top of countries; mouse events on a marker
          don't propagate to the country below. */}
      {hover?.kind === "country" && (
        <TooltipShell x={hover.x} y={hover.y}>
          <CountryTooltipBody
            alpha2={hover.alpha2}
            englishName={hover.englishName}
            data={hover.alpha2 ? byAlpha2.get(hover.alpha2) : undefined}
            totalRevenue={totals.revenue}
          />
        </TooltipShell>
      )}
      {hover?.kind === "city" && (
        <TooltipShell x={hover.x} y={hover.y}>
          <CityTooltipBody city={hover.city} />
        </TooltipShell>
      )}
    </div>
  );
}
