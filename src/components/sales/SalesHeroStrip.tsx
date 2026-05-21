"use client";

import useSWR from "swr";
import { useId, useMemo } from "react";
import {
  Area,
  Bar,
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
  // `current` is nullable for state-change metrics (AOV) on empty days —
  // forcing a 0 floor would draw a misleading dip when really there were
  // simply no orders that day to compute an average from.
  current: number | null;
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

// Hourly mode header — ISO timestamps from the trend API look like
// "2026-05-21T14:00:00" (no timezone suffix). Slice the HH:MM rather
// than parsing via Date(), which would shift to the browser local tz.
function formatHourHeader(iso: string): string {
  return `${iso.slice(11, 16)} ч.`;
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
  hourly?: boolean;
}

function SparkTooltip({
  active,
  payload,
  metricLabel,
  formatValue,
  hourly,
}: SparkTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const cur = row.current;
  const cmp = row.comparison;

  let delta: { text: string; tone: "good" | "bad" | "flat" } | null = null;
  if (cur !== null && cmp !== null && cmp > 0) {
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
        {hourly ? formatHourHeader(row.date) : formatBucketHeader(row.date)}
      </div>
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        <span className="text-text-3">{metricLabel}</span>
        <span className="text-text font-semibold tabular-nums text-right">
          {cur === null ? "—" : formatValue(cur)}
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
// Chart type is chosen per metric per analytics-design-contract §9:
//   * "area"  → smooth area (continuous flow: revenue, GMV, sessions)
//   * "bars"  → vertical bars (discrete counts: orders, signups). Smooth
//                line for counts is §9.5 anti-pattern — interpolation
//                says "47.3 orders between Mon and Tue", which is false.
//   * "step"  → stepAfter line (state-change metrics: AOV, MRR, price).
//                Between events the value holds, it doesn't "flow".
//
// All three modes draw the same dashed grey comparison line on top (when
// prior-period data exists) and share the glass SparkTooltip so the
// tile-to-tile language stays consistent — only the chart shape changes.
// ============================================================

type SparkKind = "area" | "bars" | "step";

interface MiniSparkProps {
  rows: ChartRow[];
  metricLabel: string;
  formatValue: (n: number) => string;
  height?: number;
  kind?: SparkKind;
  hourly?: boolean;
}

function MiniSpark({
  rows,
  metricLabel,
  formatValue,
  height = 40,
  kind = "area",
  hourly,
}: MiniSparkProps) {
  // useId — Recharts <defs> live in a global SVG scope inside the page;
  // two charts with the same gradient id visually clash. The earlier
  // `${height}` heuristic only held until two tiles shared a height.
  const reactId = useId();
  const gradId = `salesHeroSpark-${reactId.replace(/:/g, "")}`;

  const hasComparison = rows.some((r) => r.comparison !== null);
  // Bars require ≥1 row; the smooth/step paths still need ≥2 to draw a
  // segment. Single-point fallback is uncommon (date pickers always
  // produce ≥2 daily buckets on multi-day presets), but it costs nothing
  // to guard.
  if (rows.length < (kind === "bars" ? 1 : 2)) return null;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          {kind === "area" && (
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
          )}
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
            cursor={
              kind === "bars"
                ? { fill: "var(--surface-2)", opacity: 0.6 }
                : {
                    stroke: "var(--text-3)",
                    strokeWidth: 1,
                    strokeDasharray: "2 2",
                  }
            }
            content={(props) => (
              <SparkTooltip
                {...props}
                metricLabel={metricLabel}
                formatValue={formatValue}
                hourly={hourly}
              />
            )}
          />
          {hasComparison && (
            <Line
              type={kind === "step" ? "stepAfter" : "monotone"}
              dataKey="comparison"
              stroke="var(--text-3)"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
          {kind === "area" && (
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
          )}
          {kind === "bars" && (
            <Bar
              dataKey="current"
              fill="var(--accent)"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
              maxBarSize={14}
            />
          )}
          {kind === "step" && (
            <Line
              type="stepAfter"
              dataKey="current"
              stroke="var(--accent)"
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
              activeDot={{
                r: 3,
                stroke: "var(--accent)",
                strokeWidth: 2,
                fill: "var(--surface)",
              }}
            />
          )}
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
  kind?: SparkKind;
  hourly?: boolean;
}

function HeroTile({
  label,
  value,
  pct,
  sub,
  rows,
  formatValue,
  kind = "area",
  hourly,
}: HeroTileProps) {
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
          kind={kind}
          hourly={hourly}
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
  kind?: SparkKind;
  hourly?: boolean;
}

function SubTile({
  label,
  value,
  pct,
  rows,
  formatValue,
  kind = "area",
  hourly,
}: SubTileProps) {
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
          kind={kind}
          hourly={hourly}
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
  const { queryString, compFrom, compTo, from, to } = useDateRange();
  const { storeParam } = useStoreSelection();

  // Single-day windows (Днес / Вчера / custom from===to) collapse the
  // daily trend to one data point, which leaves the sparklines empty —
  // area has no segment, the step has no chord, even the bars render
  // as one isolated stub mid-axis. Switch to hourly granularity in
  // that case, exactly like SalesTrend does. SWR keys match the
  // SalesTrend / SalesRhythmPanel keys so we don't pay for a second
  // fetch on the same page.
  const hourly = from === to;
  const granularitySuffix = hourly ? "&granularity=hour" : "";

  const { data: kpis, isLoading: kpisLoading, error: kpisError } = useSWR<KpisResponse>(
    `/api/sales/kpis?${queryString}&${storeParam}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  const { data: trend, isLoading: trendLoading } = useSWR<TrendResponse>(
    `/api/sales/trend?${queryString}&${storeParam}${granularitySuffix}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  // Same SWR key as SalesTrend — cache shared, no extra network call.
  const compQs = `preset=custom&from=${compFrom}&to=${compTo}${granularitySuffix}`;
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
        // null on empty days — a stepped line for a state-change metric
        // should bridge gaps via connectNulls, not pretend AOV was zero.
        current: aovOf(d),
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

  // Headline callout under the Revenue tile. In hourly mode we use the
  // peak HOUR — "Най-силен ден" on a single-day window would self-refer
  // (the day is the day) and read as filler. In multi-day mode we keep
  // the original peak-day label.
  const peakSub = peakDay
    ? hourly
      ? `Пик час: ${formatHourHeader(peakDay.date)} • ${fmtEur(peakDay.revenue)}`
      : `Най-силен ден: ${formatBgDate(peakDay.date)} • ${fmtEur(peakDay.revenue)}`
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
          // Continuous flow — revenue can land at any value, smooth area
          // is the honest reading.
          kind="area"
          hourly={hourly}
        />
      </div>
      <div className="col-span-1 lg:col-span-3">
        <SubTile
          label="Поръчки"
          value={fmtInt(kpis.orders.value)}
          pct={kpis.orders.change}
          rows={tileRows.orders}
          formatValue={fmtInt}
          // Discrete events — bars per day. Smooth line would imply
          // fractional orders interpolated between buckets (§9.5).
          kind="bars"
          hourly={hourly}
        />
      </div>
      <div className="col-span-1 lg:col-span-3">
        <SubTile
          label="Среден чек"
          value={fmtEur(kpis.aov.value, 2)}
          pct={kpis.aov.change}
          rows={tileRows.aov}
          formatValue={fmtEurFull}
          // State-change metric — AOV holds at the prior value until the
          // next order changes it. Stepped line is the honest reading
          // (§9.3); smooth area would imply continuous drift.
          kind="step"
          hourly={hourly}
        />
      </div>
    </div>
  );
}
