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
import { countryDisplayName, numericToAlpha2 } from "@/lib/geo/country-codes";
import { lookupCity, lookupCountryAnchor } from "@/lib/geo/cities";
import worldTopojson from "@/lib/geo/world-110m.json";
import type {
  CountrySales,
  CitySales,
  OfficePoint,
} from "@/lib/sales-queries";
import "maplibre-gl/dist/maplibre-gl.css";

// ============================================================
// WorldMap — MapLibre-GL backed intelligence map for /sales/geography.
//
// Data model (post 2026-05-21 refactor):
//
//   * **Office points** (migration 042) — per-(lat, lng) aggregates from
//     Shopify shipping_address. Available for store_bg only today (the
//     other schemas have PII-redacted payloads — see
//     feedback_foreign_store_pii_redacted_payloads.md). Renders as
//     individual clusterable points: at low zoom they merge into one
//     mass over Bulgaria; at zoom 8+ they break into per-district
//     groups; at zoom 13+ into per-Speedy/Econt-office dots.
//
//   * **City centroids** (existing) — used only as fallback for
//     countries that have NO office points (i.e., the foreign-store
//     schemas). Same alias resolution against `src/lib/geo/cities.ts`.
//
//   The two feed a single MapLibre source. The country filter happens
//   client-side: any country code present in office points is excluded
//   from the city-centroid set, so we never double-count БГ.
//
// Choropleth:
//
//   Country fills are gone. The earlier green colour-mix tinting fought
//   with the dot story (operator feedback: "цветните части не помагат").
//   Replaced by:
//
//   * `countries-fill` — kept as an invisible hit-test surface so
//     clicking inside a country still selects it.
//   * `countries-outline-active` — accent line for any country with
//     sales in the period, subtle (line-opacity 0.45). Communicates
//     "we are present here" without obscuring the basemap.
//   * `countries-outline-selected` — bumped to bold accent line on
//     selection. Same feature-state pattern as before.
//
// Clustering:
//
//   `clusterMaxZoom` lifted from 11 → 16 so the hierarchy "country →
//   city → district → office" reads cleanly across the full zoom range.
//   Below zoom 16 the user is always seeing aggregates; only at extreme
//   zoom do individual office dots emerge.
//
// Stadia auth model:
//   * `localhost` / `127.0.0.1` works out of the box.
//   * Production needs `cvetita-platform.vercel.app` registered under
//     "Add Domain" in the Stadia dashboard. No API key in client code.
// ============================================================

export type Metric = "revenue" | "orders" | "customers";

interface WorldMapProps {
  data: CountrySales[];
  cities?: CitySales[];
  /** Per-office order points (migration 042). Empty for schemas with
   *  PII-redacted webhooks; those markets fall back to city centroids. */
  orderPoints?: OfficePoint[];
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
      kind: "office";
      countryCode: string;
      city: string;
      address1: string;
      zip: string;
      revenue: number;
      orders: number;
      customers: number;
      x: number;
      y: number;
    }
  | {
      // Country-anchor marker — single dot at the capital for markets
      // with no city/office detail (PII-redacted foreign stores).
      kind: "country-marker";
      countryCode: string;
      anchorName: string;
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

const STADIA_STYLE_URL =
  "https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json";

const INITIAL_CENTER: [number, number] = [15, 48];
const INITIAL_ZOOM = 3.5;

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString("bg-BG")} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG");
}

// Strip Shopify's "Офис Speedy XYZ - ABC: Street ..." prefix down to
// the readable office name. Keeps the tooltip from blowing past 240px
// on long addresses while preserving the meaningful identifier.
function shortAddress(addr: string): string {
  if (!addr) return "";
  const m = addr.match(/^Офис\s+(Speedy|Econt)\s+(.+?)(:|$)/i);
  if (m) return `${m[1]} ${m[2]}`;
  return addr.length > 50 ? addr.slice(0, 47) + "…" : addr;
}

// ============================================================
// Country GeoJSON — converted from world-110m topojson at module load.
// ============================================================

interface CountryFeatureProperties {
  alpha2: string | null;
  name: string;
}

const COUNTRIES_GEOJSON: FeatureCollection<Geometry, CountryFeatureProperties> = (() => {
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
      id: undefined,
      properties: {
        alpha2: numericToAlpha2(f.id),
        name: f.properties?.name ?? "—",
      },
    })),
  };
})();

// ============================================================
// Marker features — unified office-point + city-centroid feature
// collection. Office points (per-(lat,lng) aggregates) take precedence;
// city centroids fill in for any country with no office data.
// ============================================================

// MapLibre GeoJSON features only carry primitive properties — we serialise
// the marker discriminant + payload as primitive fields.
//
// Three marker kinds form a fallback cascade per country:
//
//   1. `office` — per-(lat, lng) Speedy/Econt point from migration 042.
//      Available wherever Shopify delivers shipping_address.latitude
//      (currently store_bg only).
//
//   2. `city`   — city centroid from cities.ts alias lookup. Filled in
//      for countries that have city-level data but no per-office.
//
//   3. `country` — single anchor dot at the country's capital. Last-
//      resort fallback for countries whose payloads strip everything
//      including the city field (foreign-store PII redaction). Without
//      this pass the user sees a market in the side list but no dot
//      anywhere on the map.
//
// The passes are mutually exclusive per country: as soon as one pass
// places a marker for country X, the next pass skips X. So БГ gets
// office dots (and only office dots); a country like Greece that has
// no office data but has city-level coverage gets city dots; one
// like Cyprus or Italy whose payloads are fully redacted gets a
// single country dot at the capital.
interface MarkerProps {
  kind: "office" | "city" | "country";
  countryCode: string;
  city: string;
  address1: string;
  zip: string;
  revenue: number;
  orders: number;
  customers: number;
  metricValue: number;
}

function buildMarkerFeatureCollection(
  orderPoints: OfficePoint[],
  cities: CitySales[],
  countries: CountrySales[],
  metric: Metric
): FeatureCollection<Geometry, MarkerProps> {
  // Cumulative set of countries already covered by a marker in some
  // earlier pass — drives the fallback cascade.
  const covered = new Set<string>();
  const features: Feature<Geometry, MarkerProps>[] = [];

  // Pass 1: office points.
  for (const p of orderPoints) {
    covered.add(p.countryCode);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        kind: "office",
        countryCode: p.countryCode,
        city: p.city,
        address1: p.address1,
        zip: p.zip,
        revenue: p.revenue,
        orders: p.orders,
        customers: p.customers,
        metricValue: p[metric],
      },
    });
  }

  // Pass 2: city centroids — only for countries not yet covered.
  const citiesAddedFor = new Set<string>();
  for (const c of cities) {
    if (covered.has(c.countryCode)) continue;
    const entry = lookupCity(c.countryCode, c.city);
    if (!entry) continue;
    citiesAddedFor.add(c.countryCode);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [entry.lng, entry.lat] },
      properties: {
        kind: "city",
        countryCode: c.countryCode,
        city: entry.name,
        address1: "",
        zip: "",
        revenue: c.revenue,
        orders: c.orders,
        customers: c.customers,
        metricValue: c[metric],
      },
    });
  }
  for (const code of citiesAddedFor) covered.add(code);

  // Pass 3: country-anchor dots — for countries with sales but no
  // markers yet. Lands at the capital lat/lng so the dot reads as
  // "Italy as a whole" rather than "this exact city".
  for (const c of countries) {
    if (covered.has(c.countryCode)) continue;
    if (c[metric] <= 0) continue;
    const anchor = lookupCountryAnchor(c.countryCode);
    if (!anchor) continue;
    covered.add(c.countryCode);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [anchor.lng, anchor.lat] },
      properties: {
        kind: "country",
        countryCode: c.countryCode,
        // Anchor name kept on the feature for the tooltip header,
        // even though the tooltip leads with the country name.
        city: anchor.name,
        address1: "",
        zip: "",
        revenue: c.revenue,
        orders: c.orders,
        customers: c.customers,
        metricValue: c[metric],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

// ============================================================
// Main component
// ============================================================

export function WorldMap({
  data,
  cities = [],
  orderPoints = [],
  metric,
  selectedCountry,
  onSelectCountry,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const styleLoadedRef = useRef(false);
  const onSelectCountryRef = useRef(onSelectCountry);
  const selectedCountryRef = useRef<string | null | undefined>(selectedCountry);
  useEffect(() => {
    onSelectCountryRef.current = onSelectCountry;
  }, [onSelectCountry]);
  useEffect(() => {
    selectedCountryRef.current = selectedCountry;
  }, [selectedCountry]);

  const [hover, setHover] = useState<HoverState | null>(null);

  const byAlpha2 = useMemo(() => {
    const m = new Map<string, CountrySales>();
    for (const c of data) m.set(c.countryCode, c);
    return m;
  }, [data]);

  const totalRevenue = useMemo(
    () => data.reduce((s, c) => s + c.revenue, 0),
    [data]
  );

  // Country outline expression — accent stroke for any country with
  // sales in the period, transparent elsewhere. Replaces the previous
  // fill-color expression (fills were removed; the dot layer carries
  // the geographic answer now).
  const outlineExpression = useMemo(() => {
    const active = data.filter((c) => c[metric] > 0);
    if (active.length === 0) return "transparent" as const;
    const pairs: string[] = [];
    for (const c of active) {
      pairs.push(c.countryCode);
      pairs.push("rgba(34, 197, 94, 0.55)");
    }
    return [
      "match",
      ["get", "alpha2"],
      ...pairs,
      "transparent",
    ];
  }, [data, metric]);

  // Marker source GeoJSON, rebuilt when inputs change.
  const markerGeoJSON = useMemo(
    () => buildMarkerFeatureCollection(orderPoints, cities, data, metric),
    [orderPoints, cities, data, metric]
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
      cooperativeGestures: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      "top-right"
    );

    map.on("load", () => {
      styleLoadedRef.current = true;

      // ----- Country source + outline layers ---------------------------
      map.addSource("countries", {
        type: "geojson",
        data: COUNTRIES_GEOJSON,
        promoteId: "alpha2",
      });

      // Invisible fill — kept so clicking inside a country still
      // selects it and queryRenderedFeatures hits the country geometry
      // for tooltip resolution. fill-color stays transparent forever.
      map.addLayer({
        id: "countries-fill",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": "rgba(0,0,0,0)",
          "fill-opacity": 1,
        },
      });

      // Active outline — accent for any country with sales. Subtle
      // (0.55 line opacity) so it reads as presence, not as fill.
      map.addLayer({
        id: "countries-outline-active",
        type: "line",
        source: "countries",
        paint: {
          "line-color": "transparent",
          "line-width": 1,
        },
      });

      // Selected outline — bold accent on top of everything else.
      map.addLayer({
        id: "countries-outline-selected",
        type: "line",
        source: "countries",
        paint: {
          "line-color": "rgb(34, 197, 94)",
          "line-width": 2,
          "line-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            1,
            0,
          ],
        },
      });

      // ----- Marker source (office points + city fallbacks) ----------
      map.addSource("markers", {
        type: "geojson",
        data: markerGeoJSON,
        cluster: true,
        clusterRadius: 38,
        // Keep clustering active up to street-level zoom so the
        // hierarchy "country → city → district → office" reads
        // cleanly. Only at extreme zoom do individual office dots
        // emerge.
        clusterMaxZoom: 16,
        clusterProperties: {
          sum_metric: ["+", ["get", "metricValue"]],
          sum_revenue: ["+", ["get", "revenue"]],
          sum_orders: ["+", ["get", "orders"]],
        },
      });

      // Cluster halo — accent at low opacity. Size is purely a
      // function of the cluster's aggregate weight; log10 keeps the
      // mapping honest at any scale (a single market with 50k orders
      // shouldn't blow up the canvas; a market with 3 orders should
      // still read as a cluster, not a stray dot).
      //
      // log10(sum) mapping:
      //   1 order   → log10=0   → 14px (the visual floor for a cluster)
      //   10        → log10=1   → 19px
      //   100       → log10=2   → 24px
      //   1000      → log10=3   → 30px
      //   10000     → log10=4   → 36px
      //
      // No data-tied thresholds — the gradient stretches with whatever
      // data exists.
      map.addLayer({
        id: "marker-clusters",
        type: "circle",
        source: "markers",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgb(34, 197, 94)",
          "circle-opacity": 0.22,
          "circle-radius": [
            "interpolate",
            ["linear"],
            [
              "log10",
              [
                "max",
                1,
                ["coalesce", ["get", "sum_orders"], ["get", "point_count"], 1],
              ],
            ],
            0, 14,
            1, 19,
            2, 24,
            3, 30,
            4, 36,
          ],
          "circle-stroke-color": "rgb(34, 197, 94)",
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.6,
        },
      });
      // Cluster label shows summed ORDERS, not feature count.
      // `point_count` (the MapLibre default) is "how many features
      // merged here" — useful for clustering diagnostics, but the
      // operator's mental model is "how many orders" because that's
      // what the side panel shows. Mismatched numbers ("сайдбар:
      // 1628, карта: 997") would correctly raise "is something
      // missing?", which is the bug that triggered this change.
      // Same field as the hover tooltip count so the two read
      // consistently.
      //
      // Plain `to-string` of the coalesced count — no abbreviation,
      // no decimals, no chained operators. The earlier
      // case+concat+number-format chain silently broke cluster
      // rendering altogether (the cluster halo + symbol layers both
      // disappeared, surfacing as bare 5px dots over БГ). A flat
      // to-string has none of those failure modes, and for our scale
      // (max ~10k orders per cluster) the raw number fits in the
      // 30-36px cluster circle.
      map.addLayer({
        id: "marker-cluster-count",
        type: "symbol",
        source: "markers",
        filter: ["has", "point_count"],
        layout: {
          "text-field": [
            "to-string",
            ["coalesce", ["get", "sum_orders"], ["get", "point_count"]],
          ],
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

      // Invisible hit-area layer — 12px transparent circles behind the
      // visible dots so even single-order offices stay clickable.
      map.addLayer({
        id: "marker-hit",
        type: "circle",
        source: "markers",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": 12,
        },
      });

      // Visible dot — single size for all unclustered points. The
      // cluster sizing already tells the magnitude story; per-marker
      // size differentiation would just add noise at the office level
      // where most points represent 1-15 orders.
      map.addLayer({
        id: "marker-dots",
        type: "circle",
        source: "markers",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "rgb(34, 197, 94)",
          "circle-opacity": 0.95,
          "circle-radius": 5,
          "circle-stroke-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "rgb(34, 197, 94)",
            "#0b0d10",
          ],
          "circle-stroke-width": 1.4,
        },
      });

      // Initial paint of the country outline expression.
      if (outlineExpression !== "transparent") {
        map.setPaintProperty(
          "countries-outline-active",
          "line-color",
          outlineExpression as unknown as maplibregl.ExpressionSpecification
        );
      }

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

        // Marker hits take priority — hit layer first for forgiving
        // target size, visible dots as backup.
        const markerFeatures = map.queryRenderedFeatures(e.point, {
          layers: ["marker-hit", "marker-dots"],
        });
        if (markerFeatures.length > 0) {
          const f = markerFeatures[0];
          const p = f.properties as MarkerProps;
          setCountryHoverState(null);
          map.getCanvas().style.cursor = "pointer";
          if (p.kind === "office") {
            setHover({
              kind: "office",
              countryCode: p.countryCode,
              city: p.city,
              address1: p.address1,
              zip: p.zip,
              revenue: Number(p.revenue),
              orders: Number(p.orders),
              customers: Number(p.customers),
              x,
              y,
            });
          } else if (p.kind === "country") {
            setHover({
              kind: "country-marker",
              countryCode: p.countryCode,
              anchorName: p.city,
              revenue: Number(p.revenue),
              orders: Number(p.orders),
              customers: Number(p.customers),
              x,
              y,
            });
          } else {
            setHover({
              kind: "city",
              countryCode: p.countryCode,
              cityName: p.city,
              revenue: Number(p.revenue),
              orders: Number(p.orders),
              customers: Number(p.customers),
              x,
              y,
            });
          }
          return;
        }

        const clusterFeatures = map.queryRenderedFeatures(e.point, {
          layers: ["marker-clusters"],
        });
        if (clusterFeatures.length > 0) {
          const f = clusterFeatures[0];
          const p = f.properties as {
            point_count: number;
            sum_revenue: number;
            sum_orders: number;
          };
          setCountryHoverState(null);
          map.getCanvas().style.cursor = "pointer";
          setHover({
            kind: "cluster",
            count: Number(p.sum_orders ?? p.point_count),
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

      // Cluster click → zoom into the cluster.
      map.on("click", "marker-clusters", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const clusterId = (f.properties as { cluster_id: number }).cluster_id;
        const src = map.getSource("markers") as GeoJSONSource;
        try {
          const zoom = await src.getClusterExpansionZoom(clusterId);
          const coords = (f.geometry as unknown as {
            coordinates: [number, number];
          }).coordinates;
          map.easeTo({ center: coords, zoom });
        } catch {
          // Cluster may vanish between query + promise resolve.
        }
      });

      // Marker click → select country (via the forgiving hit layer).
      map.on("click", "marker-hit", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as MarkerProps;
        const cb = onSelectCountryRef.current;
        if (cb) {
          cb(p.countryCode === selectedCountryRef.current ? null : p.countryCode);
        }
      });

      // Country fill click → toggle selection.
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
  }, []);

  // ----- Sync: outline paint when data/metric change -------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    if (!map.getLayer("countries-outline-active")) return;
    map.setPaintProperty(
      "countries-outline-active",
      "line-color",
      (outlineExpression === "transparent"
        ? "transparent"
        : outlineExpression) as unknown as maplibregl.ExpressionSpecification
    );
  }, [outlineExpression]);

  // ----- Sync: marker source data --------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const src = map.getSource("markers") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(markerGeoJSON);
  }, [markerGeoJSON]);

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
      style={{ position: "relative" }}
    >
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
      {hover?.kind === "office" && (
        <TooltipShell x={hover.x} y={hover.y}>
          <OfficeTooltipBody
            countryCode={hover.countryCode}
            city={hover.city}
            address1={hover.address1}
            zip={hover.zip}
            revenue={hover.revenue}
            orders={hover.orders}
            customers={hover.customers}
          />
        </TooltipShell>
      )}
      {hover?.kind === "country-marker" && (
        <TooltipShell x={hover.x} y={hover.y}>
          <CountryMarkerTooltipBody
            countryCode={hover.countryCode}
            anchorName={hover.anchorName}
            revenue={hover.revenue}
            orders={hover.orders}
            customers={hover.customers}
            totalRevenue={totalRevenue}
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
// Tooltip components
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
        px-3 py-2.5 min-w-[200px] max-w-[280px]
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

function OfficeTooltipBody({
  countryCode,
  city,
  address1,
  zip,
  revenue,
  orders,
  customers,
}: {
  countryCode: string;
  city: string;
  address1: string;
  zip: string;
  revenue: number;
  orders: number;
  customers: number;
}) {
  const short = shortAddress(address1);
  return (
    <>
      <div className="flex items-center gap-2 text-text font-medium text-[11.5px]">
        <MarketFlag market={countryCode.toLowerCase()} size={14} />
        <span className="truncate">{short || city || "Адрес"}</span>
      </div>
      {(city || zip) && (
        <div className="text-text-3 text-[10.5px] mt-0.5">
          {[zip, city].filter(Boolean).join(" · ")}
        </div>
      )}
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        <span className="text-text-3">Поръчки</span>
        <span className="text-text font-semibold tabular-nums text-right">
          {fmtInt(orders)}
        </span>
        <span className="text-text-3">Сума</span>
        <span className="text-text-2 tabular-nums text-right">
          {fmtEur(revenue)}
        </span>
        {customers > 0 && customers !== orders && (
          <>
            <span className="text-text-3">Клиенти</span>
            <span className="text-text-2 tabular-nums text-right">
              {fmtInt(customers)}
            </span>
          </>
        )}
      </div>
    </>
  );
}

function CountryMarkerTooltipBody({
  countryCode,
  anchorName,
  revenue,
  orders,
  customers,
  totalRevenue,
}: {
  countryCode: string;
  anchorName: string;
  revenue: number;
  orders: number;
  customers: number;
  totalRevenue: number;
}) {
  const sharePct =
    totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 100) : null;
  return (
    <>
      <div className="flex items-center gap-2 text-text font-medium text-[11.5px]">
        <MarketFlag market={countryCode.toLowerCase()} size={14} />
        <span>{countryDisplayName(countryCode, countryCode)}</span>
      </div>
      <div className="text-text-3 text-[10.5px] mt-0.5">
        Цялата държава · детайл по град не е наличен
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
        {sharePct !== null && (
          <>
            <span className="text-text-3">Дял</span>
            <span className="text-accent font-semibold tabular-nums text-right">
              {sharePct >= 1 ? `${sharePct}%` : "<1%"}
            </span>
          </>
        )}
      </div>
      <div className="text-text-3 text-[10px] mt-1.5 italic">
        Анкорна точка: {anchorName}
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
        {fmtInt(count)} поръчки в района
      </div>
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        <span className="text-text-3">Сума</span>
        <span className="text-text font-semibold tabular-nums text-right">
          {fmtEur(revenue)}
        </span>
      </div>
      <div className="text-text-3 text-[10.5px] mt-1.5">
        Кликни, за да приближиш и видиш по места.
      </div>
    </>
  );
}
