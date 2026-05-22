"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
  ReferenceLine,
  ReferenceArea,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { useChartColors } from "@/components/charts/ChartContainer";

// ============================================================
// ProductMatrix — the diagnostic signature of /products.
//
// Design contract §9.7 (bubble quadrant). Two metrics position a
// product in one of four quadrants — attention (GA4 sessions) ×
// conversion — and a third (revenue) is the bubble size. The big
// products dominate; the long tail is a calm cloud. The whole
// catalogue fits on one chart because size, not pagination, carries
// the scale.
//
// Desktop: the scatter. Mobile: the same diagnosis collapses to a
// quadrant-grouped list (scatter + hover don't work on touch, §13).
// The list also rides along on desktop as the drill-down companion.
// ============================================================

type Quadrant = "star" | "leaking" | "gem" | "dormant" | "insufficient";

export interface MatrixProduct {
  productId: string | null;
  title: string;
  handle: string | null;
  imageUrl: string | null;
  revenue: number;
  ga4Views: number;
  ga4Purchases: number;
  conversionRate: number;
  quadrant: Quadrant;
}

interface MatrixMeta {
  ga4Available: boolean;
  minViews: number;
  medianViews: number;
  medianConversion: number;
  plottableCount: number;
}

// Quadrants carry a good/bad meaning → accent / red / neutral only
// (§1). Gem is accent at lower weight — opportunity, not yet a win.
const QUADRANTS: Record<
  Exclude<Quadrant, "insufficient">,
  { label: string; hint: string; fill: string; opacity: number; dot: string }
> = {
  star: {
    label: "Звезди",
    hint: "Висок трафик, висока конверсия — печеливш. Пази и скалирай.",
    fill: "var(--accent)",
    opacity: 0.9,
    dot: "bg-accent",
  },
  leaking: {
    label: "Изтичащи",
    hint: "Висок трафик, ниска конверсия — хората разглеждат, но не купуват. Провери цена, оферта, продуктовата страница.",
    fill: "var(--red)",
    opacity: 0.85,
    dot: "bg-red",
  },
  gem: {
    label: "Скрити перли",
    hint: "Нисък трафик, висока конверсия — продават се щом ги видят. Пусни им реклама.",
    fill: "var(--accent)",
    opacity: 0.5,
    dot: "bg-accent/55",
  },
  dormant: {
    label: "Спящи",
    hint: "Нисък трафик, ниска конверсия — спящ продукт. Препозиционирай или спри.",
    fill: "var(--text-3)",
    opacity: 0.6,
    dot: "bg-text-3",
  },
};

// Action-first order — problems and opportunities before the winners.
const GROUP_ORDER: Exclude<Quadrant, "insufficient">[] = [
  "leaking",
  "gem",
  "star",
  "dormant",
];

function fmtEur(n: number): string {
  return `€${Math.round(n).toLocaleString("bg-BG")}`;
}
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ---------- Hover card ----------

interface ScatterPoint extends MatrixProduct {
  x: number;
  y: number;
  z: number;
}

function HoverCard({ active, payload }: { active?: boolean; payload?: { payload?: ScatterPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p || p.quadrant === "insufficient") return null;
  const q = QUADRANTS[p.quadrant];

  return (
    <div className="bg-surface/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-xl p-3 max-w-[260px]">
      <div className="flex items-center gap-2.5 mb-2">
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-surface-2" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-surface-2 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-text leading-snug">{p.title}</div>
          <div className="text-[11px] font-medium" style={{ color: q.fill }}>
            {q.label}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center mb-2">
        <div>
          <div className="text-[13px] font-semibold text-text tabular-nums">{p.ga4Views.toLocaleString("bg-BG")}</div>
          <div className="text-[10px] text-text-3">сесии</div>
        </div>
        <div>
          <div className="text-[13px] font-semibold text-text tabular-nums">{fmtPct(p.conversionRate)}</div>
          <div className="text-[10px] text-text-3">конверсия</div>
        </div>
        <div>
          <div className="text-[13px] font-semibold text-text tabular-nums">{fmtEur(p.revenue)}</div>
          <div className="text-[10px] text-text-3">приходи</div>
        </div>
      </div>
      <p className="text-[11px] text-text-2 leading-relaxed border-t border-border/70 pt-2">{q.hint}</p>
    </div>
  );
}

// ---------- Quadrant list group (mobile primary + desktop companion) ----------

function QuadrantGroup({
  quadrant,
  products,
}: {
  quadrant: Exclude<Quadrant, "insufficient">;
  products: MatrixProduct[];
}) {
  const q = QUADRANTS[quadrant];
  const [open, setOpen] = useState(quadrant === "leaking");
  const [limit, setLimit] = useState(20);

  if (products.length === 0) return null;
  const visible = products.slice(0, limit);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 min-h-[44px] hover:bg-surface-2 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-sm ${q.dot}`} />
          <span className="text-[13px] font-semibold text-text">{q.label}</span>
          <span className="text-[12px] text-text-3">({products.length})</span>
        </span>
        <span className="text-[11px] text-text-3">{open ? "скрий" : "покажи"}</span>
      </button>

      {open && (
        <div className="px-2 pb-2">
          <p className="text-[11px] text-text-3 leading-relaxed px-2 py-2">{q.hint}</p>
          {visible.map((p) => {
            const row = (
              <div className="flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-surface-2 transition-colors">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0 bg-surface-2" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-surface-2 flex-shrink-0" />
                )}
                <span className="text-[12px] font-medium text-text truncate flex-1 min-w-0">{p.title}</span>
                <span className="flex items-center gap-2.5 text-[11px] tabular-nums flex-shrink-0">
                  <span className="text-text-3">{p.ga4Views.toLocaleString("bg-BG")} сес.</span>
                  <span className="text-text-3">{fmtPct(p.conversionRate)}</span>
                  <span className="text-text font-semibold w-14 text-right">{fmtEur(p.revenue)}</span>
                </span>
              </div>
            );
            return p.handle ? (
              <Link key={p.title} href={`/products/${p.handle}`} className="block">
                {row}
              </Link>
            ) : (
              <div key={p.title}>{row}</div>
            );
          })}
          {products.length > limit && (
            <button
              onClick={() => setLimit((l) => l + 20)}
              className="w-full mt-1 py-2 rounded-lg bg-surface-2 text-text-2 text-[12px] font-medium hover:bg-border transition-colors cursor-pointer"
            >
              Покажи още {Math.min(20, products.length - limit)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Main ----------

export function ProductMatrix({
  products,
  meta,
}: {
  products: MatrixProduct[];
  meta: MatrixMeta;
}) {
  const c = useChartColors();

  const byQuadrant = useMemo(() => {
    const map: Record<Quadrant, MatrixProduct[]> = {
      star: [], leaking: [], gem: [], dormant: [], insufficient: [],
    };
    for (const p of products) map[p.quadrant].push(p);
    for (const k of Object.keys(map) as Quadrant[]) {
      map[k].sort((a, b) => b.revenue - a.revenue);
    }
    return map;
  }, [products]);

  // Conversion axis is clamped to 2× the median so the median divider
  // sits at the vertical centre — the chart reads as a real 2×2 matrix
  // instead of a thin strip squashed by a few sky-high outliers. The
  // hover card still shows each product's true conversion.
  const medY = meta.medianConversion * 100;
  const yMax = Math.max(medY * 2, 1);

  const points = useMemo<ScatterPoint[]>(() => {
    const plottable = products.filter((p) => p.quadrant !== "insufficient");
    return plottable.map((p) => ({
      ...p,
      x: p.ga4Views,
      y: Math.min(p.conversionRate * 100, yMax),
      z: Math.max(p.revenue, 1),
    }));
  }, [products, yMax]);

  // Symmetric log domain around the median view-count so the vertical
  // divider is centred too — both axes balanced = four equal quadrants.
  const xDomain = useMemo<[number | string, number | string]>(() => {
    if (points.length === 0 || meta.medianViews <= 0) return ["auto", "auto"];
    let lo = Infinity;
    let hi = 0;
    for (const p of points) {
      lo = Math.min(lo, p.x);
      hi = Math.max(hi, p.x);
    }
    const spread = Math.max(hi / meta.medianViews, meta.medianViews / lo, 1.2);
    return [meta.medianViews / spread, meta.medianViews * spread];
  }, [points, meta.medianViews]);

  if (!meta.ga4Available) {
    return (
      <Card>
        <CardHeader>Матрица на продуктите</CardHeader>
        <CardBody>
          <p className="text-[13px] text-text-2 text-center py-8">
            Матрицата изисква GA4. Свържи GA4 от Настройки.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4 mb-6">
      {/* Desktop — the bubble quadrant */}
      <div className="hidden md:block">
        <Card>
          <CardHeader
            action={
              <span className="text-[11px] text-text-3">
                {meta.plottableCount} продукта · размер = приходи
              </span>
            }
          >
            Матрица: Внимание × Конверсия
          </CardHeader>
          <CardBody>
            {/* Constrained width — a quadrant must read as a square-ish
                grid, not a 3:1 band stretched across a wide monitor. */}
            <div className="h-[460px] max-w-[640px] mx-auto">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 16, right: 24, bottom: 28, left: 8 }}>
                  {/* Quadrant tints — faint, just enough to read the zones */}
                  <ReferenceArea x1={meta.medianViews} y1={medY} fill={c.accent} fillOpacity={0.05} stroke="none" />
                  <ReferenceArea x1={meta.medianViews} y2={medY} fill={c.red} fillOpacity={0.05} stroke="none" />
                  <ReferenceArea x2={meta.medianViews} y1={medY} fill={c.accent} fillOpacity={0.03} stroke="none" />

                  <XAxis
                    type="number"
                    dataKey="x"
                    name="сесии"
                    scale="log"
                    domain={xDomain}
                    allowDataOverflow
                    tick={{ fontSize: 11, fill: c.text3 }}
                    tickLine={false}
                    axisLine={false}
                    label={{ value: "Сесии (внимание) →", position: "bottom", fontSize: 11, fill: c.text3 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="конверсия"
                    unit="%"
                    domain={[0, yMax]}
                    allowDataOverflow
                    tick={{ fontSize: 11, fill: c.text3 }}
                    tickLine={false}
                    axisLine={false}
                    label={{ value: "Конверсия ↑", angle: -90, position: "insideLeft", fontSize: 11, fill: c.text3 }}
                  />
                  <ZAxis type="number" dataKey="z" range={[50, 1100]} />

                  <ReferenceLine x={meta.medianViews} stroke={c.border} strokeDasharray="3 3" />
                  <ReferenceLine y={medY} stroke={c.border} strokeDasharray="3 3" />

                  <Tooltip
                    content={<HoverCard />}
                    cursor={{ strokeDasharray: "3 3", stroke: c.text3 }}
                    wrapperStyle={{ outline: "none", zIndex: 50 }}
                  />

                  <Scatter data={points} isAnimationActive={false}>
                    {points.map((p) => {
                      const q = QUADRANTS[p.quadrant as Exclude<Quadrant, "insufficient">];
                      return (
                        <Cell
                          key={p.title}
                          fill={q.fill}
                          fillOpacity={q.opacity}
                          stroke="var(--surface)"
                          strokeWidth={1}
                        />
                      );
                    })}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            {/* Quadrant legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pt-3 border-t border-border">
              {GROUP_ORDER.map((k) => (
                <span key={k} className="flex items-center gap-1.5 text-[11px] text-text-2">
                  <span className={`w-2.5 h-2.5 rounded-sm ${QUADRANTS[k].dot}`} />
                  {QUADRANTS[k].label}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Quadrant-grouped list — mobile primary, desktop drill-down companion */}
      <Card>
        <CardHeader>Продукти по диагноза</CardHeader>
        <CardBody>
          <div className="space-y-2">
            {GROUP_ORDER.map((k) => (
              <QuadrantGroup key={k} quadrant={k} products={byQuadrant[k]} />
            ))}
            {byQuadrant.insufficient.length > 0 && (
              <div className="border border-border rounded-xl px-4 py-3">
                <span className="text-[12px] text-text-3">
                  Недостатъчно данни ({byQuadrant.insufficient.length}) — под {meta.minViews} сесии,
                  конверсията е твърде шумна за диагноза.
                </span>
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
