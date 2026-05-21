"use client";

import useSWR from "swr";
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
} from "recharts";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { useChartColors } from "@/components/charts/ChartContainer";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import { formatBgDate } from "@/lib/dates";

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString("bg-BG")} EUR`;
}

function fmtEurFull(n: number): string {
  return `${n.toLocaleString("bg-BG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} EUR`;
}

// ============================================================
// Tooltip — glass surface, same vocabulary as KpiStrip's TempoTooltip
// ============================================================

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartRow }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const cur = row.revenue;
  const cmp = row.compRevenue;

  let delta: { text: string; tone: "good" | "bad" | "flat" } | null = null;
  if (cmp !== null && cmp > 0) {
    const pct = Math.round(((cur - cmp) / cmp) * 100);
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
        px-3 py-2.5 min-w-[200px]
        text-[11px] leading-tight
      "
    >
      <div className="text-text font-medium text-[11.5px]">
        {formatBgDate(row.date)}
      </div>
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        <span className="text-text-3">Приходи</span>
        <span className="text-text font-semibold tabular-nums text-right">
          {fmtEurFull(cur)}
        </span>
        {cmp !== null && (
          <>
            <span className="text-text-3">Пр. период</span>
            <span className="text-text-2 tabular-nums text-right">
              <span>{fmtEur(cmp)}</span>
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

export function SalesTrend() {
  const { queryString, compFrom, compTo } = useDateRange();
  const { storeParam } = useStoreSelection();
  const c = useChartColors();

  const { data: cur, isLoading } = useSWR<TrendResponse>(
    `/api/sales/trend?${queryString}&${storeParam}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  // Comparison period — reuse the same /api/sales/trend endpoint with
  // explicit custom from/to. Keys are unique so SWR caches both.
  const compQs = `preset=custom&from=${compFrom}&to=${compTo}`;
  const { data: comp } = useSWR<TrendResponse>(
    compFrom && compTo
      ? `/api/sales/trend?${compQs}&${storeParam}`
      : null,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
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
      Пик: {formatBgDate(peak.date)} • {fmtEur(peak.revenue)}
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
        <div className="h-[240px] -mx-2">
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
                tickFormatter={(v) => formatBgDate(String(v))}
                minTickGap={28}
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
                content={(props) => <TrendTooltip {...props} />}
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
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
