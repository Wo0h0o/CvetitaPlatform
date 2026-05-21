"use client";

import useSWR from "swr";
import { useId, useMemo, useState } from "react";
import {
  Area,
  Bar,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { useChartColors } from "@/components/charts/ChartContainer";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import type { HourWeekdayBucket } from "@/lib/sales-queries";

// ============================================================
// SalesRhythm — multi-day "Ритъм на покупките".
//
// Two layered visualisations, two different questions:
//
//   1. WEEKDAY SMALL MULTIPLES (top)
//      7 horizontal rows, one per ISO weekday Mon..Sun. Each row is a
//      24h smooth-area mini chart of revenue (or orders) summed across
//      every occurrence of that weekday in the period, with a dashed
//      grey overlay for the same weekday in the comparison period.
//      Right rail: weekday total + delta vs prior. Peak weekday gets
//      a left accent rail so the eye finds it without hovering.
//
//   2. HOUR-OF-DAY STRIP (bottom)
//      24 vertical bars summed across all weekdays for the period
//      (counts use Bar, revenue uses Bar too because per-hour totals
//      are bucketised aggregates, not a continuous flow). A dashed
//      line of the same shape for the prior period overlays it.
//
// Why this layout: a 168-cell grid asks the eye to read two
// orthogonal patterns at once. Splitting into "which day" + "which
// hour" lets each row carry one answer and a delta. Same data, but
// the operator can now scan in two seconds what the heatmap forced
// them to stare at.
// ============================================================

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface HourWeekdayResponse {
  buckets: HourWeekdayBucket[];
  error?: string;
}

type Metric = "revenue" | "orders";

const WEEKDAY_SHORT = ["Пон", "Вт", "Ср", "Чет", "Пет", "Сб", "Нд"];
const WEEKDAY_FULL = [
  "Понеделник",
  "Вторник",
  "Сряда",
  "Четвъртък",
  "Петък",
  "Събота",
  "Неделя",
];

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString("bg-BG")} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG");
}

function fmtCompactEur(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

// ============================================================
// Helpers — fold the 168 buckets into the two shapes we render.
// ============================================================

interface HourCell {
  hour: number;
  current: number;
  comparison: number | null;
}

interface WeekdaySeries {
  weekday: number; // 1..7 ISO
  cells: HourCell[];
  total: number;
  totalComp: number | null;
}

interface HourStripRow {
  hour: number;
  current: number;
  comparison: number | null;
}

function pickMetric(b: HourWeekdayBucket, metric: Metric): number {
  return metric === "revenue" ? b.revenue : b.orders;
}

function foldByWeekday(
  cur: HourWeekdayBucket[],
  cmp: HourWeekdayBucket[],
  metric: Metric
): WeekdaySeries[] {
  const out: WeekdaySeries[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    const cells: HourCell[] = [];
    let total = 0;
    let totalComp = 0;
    let anyComp = false;
    for (let h = 0; h <= 23; h++) {
      const curB = cur.find((x) => x.weekday === wd && x.hour === h);
      const cmpB = cmp.find((x) => x.weekday === wd && x.hour === h);
      const cVal = curB ? pickMetric(curB, metric) : 0;
      total += cVal;
      let compVal: number | null = null;
      if (cmpB) {
        compVal = pickMetric(cmpB, metric);
        totalComp += compVal;
        anyComp = true;
      }
      cells.push({ hour: h, current: cVal, comparison: compVal });
    }
    out.push({
      weekday: wd,
      cells,
      total,
      totalComp: anyComp ? totalComp : null,
    });
  }
  return out;
}

function foldByHour(
  cur: HourWeekdayBucket[],
  cmp: HourWeekdayBucket[],
  metric: Metric
): HourStripRow[] {
  const out: HourStripRow[] = [];
  for (let h = 0; h <= 23; h++) {
    let curSum = 0;
    let cmpSum = 0;
    let anyCmp = false;
    for (let wd = 1; wd <= 7; wd++) {
      const curB = cur.find((x) => x.weekday === wd && x.hour === h);
      const cmpB = cmp.find((x) => x.weekday === wd && x.hour === h);
      if (curB) curSum += pickMetric(curB, metric);
      if (cmpB) {
        cmpSum += pickMetric(cmpB, metric);
        anyCmp = true;
      }
    }
    out.push({ hour: h, current: curSum, comparison: anyCmp ? cmpSum : null });
  }
  return out;
}

// ============================================================
// WeekdayRow — one of the 7 small multiples.
// ============================================================

interface WeekdayRowProps {
  series: WeekdaySeries;
  metric: Metric;
  scale: number; // shared y-domain across all 7 rows so heights compare
  isPeak: boolean;
}

function WeekdayRow({ series, metric, scale, isPeak }: WeekdayRowProps) {
  const c = useChartColors();
  // useId because <defs> live in a global SVG namespace inside the
  // page; without unique ids the gradient bleeds across rows.
  const gradId = `rhythmRow-${useId().replace(/:/g, "")}`;

  const delta =
    series.totalComp !== null && series.totalComp > 0
      ? ((series.total - series.totalComp) / series.totalComp) * 100
      : null;

  const deltaText =
    delta === null
      ? "—"
      : Math.abs(delta) < 1
        ? "—"
        : `${delta > 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta))}%`;
  const deltaTone =
    delta === null || Math.abs(delta) < 1
      ? "text-text-3"
      : delta > 0
        ? "text-accent"
        : "text-red";

  const fmtTotal = metric === "revenue" ? fmtEur : fmtInt;

  return (
    <div
      className={`
        flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg
        ${isPeak ? "bg-accent-soft" : ""}
      `}
    >
      <div
        className={`
          w-10 flex-shrink-0 text-[12px] tabular-nums
          ${isPeak ? "text-text font-semibold" : "text-text-2 font-medium"}
        `}
      >
        {WEEKDAY_SHORT[series.weekday - 1]}
      </div>
      <div className="flex-1 min-w-0 h-9">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={series.cells}
            margin={{ top: 2, right: 2, bottom: 0, left: 2 }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.accent} stopOpacity={0.3} />
                <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[0, scale]} />
            {series.cells.some((cell) => cell.comparison !== null) && (
              <Line
                type="monotone"
                dataKey="comparison"
                stroke={c.text3}
                strokeWidth={1}
                strokeDasharray="2 2"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            )}
            <Area
              type="monotone"
              dataKey="current"
              stroke={c.accent}
              strokeWidth={1.5}
              fill={`url(#${gradId})`}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="w-20 flex-shrink-0 text-right">
        <div className="text-[12px] font-semibold text-text tabular-nums">
          {series.total > 0 ? fmtTotal(series.total) : "—"}
        </div>
      </div>
      <div
        className={`w-14 flex-shrink-0 text-right text-[11px] tabular-nums ${deltaTone}`}
        title={
          series.totalComp !== null
            ? `Спрямо ${WEEKDAY_FULL[series.weekday - 1].toLowerCase()} в пр. период`
            : undefined
        }
      >
        {deltaText}
      </div>
    </div>
  );
}

// ============================================================
// HourStripTooltip — glass card, same vocabulary as the rest of /sales.
// ============================================================

interface HourTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: HourStripRow }>;
  metric: Metric;
}

function HourStripTooltip({ active, payload, metric }: HourTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const fmt = metric === "revenue" ? fmtEur : fmtInt;
  const cmp = row.comparison;
  let delta: { text: string; tone: "good" | "bad" | "flat" } | null = null;
  if (cmp !== null && cmp > 0) {
    const pct = Math.round(((row.current - cmp) / cmp) * 100);
    const isFlat = Math.abs(pct) < 1;
    const arrow = isFlat ? "—" : pct > 0 ? "▲" : "▼";
    delta = {
      text: `${arrow} ${Math.abs(pct)}%`,
      tone: isFlat ? "flat" : pct > 0 ? "good" : "bad",
    };
  }
  const toneColor =
    delta?.tone === "good"
      ? "text-accent"
      : delta?.tone === "bad"
        ? "text-red"
        : "text-text-3";
  return (
    <div
      className="
        bg-surface/85 backdrop-blur-xl
        border border-border/60 rounded-xl shadow-xl
        px-3 py-2.5 min-w-[180px]
        text-[11px] leading-tight
      "
    >
      <div className="text-text font-medium text-[11.5px]">
        {String(row.hour).padStart(2, "0")}:00 ч.
      </div>
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        <span className="text-text-3">
          {metric === "revenue" ? "Приходи" : "Поръчки"}
        </span>
        <span className="text-text font-semibold tabular-nums text-right">
          {fmt(row.current)}
        </span>
        {cmp !== null && (
          <>
            <span className="text-text-3">Пр. период</span>
            <span className="text-text-2 tabular-nums text-right">
              <span>{fmt(cmp)}</span>
              {delta && (
                <span className={`${toneColor} ml-2 tabular-nums`}>
                  {delta.text}
                </span>
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Main export
// ============================================================

export function SalesRhythm() {
  const { queryString, compFrom, compTo } = useDateRange();
  const { storeParam } = useStoreSelection();
  const c = useChartColors();
  const [metric, setMetric] = useState<Metric>("revenue");

  const { data: cur, isLoading } = useSWR<HourWeekdayResponse>(
    `/api/sales/hour-weekday?${queryString}&${storeParam}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  const compQs = `preset=custom&from=${compFrom}&to=${compTo}`;
  const { data: comp } = useSWR<HourWeekdayResponse>(
    compFrom && compTo
      ? `/api/sales/hour-weekday?${compQs}&${storeParam}`
      : null,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  const curBuckets = useMemo(() => cur?.buckets ?? [], [cur?.buckets]);
  const cmpBuckets = useMemo(() => comp?.buckets ?? [], [comp?.buckets]);

  const weekdaySeries = useMemo(
    () => foldByWeekday(curBuckets, cmpBuckets, metric),
    [curBuckets, cmpBuckets, metric]
  );

  const hourStrip = useMemo(
    () => foldByHour(curBuckets, cmpBuckets, metric),
    [curBuckets, cmpBuckets, metric]
  );

  // Shared y-domain so the 7 mini-charts are visually comparable. We
  // also use it as the comparison series' ceiling — without a shared
  // domain, a quiet weekday's dashed line would tower because Recharts
  // auto-scales each chart independently.
  const sharedScale = useMemo(() => {
    let m = 0;
    for (const w of weekdaySeries) {
      for (const cell of w.cells) {
        if (cell.current > m) m = cell.current;
        if (cell.comparison !== null && cell.comparison > m) m = cell.comparison;
      }
    }
    // 10% headroom so the area doesn't clip the row's top edge.
    return m > 0 ? m * 1.1 : 1;
  }, [weekdaySeries]);

  const peak = useMemo(() => {
    if (curBuckets.length === 0) return null;
    let pBucket: HourWeekdayBucket | null = null;
    for (const b of curBuckets) {
      const v = pickMetric(b, metric);
      if (v <= 0) continue;
      if (!pBucket || v > pickMetric(pBucket, metric)) pBucket = b;
    }
    return pBucket;
  }, [curBuckets, metric]);

  const peakWeekday = useMemo(() => {
    let pw: WeekdaySeries | null = null;
    for (const w of weekdaySeries) {
      if (w.total <= 0) continue;
      if (!pw || w.total > pw.total) pw = w;
    }
    return pw;
  }, [weekdaySeries]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>Ритъм на покупките</CardHeader>
        <CardBody>
          <Skeleton className="h-[360px] w-full" />
        </CardBody>
      </Card>
    );
  }

  const peakBadge = peak ? (
    <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-text-3">
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: c.accent }}
      />
      Пик: {WEEKDAY_FULL[peak.weekday - 1]}{" "}
      {String(peak.hour).padStart(2, "0")}:00 •{" "}
      {metric === "revenue" ? fmtEur(peak.revenue) : `${fmtInt(peak.orders)} поръчки`}
    </span>
  ) : null;

  const metricToggle = (
    <div className="inline-flex rounded-md bg-surface-2 p-0.5">
      <button
        type="button"
        onClick={() => setMetric("revenue")}
        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
          metric === "revenue"
            ? "bg-surface text-text shadow-xs"
            : "text-text-3 hover:text-text-2"
        }`}
      >
        Приходи
      </button>
      <button
        type="button"
        onClick={() => setMetric("orders")}
        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
          metric === "orders"
            ? "bg-surface text-text shadow-xs"
            : "text-text-3 hover:text-text-2"
        }`}
      >
        Поръчки
      </button>
    </div>
  );

  return (
    <Card>
      <CardHeader
        action={
          <div className="flex items-center gap-3">
            {peakBadge}
            {metricToggle}
          </div>
        }
      >
        Ритъм на покупките
      </CardHeader>
      <CardBody>
        {/* ─── Weekday small multiples ───────────────────────────────── */}
        <div className="mb-1">
          <div className="flex items-center gap-3 px-2 -mx-2 mb-1">
            <div className="w-10 text-[10px] uppercase tracking-wider text-text-3 flex-shrink-0">
              Ден
            </div>
            <div className="flex-1 text-[10px] uppercase tracking-wider text-text-3">
              0 ─ 6 ─ 12 ─ 18 ─ 23 ч.
            </div>
            <div className="w-20 text-right text-[10px] uppercase tracking-wider text-text-3 flex-shrink-0">
              Общо
            </div>
            <div className="w-14 text-right text-[10px] uppercase tracking-wider text-text-3 flex-shrink-0">
              Δ
            </div>
          </div>
          <div className="divide-y divide-border/60">
            {weekdaySeries.map((w) => (
              <WeekdayRow
                key={w.weekday}
                series={w}
                metric={metric}
                scale={sharedScale}
                isPeak={peakWeekday?.weekday === w.weekday}
              />
            ))}
          </div>
        </div>

        {/* ─── Hour-of-day strip ─────────────────────────────────────── */}
        <div className="mt-5 pt-4 border-t border-border/60">
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="text-[12px] font-semibold text-text-2">
              Час от деня (усреднено)
            </h4>
            <span className="text-[11px] text-text-3">
              <span
                className="inline-block w-3 h-[1px] border-t border-dashed mr-1 align-middle"
                style={{ borderColor: c.text3 }}
              />
              пр. период
            </span>
          </div>
          <div className="h-[120px] -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={hourStrip}
                margin={{ top: 6, right: 8, bottom: 4, left: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={c.grid}
                  vertical={false}
                />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 10, fill: c.text3 }}
                  tickLine={false}
                  axisLine={false}
                  interval={2}
                  tickFormatter={(v) => String(v).padStart(2, "0")}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: c.text3 }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v) => {
                    const n = Number(v);
                    if (n >= 1000) return `${Math.round(n / 1000)}k`;
                    return String(Math.round(n));
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: "transparent",
                    border: "none",
                    borderRadius: 0,
                    boxShadow: "none",
                    padding: 0,
                    outline: "none",
                  }}
                  wrapperStyle={{ outline: "none", zIndex: 50 }}
                  cursor={{ fill: "var(--surface-2)", opacity: 0.5 }}
                  content={(props) => (
                    <HourStripTooltip {...props} metric={metric} />
                  )}
                />
                <Bar
                  dataKey="current"
                  fill={c.accent}
                  fillOpacity={0.85}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="comparison"
                  stroke={c.text3}
                  strokeWidth={1.2}
                  strokeDasharray="3 3"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// Tiny helper exported for the parent panel — kept here so the file is
// self-contained for code reviews. Not used externally.
export const __compactEur = fmtCompactEur;
