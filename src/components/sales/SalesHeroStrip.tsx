"use client";

import useSWR from "swr";
import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
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
//   - mini area sparkline of the period's daily values
//
// The Revenue tile additionally surfaces "Най-силен ден" — instantly tells
// the operator what the peak was without making them hover the chart.
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

function fmtEur(n: number, dp = 0): string {
  return `${n.toLocaleString("bg-BG", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG");
}

// ============================================================
// MiniSpark — inline area chart for a KPI tile.
//
// Pure shape — no axes, no grid, no tooltip. The accompanying delta tells
// you "up vs prev"; the spark tells you "is this period smooth or spiky".
// Two complementary signals, neither replaceable by the other.
// ============================================================

function MiniSpark({ data, height = 40 }: { data: number[]; height?: number }) {
  // Need at least 2 points to draw a line.
  if (data.length < 2) return null;
  const rows = data.map((v, i) => ({ v, i }));
  // Recharts needs a unique gradient id per render to avoid SSR/HMR mix-ups
  // where two charts share the same defs node — pin to height as a coarse
  // proxy for tile-tier (40 = sub, 70 = hero).
  const gradId = `salesHeroSpark${height}`;
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke="var(--accent)"
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
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
  spark: number[];
}

function HeroTile({ label, value, pct, sub, spark }: HeroTileProps) {
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
        <MiniSpark data={spark} height={70} />
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
  spark: number[];
}

function SubTile({ label, value, pct, spark }: SubTileProps) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-4 md:p-5 flex flex-col h-full min-h-[180px]">
      <div className="text-[12px] font-semibold text-text-2 mb-1.5">{label}</div>
      <div className="text-[24px] md:text-[28px] font-bold tracking-tight text-text leading-none tabular-nums">
        {value}
      </div>
      <Delta pct={pct} className="mt-1.5" />
      <div className="flex-1 min-h-[36px] -mx-2 mt-3">
        <MiniSpark data={spark} height={48} />
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
  const { queryString } = useDateRange();
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

  // Derive sparkline arrays from the daily trend series.
  // AOV per day = revenue/orders (safe for zero-order days).
  const sparks = useMemo(() => {
    const series = trend?.series ?? [];
    return {
      revenue: series.map((d) => d.revenue),
      orders: series.map((d) => d.orders),
      aov: series.map((d) => (d.orders > 0 ? d.revenue / d.orders : 0)),
    };
  }, [trend?.series]);

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
          spark={sparks.revenue}
        />
      </div>
      <div className="col-span-1 lg:col-span-3">
        <SubTile
          label="Поръчки"
          value={fmtInt(kpis.orders.value)}
          pct={kpis.orders.change}
          spark={sparks.orders}
        />
      </div>
      <div className="col-span-1 lg:col-span-3">
        <SubTile
          label="Среден чек"
          value={fmtEur(kpis.aov.value, 2)}
          pct={kpis.aov.change}
          spark={sparks.aov}
        />
      </div>
    </div>
  );
}
