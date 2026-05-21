"use client";

import useSWR from "swr";
import { useId, useMemo, useState } from "react";
import {
  Bar,
  Line,
  ComposedChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
  ReferenceLine,
} from "recharts";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { useChartColors } from "@/components/charts/ChartContainer";
import {
  MobileScrubber,
  MobileScrubberRow,
} from "@/components/charts/MobileScrubber";
import {
  GlassTooltip,
  buildRechartsTooltip,
  deltaAccent,
  type GlassTooltipRow,
} from "@/components/charts/GlassTooltip";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";

// ============================================================
// SalesDayPulse — the "Пулс на деня" view rendered when the user picks
// a single Sofia-anchored day (today / yesterday / custom 1-day).
//
// It's a trader-style combo over the 24 hours of the selected day:
//   * Translucent bars (left axis)  = orders count per hour
//   * Solid accent line (right axis) = revenue per hour
//   * Dashed grey line (right axis)  = prior-day revenue per hour
//
// Why combo + dual axis: orders and revenue are mechanically linked —
// more orders mostly means more revenue, but the per-hour AOV story
// lives in the gap between the two. Honest per §9.4 (combo for
// causally-linked metrics) without falling into the §9.5 trap of
// dual-axis correlations that aren't real.
//
// Why we don't draw orders comparison: the visual already carries two
// traces + dashed compare. A second dashed bar series would push the
// chart past the "one question per card" line — orders pace lives in
// the hero strip's Поръчки tile.
// ============================================================

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TrendResponse {
  series: { date: string; revenue: number; orders: number }[];
  error?: string;
}

interface PulseRow {
  hour: number;
  // ISO timestamp `YYYY-MM-DDTHH:00:00` — same shape the trend API
  // emits for hourly granularity; we slice the HH:00 portion for axis
  // labels and the tooltip header.
  iso: string;
  orders: number;
  revenue: number;
  compRevenue: number | null;
  compOrders: number | null;
}

function fmtEur(n: number, dp = 0): string {
  return `${n.toLocaleString("bg-BG", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG");
}

function hourLabel(iso: string): string {
  // Slice instead of `new Date()` — the synthetic ISO has no timezone
  // suffix and parsing it would shift it to the browser's local zone.
  return iso.slice(11, 16);
}

// ============================================================
// Tooltip data — one builder, two callsites. Recharts' hover tooltip
// (desktop) wraps this via buildRechartsTooltip(); the mobile scrubber
// flow renders <GlassTooltip {...buildPulsePopup(row)} /> as an inline
// card above the slider.
// ============================================================

function buildPulsePopup(row: PulseRow): {
  header: string;
  rows: GlassTooltipRow[];
} {
  const baseRows: GlassTooltipRow[] = [
    { label: "Поръчки", value: fmtInt(row.orders) },
    { label: "Приходи", value: fmtEur(row.revenue, 2) },
  ];
  if (row.compRevenue !== null) {
    baseRows.push({
      label: "Пр. ден",
      value: fmtEur(row.compRevenue),
      accent: deltaAccent(row.revenue, row.compRevenue),
    });
  }
  return { header: `${hourLabel(row.iso)} ч.`, rows: baseRows };
}

// ============================================================
// Main export
// ============================================================

export function SalesDayPulse() {
  const { compFrom, compTo, queryString } = useDateRange();
  const { storeParam } = useStoreSelection();
  const c = useChartColors();
  // useId — Recharts <defs> share an SVG-global namespace; a static id
  // would collide if another chart on the page used the same name.
  const gradId = `dayPulse-${useId().replace(/:/g, "")}`;

  // Mobile scrubber state — see SalesTrend for the rationale.
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const { data: cur, isLoading } = useSWR<TrendResponse>(
    `/api/sales/trend?${queryString}&${storeParam}&granularity=hour`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  const compQs = `preset=custom&from=${compFrom}&to=${compTo}&granularity=hour`;
  const { data: comp } = useSWR<TrendResponse>(
    compFrom && compTo
      ? `/api/sales/trend?${compQs}&${storeParam}`
      : null,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  // Zip into a 24-bucket array. The trend API already returns dense
  // zero-filled hours, so a straight map() suffices — we don't need to
  // pad missing hours here.
  const rows: PulseRow[] = useMemo(() => {
    const a = cur?.series ?? [];
    const b = comp?.series ?? [];
    return a.map((d, i) => ({
      hour: i,
      iso: d.date,
      orders: d.orders,
      revenue: d.revenue,
      compRevenue: b[i] ? b[i].revenue : null,
      compOrders: b[i] ? b[i].orders : null,
    }));
  }, [cur?.series, comp?.series]);

  const peak = useMemo(() => {
    if (rows.length === 0) return null;
    let p = rows[0];
    for (const r of rows) if (r.revenue > p.revenue) p = r;
    return p.revenue > 0 ? p : null;
  }, [rows]);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalComp = rows.reduce((s, r) => s + (r.compRevenue ?? 0), 0);
  const totalDelta =
    totalComp > 0
      ? Math.round(((totalRevenue - totalComp) / totalComp) * 100)
      : null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>Пулс на деня</CardHeader>
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
      Пик: {hourLabel(peak.iso)} ч. • {fmtEur(peak.revenue)} •{" "}
      {fmtInt(peak.orders)} поръчки
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
        {totalDelta > 0 ? "▲" : totalDelta < 0 ? "▼" : "—"}{" "}
        {Math.abs(totalDelta)}%
        <span className="text-text-3 ml-1">срв. пр. ден</span>
      </span>
    ) : null;

  return (
    <Card>
      <CardHeader
        action={
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-[13px] font-semibold text-text tabular-nums">
              {fmtEur(totalRevenue, 2)}
            </span>
            {totalBadge}
          </div>
        }
      >
        Пулс на деня
      </CardHeader>
      <CardBody>
        {peakBadge && <div className="mb-2">{peakBadge}</div>}
        {/* Legend — three traces, three vocabularies. Keeps the eye
            honest about what each visual element is doing. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[11px] text-text-3">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: c.accent, opacity: 0.5 }}
            />
            Поръчки / час
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-[2px]"
              style={{ background: c.accent }}
            />
            Приходи / час
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-[1px] border-t border-dashed"
              style={{ borderColor: c.text3 }}
            />
            Пр. ден
          </span>
        </div>
        <div className="h-[260px] -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 8, right: 36, bottom: 4, left: 4 }}
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.accent} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={c.accent} stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={c.grid}
                vertical={false}
              />
              <XAxis
                dataKey="iso"
                tick={{ fontSize: 11, fill: c.text3 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => hourLabel(String(v))}
                interval={2}
              />
              {/* Left axis — orders count. Bars live here. */}
              <YAxis
                yAxisId="orders"
                orientation="left"
                tick={{ fontSize: 11, fill: c.text3 }}
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
              />
              {/* Right axis — revenue. Lines (current + prior) live here. */}
              <YAxis
                yAxisId="revenue"
                orientation="right"
                tick={{ fontSize: 11, fill: c.text3 }}
                tickLine={false}
                axisLine={false}
                width={42}
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
                content={buildRechartsTooltip<PulseRow>((row) => ({
                  ...buildPulsePopup(row),
                  minWidth: 200,
                }))}
              />
              {/* Bars first — they live in the back; the line draws on top
                  so peaks read clearly above the bars. */}
              <Bar
                yAxisId="orders"
                dataKey="orders"
                fill={`url(#${gradId})`}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
                maxBarSize={18}
              />
              {/* Prior-day revenue — drawn before current so accent paints
                  on top, same convention as SalesTrend. */}
              <Line
                yAxisId="revenue"
                type="monotone"
                dataKey="compRevenue"
                stroke={c.text3}
                strokeWidth={1.2}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                yAxisId="revenue"
                type="monotone"
                dataKey="revenue"
                stroke={c.accent}
                strokeWidth={2}
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
                  yAxisId="revenue"
                  x={peak.iso}
                  y={peak.revenue}
                  r={5}
                  fill={c.accent}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )}
              {/* Mobile scrubber cursor — see SalesTrend for the
                  rationale. The reference line lives on the revenue
                  axis so it draws full-height across both axes. */}
              {activeIdx !== null && rows[activeIdx] && (
                <>
                  <ReferenceLine
                    yAxisId="revenue"
                    x={rows[activeIdx].iso}
                    stroke={c.text3}
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                  <ReferenceDot
                    yAxisId="revenue"
                    x={rows[activeIdx].iso}
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
              <GlassTooltip {...buildPulsePopup(rows[activeIdx])} />
            ) : null
          }
        >
          <MobileScrubber
            count={rows.length}
            value={activeIdx}
            onChange={setActiveIdx}
            onRelease={() => setActiveIdx(null)}
          />
        </MobileScrubberRow>
      </CardBody>
    </Card>
  );
}
