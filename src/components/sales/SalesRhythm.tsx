"use client";

import { useAnalyticsSWR } from "@/hooks/useAnalyticsSWR";
import { useId, useMemo, useState } from "react";
import {
  Area,
  Bar,
  Line,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
import { MetricChips } from "@/components/shared/MetricChips";
import { useChartColors } from "@/components/charts/ChartContainer";
import {
  MobileScrubber,
  MobileScrubberRow,
} from "@/components/charts/MobileScrubber";
import { useChartScrubber } from "@/components/charts/useChartScrubber";
import {
  GlassTooltip,
  buildRechartsTooltip,
  deltaAccent,
  type GlassTooltipRow,
} from "@/components/charts/GlassTooltip";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import {
  addDays,
  countWeekdaysInRange,
  daysInRange,
  sofiaToday,
} from "@/lib/dates";
import { fmtEur, fmtInt } from "@/lib/format";
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


// ============================================================
// Helpers — fold the 168 buckets into the two shapes we render.
//
// Critical detail: the RPC returns SUMS across every occurrence of
// (weekday, hour) within [from, to]. For a 30-day window with 4-5
// Wednesdays, weekday=3 buckets carry the sum of ALL Wednesdays.
// Presenting those raw is what made the operator report "Ср €18k"
// as obviously wrong — it reads as a single-day revenue figure
// against a daily store baseline.
//
// We divide by the count of each weekday in the period to recover
// a typical-occurrence value. Same for the hour strip: per-hour
// sum across all weekdays / total days in period = a typical day's
// hour. Sparkline shape is unchanged (it's proportional); only the
// y-scale becomes intuitive.
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
  /** How many occurrences of this weekday lived in [from, to].
   *  Surfaced into the tooltip header so the operator can sanity-check
   *  "avg of 4 Wednesdays". */
  occurrencesCur: number;
  occurrencesComp: number;
}

interface HourStripRow {
  hour: number;
  current: number;
  comparison: number | null;
}

function pickMetric(b: HourWeekdayBucket, metric: Metric): number {
  return metric === "revenue" ? b.revenue : b.orders;
}

function divSafe(sum: number, count: number): number {
  return count > 0 ? sum / count : 0;
}

function foldByWeekday(
  cur: HourWeekdayBucket[],
  cmp: HourWeekdayBucket[],
  metric: Metric,
  countsCur: Map<number, number>,
  countsComp: Map<number, number>
): WeekdaySeries[] {
  const out: WeekdaySeries[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    const occCur = countsCur.get(wd) ?? 0;
    const occComp = countsComp.get(wd) ?? 0;
    const cells: HourCell[] = [];
    let total = 0;
    let totalComp = 0;
    let anyComp = false;
    for (let h = 0; h <= 23; h++) {
      const curB = cur.find((x) => x.weekday === wd && x.hour === h);
      const cmpB = cmp.find((x) => x.weekday === wd && x.hour === h);
      const cAvg = divSafe(curB ? pickMetric(curB, metric) : 0, occCur);
      total += cAvg;
      let compAvg: number | null = null;
      if (cmpB && occComp > 0) {
        compAvg = divSafe(pickMetric(cmpB, metric), occComp);
        totalComp += compAvg;
        anyComp = true;
      }
      cells.push({ hour: h, current: cAvg, comparison: compAvg });
    }
    out.push({
      weekday: wd,
      cells,
      total,
      totalComp: anyComp ? totalComp : null,
      occurrencesCur: occCur,
      occurrencesComp: occComp,
    });
  }
  return out;
}

function foldByHour(
  cur: HourWeekdayBucket[],
  cmp: HourWeekdayBucket[],
  metric: Metric,
  daysCur: number,
  daysComp: number
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
    out.push({
      hour: h,
      current: divSafe(curSum, daysCur),
      comparison: anyCmp ? divSafe(cmpSum, daysComp) : null,
    });
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
      {/* Total + occurrence count. The value is "average per typical
          [weekday]"; the small "n=4" suffix surfaces how many of that
          weekday lived in the period so the operator can sanity-check
          the average and never reads it as a single-day figure. */}
      <div className="w-20 flex-shrink-0 text-right">
        <div className="text-[12px] font-semibold text-text tabular-nums">
          {series.total > 0 ? fmtTotal(Math.round(series.total)) : "—"}
        </div>
        {series.occurrencesCur > 0 && (
          <div className="text-[10px] text-text-3 tabular-nums leading-tight">
            n={series.occurrencesCur}
          </div>
        )}
      </div>
      <div
        className={`w-14 flex-shrink-0 text-right text-[11px] tabular-nums ${deltaTone}`}
        title={
          series.totalComp !== null
            ? `Средно ${WEEKDAY_FULL[series.weekday - 1].toLowerCase()} (n=${series.occurrencesCur}) спрямо предходен период (n=${series.occurrencesComp})`
            : undefined
        }
      >
        {deltaText}
      </div>
    </div>
  );
}

// ============================================================
// Hour-strip tooltip data — shared between Recharts hover (desktop)
// and the mobile scrubber popup.
// ============================================================

function buildHourStripPopup(
  row: HourStripRow,
  metric: Metric
): { header: string; rows: GlassTooltipRow[] } {
  const fmt = metric === "revenue" ? fmtEur : fmtInt;
  const baseRows: GlassTooltipRow[] = [
    {
      label: metric === "revenue" ? "Приходи" : "Поръчки",
      value: fmt(row.current),
    },
  ];
  if (row.comparison !== null) {
    baseRows.push({
      label: "Пр. период",
      value: fmt(row.comparison),
      accent: deltaAccent(row.current, row.comparison),
    });
  }
  return {
    header: `${String(row.hour).padStart(2, "0")}:00 ч.`,
    rows: baseRows,
  };
}

// ============================================================
// Main export
// ============================================================

export function SalesRhythm() {
  const { compFrom, compTo, from, to } = useDateRange();
  const { storeParam } = useStoreSelection();
  const c = useChartColors();
  const [metric, setMetric] = useState<Metric>("revenue");

  // Complete-days clamp. "Ритъм" presents typical-weekday averages —
  // a partial current day, counted as a full occurrence, dilutes
  // every average it touches (a Thursday viewed at 14:00 lands at
  // ~70% of a real Thursday but still divides by a whole one). So the
  // Rhythm window drops today when the range ends on it: BOTH the
  // numerator (the RPC fetch below) and the divisors (the weekday /
  // day counts) span only complete days. Today's data still lives in
  // the hero strip, the trend, and the day-pulse view.
  const rhythmTo = to === sofiaToday() ? addDays(to, -1) : to;

  // Occurrence counts — the divisors that turn period sums into
  // per-typical-occurrence averages. Recomputed only when the window
  // changes.
  const weekdayCountsCur = useMemo(
    () => countWeekdaysInRange(from, rhythmTo),
    [from, rhythmTo]
  );
  const weekdayCountsComp = useMemo(
    () => (compFrom && compTo ? countWeekdaysInRange(compFrom, compTo) : new Map<number, number>()),
    [compFrom, compTo]
  );
  const daysCur = useMemo(() => daysInRange(from, rhythmTo), [from, rhythmTo]);
  const daysComp = useMemo(
    () => (compFrom && compTo ? daysInRange(compFrom, compTo) : 0),
    [compFrom, compTo]
  );

  // Explicit custom window so the fetch excludes today in lockstep
  // with the divisors above — a `preset=30d` key would let the API
  // resolve `to` back to today and reintroduce the partial day.
  const rhythmQs = `preset=custom&from=${from}&to=${rhythmTo}`;
  const { data: cur, isLoading, error, mutate } = useAnalyticsSWR<HourWeekdayResponse>(
    `/api/sales/hour-weekday?${rhythmQs}&${storeParam}`
  );

  const compQs = `preset=custom&from=${compFrom}&to=${compTo}`;
  const { data: comp } = useAnalyticsSWR<HourWeekdayResponse>(
    compFrom && compTo
      ? `/api/sales/hour-weekday?${compQs}&${storeParam}`
      : null
  );

  const curBuckets = useMemo(() => cur?.buckets ?? [], [cur?.buckets]);
  const cmpBuckets = useMemo(() => comp?.buckets ?? [], [comp?.buckets]);

  const weekdaySeries = useMemo(
    () =>
      foldByWeekday(
        curBuckets,
        cmpBuckets,
        metric,
        weekdayCountsCur,
        weekdayCountsComp
      ),
    [curBuckets, cmpBuckets, metric, weekdayCountsCur, weekdayCountsComp]
  );

  const hourStrip = useMemo(
    () => foldByHour(curBuckets, cmpBuckets, metric, daysCur, daysComp),
    [curBuckets, cmpBuckets, metric, daysCur, daysComp]
  );

  // Hook for the hour strip scrubber. Weekday small-multiples don't
  // need one (each row is <40px tall, slider is overkill; touch
  // tooltips are CSS-muted globally).
  const {
    activeIdx: hourActiveIdx,
    setActiveIdx: setHourActiveIdx,
    wrapperRef: hourWrapperRef,
    pointerHandlers: hourPointerHandlers,
  } = useChartScrubber({ count: hourStrip.length });

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

  // Peak hits the bucket with the highest PER-OCCURRENCE value, not
  // the highest raw sum. Otherwise a "typical Wednesday 18:00" peak
  // is biased toward whichever weekday has the most occurrences in
  // the period (week-of-month effects on 30d windows).
  const peak = useMemo(() => {
    if (curBuckets.length === 0) return null;
    let best: { weekday: number; hour: number; value: number } | null = null;
    for (const b of curBuckets) {
      const occ = weekdayCountsCur.get(b.weekday) ?? 0;
      if (occ <= 0) continue;
      const v = pickMetric(b, metric) / occ;
      if (v <= 0) continue;
      if (!best || v > best.value) best = { weekday: b.weekday, hour: b.hour, value: v };
    }
    return best;
  }, [curBuckets, metric, weekdayCountsCur]);

  const peakWeekday = useMemo(() => {
    let pw: WeekdaySeries | null = null;
    for (const w of weekdaySeries) {
      if (w.total <= 0) continue;
      if (!pw || w.total > pw.total) pw = w;
    }
    return pw;
  }, [weekdaySeries]);

  if (error) {
    return (
      <Card>
        <CardHeader>Ритъм на покупките</CardHeader>
        <CardBody>
          <ErrorState error={error} onRetry={() => mutate()} />
        </CardBody>
      </Card>
    );
  }

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
      {metric === "revenue"
        ? fmtEur(peak.value)
        : `${fmtInt(Math.round(peak.value))} поръчки`}{" "}
      <span className="text-text-3/80">(средно)</span>
    </span>
  ) : null;

  const metricToggle = (
    <MetricChips<Metric>
      size="sm"
      value={metric}
      onChange={setMetric}
      options={[
        { value: "revenue", label: "Приходи" },
        { value: "orders", label: "Поръчки" },
      ]}
    />
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
              Средно
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
          {/* Chart wrapper drives the same scrubber as the slider
              below — finger taps land here (recharts pointer-events
              are CSS-muted on mobile), so chart-touch and slider are
              two input paths into one activeIdx. */}
          <div
            ref={hourWrapperRef}
            {...hourPointerHandlers}
            className="h-[120px] -mx-2 touch-pan-y"
          >
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
                  content={buildRechartsTooltip<HourStripRow>((row) => ({
                    ...buildHourStripPopup(row, metric),
                    minWidth: 180,
                  }))}
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
                {/* Mobile scrubber cursor — see SalesTrend for the
                    rationale. */}
                {hourActiveIdx !== null && hourStrip[hourActiveIdx] && (
                  <>
                    <ReferenceLine
                      x={hourStrip[hourActiveIdx].hour}
                      stroke={c.text3}
                      strokeWidth={1}
                      strokeDasharray="2 2"
                    />
                    <ReferenceDot
                      x={hourStrip[hourActiveIdx].hour}
                      y={hourStrip[hourActiveIdx].current}
                      r={4}
                      fill={c.accent}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {/* Mobile scrubber for the hour strip. The weekday small
              multiples above do not get their own scrubbers — at <40px
              tall each, a slider is overkill and the per-day total +
              delta already lives in the right rail of each row. */}
          <MobileScrubberRow
            visible={hourActiveIdx !== null}
            popup={
              hourActiveIdx !== null && hourStrip[hourActiveIdx] ? (
                <GlassTooltip
                  {...buildHourStripPopup(hourStrip[hourActiveIdx], metric)}
                />
              ) : null
            }
          >
            <MobileScrubber
              count={hourStrip.length}
              value={hourActiveIdx}
              onChange={setHourActiveIdx}
              ariaLabel="Преглед на часовете"
            />
          </MobileScrubberRow>
        </div>
      </CardBody>
    </Card>
  );
}

