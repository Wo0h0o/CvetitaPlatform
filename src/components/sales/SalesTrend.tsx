"use client";

import { useAnalyticsSWR } from "@/hooks/useAnalyticsSWR";
import { useMemo } from "react";
import {
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
} from "recharts";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
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
  fmtBgDate,
  fmtEur,
  fmtEurFull,
  fmtHourFromIso,
} from "@/lib/format";

// ============================================================
// SalesTrend — daily revenue line, but with two upgrades:
//
//   1. Comparison overlay — dashed grey line for the equal-length
//      preceding period, aligned by INDEX (day-1-of-prev under day-1-of-
//      current), not by date. So you instantly see whether the curve is
//      sitting above or below last time.
//
//   2. Peak annotation — a small accent dot at the highest-revenue day,
//      labelled in the corner of the card so the user reads it without
//      hovering. This is the "What was your best day?" answer.
//
// Tooltip shows: bucket date, current value, prior value, % delta.
// Same visual language as HeroCard's TempoTooltip on /home.
// ============================================================


interface TrendResponse {
  series: { date: string; revenue: number; orders: number }[];
  error?: string;
}

interface ChartRow {
  i: number;
  date: string;
  compDate: string | null;
  revenue: number;
  compRevenue: number | null;
}


// ============================================================
// Tooltip data — one builder, two callsites. Recharts' hover tooltip
// (desktop) wraps this via buildRechartsTooltip(); the mobile scrubber
// flow renders <GlassTooltip {...buildTrendPopup(row, hourly)} /> as
// an inline card above the slider.
// ============================================================

function buildTrendPopup(
  row: ChartRow,
  hourly: boolean
): { header: string; rows: GlassTooltipRow[]; minWidth: number } {
  const baseRows: GlassTooltipRow[] = [
    { label: "Приходи", value: fmtEurFull(row.revenue) },
  ];
  if (row.compRevenue !== null) {
    baseRows.push({
      label: "Пр. период",
      value: fmtEur(row.compRevenue),
      accent: deltaAccent(row.revenue, row.compRevenue),
    });
  }
  return {
    header: hourly ? `${fmtHourFromIso(row.date)} ч.` : fmtBgDate(row.date),
    rows: baseRows,
    minWidth: 200,
  };
}

// ============================================================
// Main export
// ============================================================

export function SalesTrend() {
  const { queryString, compFrom, compTo, from, to } = useDateRange();
  const { storeParam } = useStoreSelection();
  const c = useChartColors();

  // Switch to hourly when the user picks a single day (Днес / Вчера /
  // custom from===to). Otherwise the trend collapses to one data point
  // and Recharts renders an empty SVG.
  const hourly = from === to;
  const granularitySuffix = hourly ? "&granularity=hour" : "";

  const { data: cur, isLoading, error, mutate } = useAnalyticsSWR<TrendResponse>(
    `/api/sales/trend?${queryString}&${storeParam}${granularitySuffix}`
  );

  // Comparison period — reuse the same /api/sales/trend endpoint with
  // explicit custom from/to. Keys are unique so SWR caches both.
  const compQs = `preset=custom&from=${compFrom}&to=${compTo}`;
  const { data: comp } = useAnalyticsSWR<TrendResponse>(
    compFrom && compTo
      ? `/api/sales/trend?${compQs}&${storeParam}${granularitySuffix}`
      : null
  );

  // Zip into Recharts-friendly rows, aligned by INDEX so the chart shows
  // "day 1 vs prior day 1", not literal calendar overlap.
  const rows: ChartRow[] = useMemo(() => {
    const a = cur?.series ?? [];
    const b = comp?.series ?? [];
    return a.map((d, i) => ({
      i,
      date: d.date,
      compDate: b[i]?.date ?? null,
      revenue: d.revenue,
      compRevenue: b[i] ? b[i].revenue : null,
    }));
  }, [cur?.series, comp?.series]);

  const peak = useMemo(() => {
    if (rows.length === 0) return null;
    let p = rows[0];
    for (const r of rows) {
      if (r.revenue > p.revenue) p = r;
    }
    return p.revenue > 0 ? p : null;
  }, [rows]);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalComp = rows.reduce((s, r) => s + (r.compRevenue ?? 0), 0);
  const totalDelta =
    totalComp > 0 ? Math.round(((totalRevenue - totalComp) / totalComp) * 100) : null;

  // Mobile scrubber — slider input + chart-touch input share the same
  // activeIdx; persistence on release is the hook's contract.
  const { activeIdx, setActiveIdx, wrapperRef, pointerHandlers } =
    useChartScrubber({ count: rows.length });

  if (error) {
    return (
      <Card>
        <CardHeader>Тренд на приходите</CardHeader>
        <CardBody>
          <ErrorState error={error} onRetry={() => mutate()} />
        </CardBody>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>Тренд на приходите</CardHeader>
        <CardBody>
          <Skeleton className="h-[260px] w-full" />
        </CardBody>
      </Card>
    );
  }

  const peakBadge = peak ? (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-text-3">
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: c.accent }}
      />
      Пик:{" "}
      {hourly
        ? `${fmtHourFromIso(peak.date)} ч.`
        : fmtBgDate(peak.date)}{" "}
      • {fmtEur(peak.revenue)}
    </span>
  ) : null;

  const totalBadge =
    totalDelta !== null ? (
      <span
        className={`text-[11px] tabular-nums ${
          totalDelta > 1
            ? "text-accent"
            : totalDelta < -1
              ? "text-red"
              : "text-text-3"
        }`}
      >
        {totalDelta > 0 ? "▲" : totalDelta < 0 ? "▼" : "—"} {Math.abs(totalDelta)}%
        <span className="text-text-3 ml-1">срв. пр. период</span>
      </span>
    ) : null;

  return (
    <Card>
      <CardHeader
        action={
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-[13px] font-semibold text-text tabular-nums">
              {fmtEurFull(totalRevenue)}
            </span>
            {totalBadge}
          </div>
        }
      >
        Тренд на приходите
      </CardHeader>
      <CardBody>
        {peakBadge && <div className="mb-2">{peakBadge}</div>}
        {/* Chart wrapper owns the touch scrubber: pointer-events on
            .recharts-wrapper are muted by globals.css on mobile, so
            finger taps land on this div and drive useChartScrubber.
            touch-pan-y leaves vertical page scrolling intact. */}
        <div
          ref={wrapperRef}
          {...pointerHandlers}
          className="h-[240px] -mx-2 touch-pan-y"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
            >
              <defs>
                <linearGradient id="salesTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.accent} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={c.grid}
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: c.text3 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) =>
                  hourly ? fmtHourFromIso(String(v)) : fmtBgDate(String(v))
                }
                minTickGap={hourly ? 18 : 28}
              />
              <YAxis
                tick={{ fontSize: 11, fill: c.text3 }}
                tickLine={false}
                axisLine={false}
                width={46}
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
                wrapperStyle={{ outline: "none" }}
                cursor={{
                  stroke: c.text3,
                  strokeWidth: 1,
                  strokeDasharray: "2 2",
                }}
                content={buildRechartsTooltip<ChartRow>((row) =>
                  buildTrendPopup(row, hourly)
                )}
              />
              {/* Comparison line first so the accent area paints on top */}
              <Line
                type="monotone"
                dataKey="compRevenue"
                stroke={c.text3}
                strokeWidth={1.2}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke={c.accent}
                strokeWidth={2}
                fill="url(#salesTrendFill)"
                dot={false}
                isAnimationActive={false}
                activeDot={{
                  r: 4,
                  stroke: c.accent,
                  strokeWidth: 2,
                  fill: "var(--surface)",
                }}
              />
              {peak && (
                <ReferenceDot
                  x={peak.date}
                  y={peak.revenue}
                  r={5}
                  fill={c.accent}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )}
              {/* Mobile scrubber cursor — renders only while the
                  operator is dragging the slider below the chart. A
                  dashed vertical line + accent dot give the chart a
                  visible "you are here" marker that mirrors the
                  desktop hover cursor. */}
              {activeIdx !== null && rows[activeIdx] && (
                <>
                  <ReferenceLine
                    x={rows[activeIdx].date}
                    stroke={c.text3}
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                  <ReferenceDot
                    x={rows[activeIdx].date}
                    y={rows[activeIdx].revenue}
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
        <MobileScrubberRow
          visible={activeIdx !== null}
          popup={
            activeIdx !== null && rows[activeIdx] ? (
              <GlassTooltip {...buildTrendPopup(rows[activeIdx], hourly)} />
            ) : null
          }
        >
          <MobileScrubber
            count={rows.length}
            value={activeIdx}
            onChange={setActiveIdx}
          />
        </MobileScrubberRow>
      </CardBody>
    </Card>
  );
}
