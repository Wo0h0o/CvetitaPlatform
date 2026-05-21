"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  Map as MaplibreMap,
  GeoJSONSource,
  MapGeoJSONFeature,
  MapMouseEvent,
} from "maplibre-gl";
import * as topojson from "topojson-client";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import { MarketFlag } from "@/components/shared/MarketFlag";
import { ALPHA2_TO_NAME_BG, countryDisplayName } from "@/lib/geo/country-codes";
import { lookupCity } from "@/lib/geo/cities";
import worldTopojson from "@/lib/geo/world-110m.json";
import type { CountrySales, CitySales } from "@/lib/sales-queries";
import "maplibre-gl/dist/maplibre-gl.css";

// ============================================================
// WorldMap — MapLibre-GL backed intelligence map for /sales/geography.
//
// What changed (vs. the previous react-simple-maps version):
//
//   * **Continuous zoom (world → street)** via Stadia Alidade Smooth Dark
//     vector tiles. The earlier choropleth was capped at zoom 8 because
//     world-110m has no detail past that; MapLibre + a real basemap lets
//     the operator zoom into a Sofia street and see the dot on the map.
//
//   * **Choropleth + basemap layering**. The country fill still drives
//     the high-level "where are we present" signal (single accent ladder,
//     §1 / §9.5 of analytics-design-contract.md). It fades on zoom-in so
//     the basemap takes over once you're focused on a country — no fight
//     for visual attention.
//
//   * **Clustering for markers**. MapLibre's native cluster algorithm
//     groups overlapping dots at low zoom and breaks them apart as you
//     zoom in. Removes the old MAX_MARKERS=80 global cap that was
//     starving foreign-market cities of any visibility.
//
//   * **Constant-pixel markers, native**. MapLibre `circle-radius` is in
//     screen pixels — no counter-scale gymnastics needed. §10.1 of the
//     design contract is honoured by construction, not by 1/currentZoom
//     arithmetic.
//
//   * **Glass tooltip preserved**. Same `bg-surface/85 backdrop-blur`
//     vocabulary as the prior version (and KpiStrip's TempoTooltip) — it
//     renders as a React overlay positioned to the cursor, NOT a
//     MapLibre Popup, so the styling stays consistent with the rest of
//     the platform.
//
// Stadia auth model:
//   * `localhost` / `127.0.0.1` works out of the box (Stadia allow-lists
//     local dev automatically).
//   * Production needs `cvetita-platform.vercel.app` registered under
//     "Add Domain" in the Stadia dashboard. No API key in client code.
// ============================================================

export type Metric = "revenue" | "orders" | "customers";

interface WorldMapProps {
  data: CountrySales[];
  cities?: CitySales[];
  metric: Metric;
  selectedCountry?: string | null;
  onSelectCountry?: (alpha2: string | null) => void;
}

// ----- Tooltip state ---------------------------------------------------

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
      countryCode: string;
      cityName: string;
      revenue: number;
      orders: number;
      customers: number;
      x: number;
      y: number;
    }
  | {
      kind: "cluster";
      count: number;
      revenue: number;
      x: number;
      y: number;
    };

// ----- Constants -------------------------------------------------------

// Stadia Alidade Smooth Dark — the closest free-tier match to the
// "intelligence-hub" aesthetic §10 implicitly describes (Palantir-style
// dark cartography with subtle labels). Auth is by domain, configured in
// the Stadia dashboard; no key in the URL.
const STADIA_STYLE_URL =
  "https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json";

// Initial framing — Europe/Med, where 99% of orders live. Zoom 3.5 shows
// the full continent comfortably; users zoom in for detail.
const INITIAL_CENTER: [number, number] = [15, 48];
const INITIAL_ZOOM = 3.5;

// Per-country tier rank — top city = T1, next four = T2, rest = T3.
type MarkerTier = 1 | 2 | 3;

function tierForRank(rank: number): MarkerTier {
  return rank === 0 ? 1 : rank < 5 ? 2 : 3;
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString("bg-BG")} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG");
}

// ============================================================
// Country GeoJSON — converted from world-110m topojson at module load.
//
// world-110m keys countries by ISO numeric (BG = "100", GR = "300"). We
// translate each feature.id to ISO alpha-2 once and stamp it onto the
// feature properties so MapLibre data-driven expressions can match on a
// stable, readable key.
// ============================================================

import { numericToAlpha2 } from "@/lib/geo/country-codes";

interface CountryFeatureProperties {
  alpha2: string | null;
  name: string;
}

const COUNTRIES_GEOJSON: FeatureCollection<Geometry, CountryFeatureProperties> = (() => {
  // The topojson-client typings model the input loosely; world-110m has
  // exactly one object collection called "countries".
  const tj = worldTopojson as unknown as Parameters<typeof topojson.feature>[0];
  const fc = topojson.feature(
    tj,
    (tj as { objects: Record<string, unknown> }).objects.countries as Parameters<
      typeof topojson.feature
    >[1]
  ) as unknown as FeatureCollection<Geometry, { name?: string }>;

  return {
    type: "FeatureCollection",
    features: fc.features.map((f: Feature<Geometry, { name?: string }>) => ({
      ...f,
      // MapLibre needs a feature `id` for setFeatureState; alpha-2 is
      // the natural key. Numeric ids (`f.id`) collide between the
      // topojson source and our alpha-2 model, so we don't reuse them.
      id: undefined,
      properties: {
        alpha2: numericToAlpha2(f.id),
        name: f.properties?.name ?? "—",
      },
    })),
  };
})();

// ============================================================
// City features — built per-render from CitySales + alias lookup.
// Cities our table can't resolve are dropped silently (the country
// choropleth still counts their revenue).
// ============================================================

interface ResolvedCityProps {
  countryCode: string;
  cityName: string;
  revenue: number;
  orders: number;
  customers: number;
  tier: MarkerTier;
  // Numeric value of the active metric, used for cluster aggregation
  // (MapLibre cluster properties only work on numeric fields).
  metricValue: number;
}

function buildCityFeatureCollection(
  cities: CitySales[],
  metric: Metric
): FeatureCollection<Geometry, ResolvedCityProps> {
  // Resolve + sort by metric so the first city per country is its anchor.
  const resolved = cities
    .map((c) => ({ raw: c, entry: lookupCity(c.countryCode, c.city) }))
    .filter((r): r is { raw: CitySales; entry: NonNullable<ReturnType<typeof lookupCity>> } =>
      r.entry !== null
    )
    .sort((a, b) => b.raw[metric] - a.raw[metric]);

  const rankPerCountry = new Map<string, number>();
  const features: Feature<Geometry, ResolvedCityProps>[] = resolved.map(({ raw, entry }) => {
    const rank = rankPerCountry.get(raw.countryCode) ?? 0;
    rankPerCountry.set(raw.countryCode, rank + 1);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [entry.lng, entry.lat] },
      properties: {
        countryCode: raw.countryCode,
        cityName: entry.name,
        revenue: raw.revenue,
        orders: raw.orders,
        customers: raw.customers,
        tier: tierForRank(rank),
        metricValue: raw[metric],
      },
    };
  });

  return { type: "FeatureCollection", features };
}

// ============================================================
// Main component
// ============================================================

export function WorldMap({
  data,
  cities = [],
  metric,
  selectedCountry,
  onSelectCountry,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const styleLoadedRef = useRef(false);
  // Refs for the latest callbacks so the (one-shot) MapLibre event
  // handlers always call the current closure.
  const onSelectCountryRef = useRef(onSelectCountry);
  const selectedCountryRef = useRef<string | null | undefined>(selectedCountry);
  useEffect(() => {
    onSelectCountryRef.current = onSelectCountry;
  }, [onSelectCountry]);
  useEffect(() => {
    selectedCountryRef.current = selectedCountry;
  }, [selectedCountry]);

  const [hover, setHover] = useState<HoverState | null>(null);

  // Index sales data by alpha-2 for tooltip lookups.
  const byAlpha2 = useMemo(() => {
    const m = new Map<string, CountrySales>();
    for (const c of data) m.set(c.countryCode, c);
    return m;
  }, [data]);

  // Total revenue across the active dataset — feeds the share-% line in
  // the country tooltip.
  const totalRevenue = useMemo(
    () => data.reduce((s, c) => s + c.revenue, 0),
    [data]
  );

  // Per-country fill color, computed as a MapLibre `match` expression
  // keyed off the alpha2 property. Log-percentile so БГ's 90% share
  // doesn't render everyone else as invisible.
  const fillExpression = useMemo(() => {
    const values = data
      .map((c) => c[metric])
      .filter((v) => v > 0)
      .map((v) => Math.log10(v + 1));

    if (values.length === 0) {
      // No data → flat near-transparent. Don't render the choropleth at
      // all in this state; the basemap tells the story.
      return "transparent" as const;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    // Build [code, color, code2, color2, ...] flat array for `match`.
    const pairs: (string | string[])[] = [];
    for (const c of data) {
      if (c[metric] <= 0) continue;
      const v = Math.log10(c[metric] + 1);
      const ratio = (v - min) / range;
      // 0.22 floor — even the smallest active market reads as
      // accent-tinted, not background.
      const opacity = 0.22 + ratio * 0.78;
      pairs.push(c.countryCode);
      pairs.push(
        `color-mix(in srgb, var(--accent) ${(opacity * 100).toFixed(1)}%, transparent)`
      );
    }

    return [
      "match",
      ["get", "alpha2"],
      ...pairs.flat(),
      "transparent", // default for unmapped / no-data countries
    ];
  }, [data, metric]);

  // City source GeoJSON, rebuilt when cities or metric change.
  const cityGeoJSON = useMemo(
    () => buildCityFeatureCollection(cities, metric),
    [cities, metric]
  );

  // ----- Map init (once) -----------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STADIA_STYLE_URL,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      minZoom: 1.5,
      maxZoom: 18,
      attributionControl: { compact: true },
      // The default cooperative-gestures behaviour gets in the way of a
      // dashboard inside a scrollable page — operators expect to wheel-
      // zoom freely on a focused map. We keep scroll zoom always-on.
      cooperativeGestures: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      "top-right"
    );

    map.on("load", () => {
      styleLoadedRef.current = true;

      // ----- Country choropleth source + layers ------------------------
      map.addSource("countries", {
        type: "geojson",
        data: COUNTRIES_GEOJSON,
        promoteId: "alpha2",
      });

      map.addLayer({
        id: "countries-fill",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": "transparent",
          // Strong at low zoom (the "where in the world" answer); fades
          // to near-zero past zoom 6 so the basemap owns the city-level
          // story without competing colour wash.
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            0.85,
            4,
            0.75,
            6,
            0.35,
            8,
            0.12,
          ],
        },
      });

      map.addLayer({
        id: "countries-outline-selected",
        type: "line",
        source: "countries",
        paint: {
          "line-color": "rgb(34, 197, 94)", // --accent
          "line-width": 1.8,
          "line-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            1,
            0,
          ],
        },
      });

      // ----- City source — clustered ----------------------------------
      map.addSource("cities", {
        type: "geojson",
        data: cityGeoJSON,
        cluster: true,
        clusterRadius: 38,
        clusterMaxZoom: 11,
        clusterProperties: {
          // sum of metricValue across the cluster — used for tooltip and
          // (later) for sizing/colouring clusters by aggregate weight.
          sum_metric: ["+", ["get", "metricValue"]],
          sum_revenue: ["+", ["get", "revenue"]],
        },
      });

      // Cluster halo + dot — accent at low opacity, simple "this is a
      // group" signal. Size scales with the count, capped so a 30-city
      // cluster doesn't dominate the canvas.
      map.addLayer({
        id: "city-clusters",
        type: "circle",
        source: "cities",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgb(34, 197, 94)",
          "circle-opacity": 0.22,
          "circle-radius": [
            "step",
            ["get", "point_count"],
            14,
            5,
            18,
            15,
            22,
            50,
            28,
          ],
          "circle-stroke-color": "rgb(34, 197, 94)",
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.6,
        },
      });
      map.addLayer({
        id: "city-cluster-count",
        type: "symbol",
        source: "cities",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Stadia Bold"],
          "text-size": 11,
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.6)",
          "text-halo-width": 1,
        },
      });

      // ----- Unclustered city dots — tiered ---------------------------
      // T1 has a static accent halo behind it (presence > motion, §10.5).
      map.addLayer({
        id: "city-t1-halo",
        type: "circle",
        source: "cities",
        filter: [
          "all",
          ["!", ["has", "point_count"]],
          ["==", ["get", "tier"], 1],
        ],
        paint: {
          "circle-color": "rgb(34, 197, 94)",
          "circle-opacity": 0.18,
          "circle-radius": 12,
          "circle-blur": 0.3,
        },
      });
      map.addLayer({
        id: "city-dots",
        type: "circle",
        source: "cities",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "rgb(34, 197, 94)",
          "circle-opacity": 0.95,
          // Three discrete tiers (§10.3) — not a gradient.
          "circle-radius": [
            "match",
            ["get", "tier"],
            1,
            7,
            2,
            5,
            /* default tier 3 */ 4,
          ],
          "circle-stroke-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "rgb(34, 197, 94)",
            "#0b0d10",
          ],
          "circle-stroke-width": 1.4,
        },
      });

      // Initial paint of the choropleth — separated from layer creation
      // so the fillExpression effect below can re-run independently.
      if (fillExpression !== "transparent") {
        map.setPaintProperty(
          "countries-fill",
          "fill-color",
          fillExpression as unknown as maplibregl.ExpressionSpecification
        );
      }

      // Initial selection sync.
      if (selectedCountryRef.current) {
        map.setFeatureState(
          { source: "countries", id: selectedCountryRef.current },
          { selected: true }
        );
      }

      // ----- Interactivity ---------------------------------------------
      let hoveredCountryId: string | null = null;

      const setCountryHoverState = (next: string | null) => {
        if (hoveredCountryId && hoveredCountryId !== next) {
          map.setFeatureState(
            { source: "countries", id: hoveredCountryId },
            { hover: false }
          );
        }
        if (next) {
          map.setFeatureState(
            { source: "countries", id: next },
            { hover: true }
          );
        }
        hoveredCountryId = next;
      };

      const updateHoverFromEvent = (
        e: MapMouseEvent & { features?: MapGeoJSONFeature[] }
      ) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.originalEvent.clientX - rect.left;
        const y = e.originalEvent.clientY - rect.top;

        // Marker layers take priority — they paint on top, so the cursor
        // is intentionally on them when both layers report a hit.
        const cityFeatures = map.queryRenderedFeatures(e.point, {
          layers: ["city-dots", "city-t1-halo"],
        });
        if (cityFeatures.length > 0) {
          const f = cityFeatures[0];
          const p = f.properties as ResolvedCityProps;
          setCountryHoverState(null);
          map.getCanvas().style.cursor = "pointer";
          setHover({
            kind: "city",
            countryCode: p.countryCode,
            cityName: p.cityName,
            revenue: Number(p.revenue),
            orders: Number(p.orders),
            customers: Number(p.customers),
            x,
            y,
          });
          return;
        }

        const clusterFeatures = map.queryRenderedFeatures(e.point, {
          layers: ["city-clusters"],
        });
        if (clusterFeatures.length > 0) {
          const f = clusterFeatures[0];
          const p = f.properties as {
            point_count: number;
            sum_revenue: number;
          };
          setCountryHoverState(null);
          map.getCanvas().style.cursor = "pointer";
          setHover({
            kind: "cluster",
            count: Number(p.point_count),
            revenue: Number(p.sum_revenue),
            x,
            y,
          });
          return;
        }

        const countryFeatures = map.queryRenderedFeatures(e.point, {
          layers: ["countries-fill"],
        });
        if (countryFeatures.length > 0) {
          const f = countryFeatures[0];
          const p = f.properties as CountryFeatureProperties;
          const id = (f.id as string | undefined) ?? p.alpha2 ?? null;
          if (id) setCountryHoverState(id);
          map.getCanvas().style.cursor = p.alpha2 ? "pointer" : "default";
          setHover({
            kind: "country",
            alpha2: p.alpha2,
            englishName: p.name,
            x,
            y,
          });
          return;
        }

        setCountryHoverState(null);
        map.getCanvas().style.cursor = "";
        setHover(null);
      };

      map.on("mousemove", updateHoverFromEvent);
      map.on("mouseout", () => {
        setCountryHoverState(null);
        map.getCanvas().style.cursor = "";
        setHover(null);
      });

      // Click handlers — country fill flips selection; cluster click
      // zooms into the cluster; city dot click selects the city's country.
      map.on("click", "city-clusters", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const clusterId = (f.properties as { cluster_id: number }).cluster_id;
        const src = map.getSource("cities") as GeoJSONSource;
        try {
          const zoom = await src.getClusterExpansionZoom(clusterId);
          // Cluster features are always Points — cast via `unknown` to
          // narrow past the generic `Geometry` union (which TS won't
          // implicitly narrow because GeometryCollection has no
          // `coordinates`).
          const coords = (f.geometry as unknown as {
            coordinates: [number, number];
          }).coordinates;
          map.easeTo({ center: coords, zoom });
        } catch {
          // Cluster may have disappeared by the time the promise resolves
          // (rapid pan/zoom). Failing silently is the right call here.
        }
      });

      map.on("click", "city-dots", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as ResolvedCityProps;
        const cb = onSelectCountryRef.current;
        if (cb) {
          cb(p.countryCode === selectedCountryRef.current ? null : p.countryCode);
        }
      });

      map.on("click", "countries-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as CountryFeatureProperties;
        if (!p.alpha2) return;
        const cb = onSelectCountryRef.current;
        if (cb) {
          cb(p.alpha2 === selectedCountryRef.current ? null : p.alpha2);
        }
      });
    });

    mapRef.current = map;

    return () => {
      mapRef.current = null;
      styleLoadedRef.current = false;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once; everything else flows through dedicated effects

  // ----- Sync: choropleth paint when data/metric change ----------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    if (!map.getLayer("countries-fill")) return;
    map.setPaintProperty(
      "countries-fill",
      "fill-color",
      (fillExpression === "transparent"
        ? "transparent"
        : fillExpression) as unknown as maplibregl.ExpressionSpecification
    );
  }, [fillExpression]);

  // ----- Sync: city source data when cityGeoJSON changes ---------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const src = map.getSource("cities") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(cityGeoJSON);
  }, [cityGeoJSON]);

  // ----- Sync: selected-country feature state --------------------------

  const prevSelectedRef = useRef<string | null | undefined>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const prev = prevSelectedRef.current;
    if (prev && prev !== selectedCountry) {
      map.setFeatureState(
        { source: "countries", id: prev },
        { selected: false }
      );
    }
    if (selectedCountry) {
      map.setFeatureState(
        { source: "countries", id: selectedCountry },
        { selected: true }
      );
    }
    prevSelectedRef.current = selectedCountry;
  }, [selectedCountry]);

  // ============================================================
  // Render
  // ============================================================

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-surface rounded-xl overflow-hidden border border-border"
      // MapLibre styles its canvas in absolute terms; ensure the
      // container is the positioning context.
      style={{ position: "relative" }}
    >
      {/* Hover tooltip — anchored to mouse position within the container.
          Three variants reuse the same TooltipShell glass treatment. */}
      {hover?.kind === "country" && (
        <TooltipShell x={hover.x} y={hover.y}>
          <CountryTooltipBody
            alpha2={hover.alpha2}
            englishName={hover.englishName}
            data={hover.alpha2 ? byAlpha2.get(hover.alpha2) : undefined}
            totalRevenue={totalRevenue}
          />
        </TooltipShell>
      )}
      {hover?.kind === "city" && (
        <TooltipShell x={hover.x} y={hover.y}>
          <CityTooltipBody
            countryCode={hover.countryCode}
            cityName={hover.cityName}
            revenue={hover.revenue}
            orders={hover.orders}
            customers={hover.customers}
          />
        </TooltipShell>
      )}
      {hover?.kind === "cluster" && (
        <TooltipShell x={hover.x} y={hover.y}>
          <ClusterTooltipBody count={hover.count} revenue={hover.revenue} />
        </TooltipShell>
      )}
    </div>
  );
}

// ============================================================
// Tooltip components — same glass shell used by the prior version.
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
      style={{ left: `${x + 12}px`, top: `${y + 12}px` }}
    >
      {children}
    </div>
  );
}

function CountryTooltipBody({
  alpha2,
  englishName,
  data,
  totalRevenue,
}: {
  alpha2: string | null;
  englishName: string;
  data: CountrySales | undefined;
  totalRevenue: number;
}) {
  const displayName = countryDisplayName(alpha2, englishName);
  const sharePct =
    data && totalRevenue > 0
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
      ) : alpha2 === null ? (
        <div className="text-text-3 text-[11px] leading-snug max-w-[220px]">
          Извън ISO модела. Поръчки от тук се отчитат към съседна държава.
        </div>
      ) : ALPHA2_TO_NAME_BG[alpha2] ? (
        <div className="text-text-3 italic">Няма продажби в периода</div>
      ) : (
        <div className="text-text-3 italic">Няма продажби в периода</div>
      )}
    </>
  );
}

function CityTooltipBody({
  countryCode,
  cityName,
  revenue,
  orders,
  customers,
}: {
  countryCode: string;
  cityName: string;
  revenue: number;
  orders: number;
  customers: number;
}) {
  return (
    <>
      <div className="flex items-center gap-2 text-text font-medium text-[11.5px]">
        <MarketFlag market={countryCode.toLowerCase()} size={14} />
        <span>{cityName}</span>
        <span className="text-text-3 text-[10px]">
          ({countryDisplayName(countryCode, countryCode)})
        </span>
      </div>
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        <span className="text-text-3">Приходи</span>
        <span className="text-text font-semibold tabular-nums text-right">
          {fmtEur(revenue)}
        </span>
        <span className="text-text-3">Поръчки</span>
        <span className="text-text-2 tabular-nums text-right">
          {fmtInt(orders)}
        </span>
        <span className="text-text-3">Клиенти</span>
        <span className="text-text-2 tabular-nums text-right">
          {fmtInt(customers)}
        </span>
      </div>
    </>
  );
}

function ClusterTooltipBody({
  count,
  revenue,
}: {
  count: number;
  revenue: number;
}) {
  return (
    <>
      <div className="text-text font-medium text-[11.5px]">
        {fmtInt(count)} града в района
      </div>
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        <span className="text-text-3">Сумарни приходи</span>
        <span className="text-text font-semibold tabular-nums text-right">
          {fmtEur(revenue)}
        </span>
      </div>
      <div className="text-text-3 text-[10.5px] mt-1.5">
        Кликни, за да приближиш и видиш по града.
      </div>
    </>
  );
}
