"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { useChartColors } from "@/components/charts/ChartContainer";

// ============================================================
// ProductMatrix — the diagnostic signature of /products.
//
// Design contract §9.7 (bubble quadrant). Two metrics position a
// product in one of four quadrants — attention (GA4 sessions) ×
// conversion — and a third (revenue) is the bubble size.
//
// Renderer: hand-rolled SVG, not Recharts. A static sized-marker
// scatter needs scale control Recharts won't give — its plot
// clipPath slices bubbles near a domain edge. Here data scales map
// to the plot rect and bubbles overflow into margins; never clipped.
//
// Layout (desktop lg): the square bubble chart + a rule-based
// "Приоритетни действия" card side by side; the quadrant-grouped
// diagnosis list runs full-width below as the drill-down. Mobile:
// scatter + hover don't work on touch (§13) — action card + list
// carry the diagnosis.
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
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("bg-BG");
}

// ---------- Hover card ----------

interface ScatterPoint extends MatrixProduct {
  cx: number;
  cy: number;
  r: number;
}

function HoverCard({ p }: { p: ScatterPoint }) {
  if (p.quadrant === "insufficient") return null;
  const q = QUADRANTS[p.quadrant];

  return (
    <div className="bg-surface/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-xl p-3 w-[260px]">
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
      <p className="text-[11px] text-text-2 leading-relaxed border-t border-border/70 pt-2">{QUADRANTS[p.quadrant].hint}</p>
    </div>
  );
}

// ---------- Width measure ----------

function useMeasure() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ---------- Bubble quadrant (SVG renderer) ----------

// Nice 1-2-5 ticks across a log domain.
function logTicks(lo: number, hi: number): number[] {
  const ticks: number[] = [];
  const p0 = Math.floor(Math.log10(lo));
  const p1 = Math.ceil(Math.log10(hi));
  for (let p = p0; p <= p1; p++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, p);
      if (v >= lo && v <= hi) ticks.push(v);
    }
  }
  return ticks;
}

function BubbleQuadrant({
  products,
  meta,
}: {
  products: MatrixProduct[];
  meta: MatrixMeta;
}) {
  const c = useChartColors();
  const [ref, W] = useMeasure();
  const [hover, setHover] = useState<ScatterPoint | null>(null);

  // ---- Data model: domains independent of pixel geometry ----
  const model = useMemo(() => {
    const plottable = products.filter((p) => p.quadrant !== "insufficient");
    if (plottable.length === 0 || meta.medianViews <= 0 || meta.medianConversion <= 0) {
      return null;
    }
    const medX = meta.medianViews;
    const medY = meta.medianConversion * 100;

    let loX = Infinity, hiX = 0, maxYData = 0, minZ = Infinity, maxZ = 1;
    for (const p of plottable) {
      loX = Math.min(loX, Math.max(p.ga4Views, 1));
      hiX = Math.max(hiX, p.ga4Views);
      maxYData = Math.max(maxYData, p.conversionRate * 100);
      const z = Math.max(p.revenue, 1);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    // Symmetric log domain around the median → vertical divider centred.
    const spread = Math.max(hiX / medX, medX / loX, 1.2) * 1.12;
    const xLo = medX / spread;
    const xHi = medX * spread;

    // Polylinear Y: [0, median, top] → [bottom, centre, top]. The top
    // stop is the 95th percentile, NOT the raw max — a single freak
    // converter (e.g. 1 sale on 2 sessions) would otherwise compress
    // the whole real cloud into a thin band near the median. Outliers
    // clamp to the top edge; the hover card still shows their true %.
    const sortedConv = plottable.map((p) => p.conversionRate * 100).sort((a, b) => a - b);
    const p95 = sortedConv[Math.min(sortedConv.length - 1, Math.floor(sortedConv.length * 0.95))];
    const maxYTop = Math.max(p95, medY * 1.8, 1);
    const maxYDomain = maxYTop * 1.04;
    const hasYOutliers = maxYData > maxYTop + 0.05;

    // Quadrant tint intensity carries each quadrant's share of total
    // revenue — the money-heavy quadrant visibly glows strongest, so
    // the catalogue's centre of gravity reads at a glance, no text.
    // Hue stays = diagnosis (§1); only opacity is data-driven.
    const qRev: Record<Exclude<Quadrant, "insufficient">, number> = {
      star: 0, leaking: 0, gem: 0, dormant: 0,
    };
    let totalRev = 0;
    for (const p of plottable) {
      const r = Math.max(p.revenue, 0);
      qRev[p.quadrant as Exclude<Quadrant, "insufficient">] += r;
      totalRev += r;
    }
    const tintOpacity = {} as Record<Exclude<Quadrant, "insufficient">, number>;
    for (const k of Object.keys(qRev) as Exclude<Quadrant, "insufficient">[]) {
      tintOpacity[k] = totalRev > 0 ? 0.035 + (qRev[k] / totalRev) * 0.17 : 0.05;
    }

    return { plottable, medX, medY, xLo, xHi, minZ, maxZ, maxYTop, maxYDomain, hasYOutliers, tintOpacity };
  }, [products, meta]);

  // ---- Pixel geometry ----
  const geom = useMemo(() => {
    if (!model || W <= 0) return null;
    const mT = 24, mR = 20, mB = 40, mL = 58;
    // Square plot regardless of container width; cap so it stays sane
    // on ultra-wide monitors.
    const plot = Math.min(W - mL - mR, 680);
    if (plot <= 80) return null;
    const offsetX = (W - mL - mR - plot) / 2;
    const left = mL + offsetX;
    const top = mT;
    const right = left + plot;
    const bottom = top + plot;
    const height = plot + mT + mB;

    const { medY, xLo, xHi, maxYDomain } = model;
    const logLo = Math.log(xLo);
    const logHi = Math.log(xHi);
    const midY = (top + bottom) / 2;

    const xPix = (v: number) =>
      left + ((Math.log(Math.max(v, 1)) - logLo) / (logHi - logLo)) * plot;

    // Bottom half [0, medY] → [bottom, midY]; top half [medY, max] → [midY, top].
    const yPix = (v: number) => {
      if (v <= medY) return bottom - (medY > 0 ? v / medY : 0) * (bottom - midY);
      return midY - ((v - medY) / (maxYDomain - medY)) * (midY - top);
    };

    const rScale = (z: number) => {
      const { minZ, maxZ } = model;
      const t = maxZ > minZ ? (Math.max(z, 1) - minZ) / (maxZ - minZ) : 0.5;
      return 5 + Math.sqrt(Math.max(t, 0)) * 15;
    };

    return { left, top, right, bottom, midY, plot, height, xPix, yPix, rScale };
  }, [model, W]);

  // ---- Points (sorted big→small so small bubbles draw on top) ----
  const points = useMemo<ScatterPoint[]>(() => {
    if (!model || !geom) return [];
    return [...model.plottable]
      .sort((a, b) => b.revenue - a.revenue)
      .map((p) => ({
        ...p,
        cx: geom.xPix(p.ga4Views),
        // Clamp to the domain top so outliers pile at the top edge
        // instead of flying off-scale.
        cy: geom.yPix(Math.min(p.conversionRate * 100, model.maxYDomain)),
        r: geom.rScale(Math.max(p.revenue, 1)),
      }));
  }, [model, geom]);

  if (!model) {
    return (
      <p className="text-[13px] text-text-2 text-center py-12">
        Няма достатъчно продукти с данни за матрицата.
      </p>
    );
  }

  const xTicks = geom ? logTicks(model.xLo, model.xHi) : [];
  const yTickVals = [0, model.medY / 2, model.medY, (model.medY + model.maxYTop) / 2, model.maxYTop];

  return (
    <div ref={ref} className="relative w-full">
      {geom && (
        <svg width={W} height={geom.height} className="block">
          {/* Quadrant tints — four rects, opacity ∝ revenue share */}
          <rect x={geom.left} y={geom.top} width={geom.plot / 2} height={geom.plot / 2}
            fill={c.accent} fillOpacity={model.tintOpacity.gem} />
          <rect x={geom.left + geom.plot / 2} y={geom.top} width={geom.plot / 2} height={geom.plot / 2}
            fill={c.accent} fillOpacity={model.tintOpacity.star} />
          <rect x={geom.left} y={geom.midY} width={geom.plot / 2} height={geom.plot / 2}
            fill={c.text3} fillOpacity={model.tintOpacity.dormant} />
          <rect x={geom.left + geom.plot / 2} y={geom.midY} width={geom.plot / 2} height={geom.plot / 2}
            fill={c.red} fillOpacity={model.tintOpacity.leaking} />

          {/* Plot frame + median dividers */}
          <rect x={geom.left} y={geom.top} width={geom.plot} height={geom.plot}
            fill="none" stroke={c.border} strokeWidth={1} />
          <line x1={geom.left + geom.plot / 2} y1={geom.top} x2={geom.left + geom.plot / 2} y2={geom.bottom}
            stroke={c.border} strokeDasharray="3 3" />
          <line x1={geom.left} y1={geom.midY} x2={geom.right} y2={geom.midY}
            stroke={c.border} strokeDasharray="3 3" />

          {/* Corner labels */}
          <text x={geom.right - 8} y={geom.top + 15} textAnchor="end" fontSize={11} fill={c.text3}>Звезди</text>
          <text x={geom.right - 8} y={geom.bottom - 8} textAnchor="end" fontSize={11} fill={c.text3}>Изтичащи</text>
          <text x={geom.left + 8} y={geom.top + 15} fontSize={11} fill={c.text3}>Скрити перли</text>
          <text x={geom.left + 8} y={geom.bottom - 8} fontSize={11} fill={c.text3}>Спящи</text>

          {/* Y axis ticks */}
          {yTickVals.map((v, i) => (
            <text key={`y${i}`} x={geom.left - 8} y={geom.yPix(v) + 4} textAnchor="end" fontSize={11} fill={c.text3}>
              {v.toFixed(1)}%{i === yTickVals.length - 1 && model.hasYOutliers ? "+" : ""}
            </text>
          ))}
          <text
            x={14} y={geom.top + geom.plot / 2}
            textAnchor="middle" fontSize={11} fill={c.text3}
            transform={`rotate(-90 14 ${geom.top + geom.plot / 2})`}
          >
            Конверсия ↑
          </text>

          {/* X axis ticks */}
          {xTicks.map((v, i) => (
            <text key={`x${i}`} x={geom.xPix(v)} y={geom.bottom + 18} textAnchor="middle" fontSize={11} fill={c.text3}>
              {fmtInt(v)}
            </text>
          ))}
          <text x={geom.left + geom.plot / 2} y={geom.height - 4} textAnchor="middle" fontSize={11} fill={c.text3}>
            Сесии (внимание) →
          </text>

          {/* Headline halo — top revenue products glow (§10 static halo).
              Replaces text labels: the eye finds the winners/leaks with
              no words; identity comes from the hover card. */}
          {points.slice(0, 6).map((p) => {
            const q = QUADRANTS[p.quadrant as Exclude<Quadrant, "insufficient">];
            return (
              <circle
                key={`halo-${p.productId ?? p.title}`}
                cx={p.cx}
                cy={p.cy}
                r={p.r + 7}
                fill={q.fill}
                fillOpacity={0.15}
                style={{ pointerEvents: "none" }}
              />
            );
          })}

          {/* Bubbles */}
          {points.map((p) => {
            const q = QUADRANTS[p.quadrant as Exclude<Quadrant, "insufficient">];
            const isHover = hover?.productId === p.productId && hover?.title === p.title;
            return (
              <circle
                key={p.productId ?? p.title}
                cx={p.cx}
                cy={p.cy}
                r={p.r}
                fill={q.fill}
                fillOpacity={isHover ? Math.min(q.opacity + 0.15, 1) : q.opacity}
                stroke={isHover ? c.text : "var(--surface)"}
                strokeWidth={isHover ? 1.5 : 1}
                style={{ cursor: "pointer", transition: "fill-opacity 120ms" }}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover((h) => (h === p ? null : h))}
              />
            );
          })}

        </svg>
      )}
      {!geom && <div className="h-[460px]" />}

      {/* Hover glass card (§11) — anchored to the bubble */}
      {geom && hover && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: Math.max(134, Math.min(W - 134, hover.cx)),
            top: hover.cy > geom.top + 150 ? hover.cy - hover.r - 10 : hover.cy + hover.r + 10,
            transform: hover.cy > geom.top + 150 ? "translate(-50%, -100%)" : "translate(-50%, 0)",
          }}
        >
          <HoverCard p={hover} />
        </div>
      )}
    </div>
  );
}

// ---------- Priority actions (rule-based, no AI — analytics stays stats-only) ----------

// Recommendation is picked by a fixed rule on the conversion gap, not
// generated. The card surfaces the three biggest revenue leaks: the
// products whose low conversion costs the most vs. the median.
function leakAction(conversionRate: number, medianConversion: number): string {
  if (conversionRate < medianConversion * 0.25)
    return "Конверсията е критично ниска — провери първо цена и наличност, после офертата.";
  if (conversionRate < medianConversion * 0.6)
    return "Силен трафик, слаба конверсия — преоформи офертата и открои ясно ползите на страницата.";
  return "Малко под средното — добави отзиви и подсили call-to-action бутона.";
}

function PriorityActions({
  products,
  meta,
}: {
  products: MatrixProduct[];
  meta: MatrixMeta;
}) {
  const items = useMemo(() => {
    const medConv = meta.medianConversion;
    if (medConv <= 0) return [];
    return products
      .filter((p) => p.quadrant === "leaking" && p.conversionRate > 0 && p.revenue > 0)
      .map((p) => {
        // Same traffic at the median conversion → proportional revenue.
        // Ratio capped at 5× so a near-zero converter can't dominate.
        const ratio = Math.min(medConv / p.conversionRate, 5);
        const potential = p.revenue * ratio;
        return { p, potential, lost: potential - p.revenue };
      })
      .sort((a, b) => b.lost - a.lost)
      .slice(0, 5);
  }, [products, meta.medianConversion]);

  return (
    <Card>
      <CardHeader>Приоритетни действия</CardHeader>
      <CardBody>
        {items.length === 0 ? (
          <p className="text-[13px] text-text-2 text-center py-8">
            Няма изтичащи продукти в този период — каталогът е здрав.
          </p>
        ) : (
          <>
            <p className="text-[12px] text-text-2 mb-3 leading-relaxed">
              Продуктите с най-голям изпуснат приход спрямо средната конверсия ({fmtPct(meta.medianConversion)}).
            </p>
            <div className="space-y-2.5">
              {items.map(({ p, potential, lost }, i) => {
                const body = (
                  <div className="rounded-xl border border-border p-3 hover:bg-surface-2 transition-colors">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-md bg-red/10 text-red text-[11px] font-bold flex-shrink-0">
                        {i + 1}
                      </span>
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0 bg-surface-2" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-surface-2 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-text leading-snug truncate">{p.title}</div>
                        <div className="text-[11px] text-text-3 tabular-nums">
                          {p.ga4Views.toLocaleString("bg-BG")} сес · {fmtPct(p.conversionRate)} конверсия
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-text-2 leading-relaxed">
                      {leakAction(p.conversionRate, meta.medianConversion)}
                    </p>
                    <div className="flex items-baseline gap-1.5 mt-2 pt-2 border-t border-border/70 text-[11px]">
                      <span className="text-text-3">Сега {fmtEur(p.revenue)} · потенциал</span>
                      <span className="text-text font-semibold tabular-nums">~{fmtEur(potential)}</span>
                      <span className="text-red font-medium tabular-nums ml-auto">+{fmtEur(lost)}</span>
                    </div>
                  </div>
                );
                // Items 4–5 only show on lg — 3 on mobile/tablet, 5 on
                // desktop so the card balances the tall matrix beside it.
                const cls = i >= 3 ? "hidden lg:block" : "block";
                return p.handle ? (
                  <Link key={p.title} href={`/products/${p.handle}`} className={cls}>
                    {body}
                  </Link>
                ) : (
                  <div key={p.title} className={cls}>{body}</div>
                );
              })}
            </div>
          </>
        )}
      </CardBody>
    </Card>
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

  if (!meta.ga4Available) {
    return (
      <Card className="mb-6">
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
    // lg: wide square chart + the priority-action card on its right;
    // the full diagnosis list runs full-width below as the drill-down.
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
      {/* Desktop — the bubble quadrant (wide → tall, better spread) */}
      <div className="hidden md:block lg:col-span-3">
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
            <BubbleQuadrant products={products} meta={meta} />
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

      {/* Priority actions — rule-based, right of the matrix */}
      <div className="lg:col-span-2">
        <PriorityActions products={products} meta={meta} />
      </div>

      {/* Quadrant-grouped diagnosis list — full width below */}
      <div className="lg:col-span-5">
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
    </div>
  );
}
