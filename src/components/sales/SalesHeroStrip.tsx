"use client";

import useSWR from "swr";
import { useMemo } from "react";
import {
  Area,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Skeleton } from "@/components/shared/Skeleton";
import { Delta } from "@/components/shared/Delta";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import { formatBgDate } from "@/lib/dates";
import type { KpiMetric } from "@/lib/sales-queries";

// ============================================================
// SalesHeroStrip — the headline of /sales.
//
// Three tiles, deliberately asymmetric on desktop:
//   [ Приходи           col-span-6 ][ Поръчки 3 ][ Среден чек 3 ]
//
// On mobile we flip to two rows:
//   [ Приходи                            col-span-2 (full) ]
//   [ Поръчки               1 ][ Среден чек               1 ]
//
// Why asymmetric — Revenue is THE answer the page exists for; the rest
// are supporting. Five equal tiles (the old layout) makes them all read
// as peers, which hides the hierarchy.
//
// Each tile has:
//   - label (text-2, 12-13px)
//   - big tabular-nums value (28-36px depending on tier)
//   - Delta from the design contract (▲/▼ + pct + label)
//   - dual-line sparkline (accent area = current, dashed grey = pr. period)
//   - glass hover-card showing per-day current / pr. period / Δ%
//
// The Revenue tile additionally surfaces "Най-силен ден" — instantly tells
// the operator what the peak was without making them hover the chart.
//
// The glass tooltip mirrors the vocabulary of the /home dashboard's
// TempoTooltip (bg-surface/85 backdrop-blur, hairline divider, label
// →value grid). One consistent "more detail" affordance across pages.
// ============================================================

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface KpisResponse {
  revenue: KpiMetric;
  orders: KpiMetric;
  aov: KpiMetric;
  refunded: KpiMetric;
  customers: KpiMetric;
  error?: string;
}

interface TrendResponse {
  series: { date: string; revenue: number; orders: number }[];
  error?: string;
}

interface ChartRow {
  date: string;
  current: number;
  comparison: number | null;
  compDate: string | null;
}

function fmtEur(n: number, dp = 0): string {
  return `${n.toLocaleString("bg-BG", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })} EUR`;
}

function fmtEurFull(n: number): string {
  return `${n.toLocaleString("bg-BG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG");
}

// БГ short weekday like "Пон" — gives the tooltip header context, so the
// operator doesn't have to count back on the calendar to tell whether a
// €1,200 day was a typical Friday or an off-rhythm Tuesday.
function formatBucketHeader(dateStr: string): string {
  const wd = new Intl.DateTimeFormat("bg-BG", { weekday: "short" })
    .format(new Date(dateStr))
    .replace(".", "");
  const cap = wd.charAt(0).toUpperCase() + wd.slice(1);
  return `${cap}, ${formatBgDate(dateStr)}`;
}

// ============================================================
// SparkTooltip — glass hover card on the spark.
//
// Same visual grammar as the home dashboard's TempoTooltip:
//
//   ┌─────────────────────────┐
//   │ Пон, 12 май              │
//   │ ──────────              │
//   │ Приходи      5 234 EUR   │
//   │ Пр. период   3 020 EUR ▲73% │
//   └─────────────────────────┘
// ============================================================

interface SparkTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartRow }>;
  metricLabel: string;
  formatValue: (n: number) => string;
}

function SparkTooltip({
  active,
  payload,
  metricLabel,
  formatValue,
}: SparkTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const cur = row.current;
  const cmp = row.comparison;

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
        px-3 py-2.5 min-w-[180px]
        text-[11px] leading-tight
      "
    >
      <div className="text-text font-medium text-[11.5px]">
        {formatBucketHeader(row.date)}
      </div>
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        <span className="text-text-3">{metricLabel}</span>
        <span className="text-text font-semibold tabular-nums text-right">
          {formatValue(cur)}
        </span>
        {cmp !== null && (
          <>
            <span className="text-text-3">Пр. период</span>
            <span className="text-text-2 tabular-nums text-right">
              <span>{formatValue(cmp)}</span>
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
// MiniSpark — inline ComposedChart for a KPI tile.
//
// Two traces:
//   * accent Area = current values
//   * dashed grey Line = comparison values (only drawn when ≥1 non-null)
//
// Recharts' Tooltip is wired to render the glass SparkTooltip — same
// glass treatment the home dashboard already uses.
// ============================================================

interface MiniSparkProps {
  rows: ChartRow[];
  metricLabel: string;
  formatValue: (n: number) => string;
  height?: number;
}

function MiniSpark({ rows, metricLabel, formatValue, height = 40 }: MiniSparkProps) {
  if (rows.length < 2) return null;
  const hasComparison = rows.some((r) => r.comparison !== null);
  // Unique gradient id per tile-size — defs nodes share globally inside
  // Recharts so two charts with the same id would visually clash.
  const gradId = `salesHeroSpark${height}`;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            // Strip Recharts' default wrapper — the glass card is the
            // only painted layer.
            contentStyle={{
              background: "transparent",
              border: "none",
              borderRadius: 0,
              boxShadow: "none",
              padding: 0,
              outline: "none",
            }}
            wrapperStyle={{ outline: "none", zIndex: 50 }}
            cursor={{
              stroke: "var(--text-3)",
              strokeWidth: 1,
              strokeDasharray: "2 2",
            }}
            content={(props) => (
              <SparkTooltip
                {...props}
                metricLabel={metricLabel}
                formatValue={formatValue}
              />
            )}
          />
          {hasComparison && (
            <Line
              type="monotone"
              dataKey="comparison"
              stroke="var(--text-3)"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
          <Area
            type="monotone"
            dataKey="current"
            stroke="var(--accent)"
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
            activeDot={{
              r: 3,
              stroke: "var(--accent)",
              strokeWidth: 2,
              fill: "var(--surface)",
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================
// HeroTile — the big Revenue card (col-span-6 lg)
// ============================================================

interface HeroTileProps {
  label: string;
  value: string;
  pct: number | null;
  sub?: string;
  rows: ChartRow[];
  formatValue: (n: number) => string;
}

function HeroTile({ label, value, pct, sub, rows, formatValue }: HeroTileProps) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5 md:p-6 flex flex-col h-full min-h-[180px]">
      <div className="text-[13px] font-semibold text-text-2 mb-2">{label}</div>
      <div className="text-[32px] md:text-[36px] font-bold tracking-tight text-text leading-none tabular-nums">
        {value}
      </div>
      <Delta pct={pct} className="mt-2" />
      {sub && (
        <div className="text-[12px] text-text-3 mt-1.5 truncate">{sub}</div>
      )}
      <div className="flex-1 min-h-[60px] -mx-2 mt-4">
        <MiniSpark
          rows={rows}
          metricLabel={label}
          formatValue={formatValue}
          height={70}
        />
      </div>
    </div>
  );
}

// ============================================================
// SubTile — Orders / Среден чек (col-span-3 lg)
// ============================================================

interface SubTileProps {
  label: string;
  value: string;
  pct: number | null;
  rows: ChartRow[];
  formatValue: (n: number) => string;
}

function SubTile({ label, value, pct, rows, formatValue }: SubTileProps) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-4 md:p-5 flex flex-col h-full min-h-[180px]">
      <div className="text-[12px] font-semibold text-text-2 mb-1.5">{label}</div>
      <div className="text-[24px] md:text-[28px] font-bold tracking-tight text-text leading-none tabular-nums">
        {value}
      </div>
      <Delta pct={pct} className="mt-1.5" />
      <div className="flex-1 min-h-[36px] -mx-2 mt-3">
        <MiniSpark
          rows={rows}
          metricLabel={label}
          formatValue={formatValue}
          height={48}
        />
      </div>
    </div>
  );
}

// ============================================================
// Skeleton — matches the live layout so the page doesn't reflow on load
// ============================================================

function HeroStripSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-12 gap-3 md:gap-4 mb-4 md:mb-6">
      <div className="col-span-2 lg:col-span-6 bg-surface rounded-xl shadow-sm p-5 md:p-6 min-h-[180px]">
        <Skeleton className="h-3 w-16 mb-3" />
        <Skeleton className="h-9 w-44 mb-3" />
        <Skeleton className="h-3 w-24 mb-4" />
        <Skeleton className="h-[70px] w-full" />
      </div>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="col-span-1 lg:col-span-3 bg-surface rounded-xl shadow-sm p-4 md:p-5 min-h-[180px]"
        >
          <Skeleton className="h-3 w-14 mb-2" />
          <Skeleton className="h-7 w-24 mb-2" />
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-[40px] w-full" />
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Main export
// ============================================================

export function SalesHeroStrip() {
  const { queryString, compFrom, compTo } = useDateRange();
  const { storeParam } = useStoreSelection();

  const { data: kpis, isLoading: kpisLoading, error: kpisError } = useSWR<KpisResponse>(
    `/api/sales/kpis?${queryString}&${storeParam}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  const { data: trend, isLoading: trendLoading } = useSWR<TrendResponse>(
    `/api/sales/trend?${queryString}&${storeParam}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  // Same SWR key as SalesTrend — cache shared, no extra network call.
  const compQs = `preset=custom&from=${compFrom}&to=${compTo}`;
  const { data: comp } = useSWR<TrendResponse>(
    compFrom && compTo
      ? `/api/sales/trend?${compQs}&${storeParam}`
      : null,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  // Build per-tile ChartRow arrays. For AOV we synthesise the per-day
  // value as revenue/orders (with a zero-guard for empty days).
  const tileRows = useMemo(() => {
    const cur = trend?.series ?? [];
    const prev = comp?.series ?? [];
    const aovOf = (d: { revenue: number; orders: number } | undefined) => {
      if (!d || d.orders <= 0) return null;
      return d.revenue / d.orders;
    };
    return {
      revenue: cur.map<ChartRow>((d, i) => ({
        date: d.date,
        current: d.revenue,
        comparison: prev[i] ? prev[i].revenue : null,
        compDate: prev[i]?.date ?? null,
      })),
      orders: cur.map<ChartRow>((d, i) => ({
        date: d.date,
        current: d.orders,
        comparison: prev[i] ? prev[i].orders : null,
        compDate: prev[i]?.date ?? null,
      })),
      aov: cur.map<ChartRow>((d, i) => ({
        date: d.date,
        current: aovOf(d) ?? 0,
        comparison: aovOf(prev[i]),
        compDate: prev[i]?.date ?? null,
      })),
    };
  }, [trend?.series, comp?.series]);

  // Peak day — first row with the highest revenue. Skip when all zero
  // (empty store / pre-launch) so we don't surface a meaningless "0 EUR".
  const peakDay = useMemo(() => {
    const series = trend?.series ?? [];
    if (series.length === 0) return null;
    let best = series[0];
    for (const d of series) {
      if (d.revenue > best.revenue) best = d;
    }
    return best.revenue > 0 ? best : null;
  }, [trend?.series]);

  if (kpisLoading || trendLoading || !kpis) return <HeroStripSkeleton />;

  if (kpisError || kpis.error) {
    return (
      <div className="bg-surface rounded-xl shadow-sm p-5 mb-6 text-center">
        <p className="text-[13px] text-text-2">Грешка при зареждане на продажби</p>
      </div>
    );
  }

  const peakSub = peakDay
    ? `Най-силен ден: ${formatBgDate(peakDay.date)} • ${fmtEur(peakDay.revenue)}`
    : undefined;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-12 gap-3 md:gap-4 mb-4 md:mb-6">
      <div className="col-span-2 lg:col-span-6">
        <HeroTile
          label="Приходи"
          value={fmtEur(kpis.revenue.value, 0)}
          pct={kpis.revenue.change}
          sub={peakSub}
          rows={tileRows.revenue}
          formatValue={fmtEurFull}
        />
      </div>
      <div className="col-span-1 lg:col-span-3">
        <SubTile
          label="Поръчки"
          value={fmtInt(kpis.orders.value)}
          pct={kpis.orders.change}
          rows={tileRows.orders}
          formatValue={fmtInt}
        />
      </div>
      <div className="col-span-1 lg:col-span-3">
        <SubTile
          label="Среден чек"
          value={fmtEur(kpis.aov.value, 2)}
          pct={kpis.aov.change}
          rows={tileRows.aov}
          formatValue={fmtEurFull}
        />
      </div>
    </div>
  );
}
