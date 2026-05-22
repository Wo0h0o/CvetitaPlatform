"use client";

import { useState } from "react";
import {
  ComposedChart, BarChart, LineChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
import { ChartContainer, useChartColors } from "@/components/charts/ChartContainer";
import { GlassTooltip, buildRechartsTooltip } from "@/components/charts/GlassTooltip";
import { useChartScrubber } from "@/components/charts/useChartScrubber";
import { MobileScrubber, MobileScrubberRow } from "@/components/charts/MobileScrubber";
import { useAnalyticsSWR } from "@/hooks/useAnalyticsSWR";

interface TrendPoint {
  date: string;
  spend: number;
  roas: number;
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("bg-BG", { day: "numeric", month: "short" });
}
function fmtEur(n: number): string {
  return n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// One build function, two consumers (§11): the Recharts hover tooltip on
// desktop, and the mobile scrubber popup. Identical glass vocabulary.
function buildTrendPopup(row: TrendPoint) {
  return {
    header: fmtDate(row.date),
    rows: [
      { label: "Разход", value: `€${fmtEur(row.spend)}` },
      { label: "ROAS", value: `${row.roas.toFixed(2)}x` },
    ],
  };
}
const tooltipContent = buildRechartsTooltip<TrendPoint>(buildTrendPopup);

/**
 * Spend × ROAS daily trend. Spend is a per-day count → bars; ROAS is a
 * ratio → line; mechanically linked → combo on a shared axis (§9.4).
 * Mobile collapses to a one-metric tab toggle (§9.6); inspection is
 * driven by the scrubber + chart-touch (§13) since Recharts' own touch
 * tooltip is CSS-muted at ≤767px.
 */
export function SpendRoasTrend({ market, preset }: { market: string; preset: string }) {
  const c = useChartColors();
  const [tab, setTab] = useState<"spend" | "roas">("spend");

  const { data, error, isLoading, mutate } = useAnalyticsSWR<{ trend: TrendPoint[] }>(
    `/api/dashboard/ads/trend?market=${market}&preset=${preset}`
  );

  const trend = data?.trend ?? [];
  const empty = !isLoading && !error && trend.length === 0;
  const axisTick = { fontSize: 11, fill: c.text3 };

  const { activeIdx, setActiveIdx, wrapperRef, pointerHandlers } = useChartScrubber({
    count: trend.length,
  });
  const activeRow = activeIdx !== null ? trend[activeIdx] ?? null : null;

  const toggle = (
    <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
      {(["spend", "roas"] as const).map((k) => (
        <button
          key={k}
          onClick={() => setTab(k)}
          className={`min-h-[44px] px-3 inline-flex items-center rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
            tab === k ? "bg-surface text-text shadow-sm" : "text-text-2"
          }`}
        >
          {k === "spend" ? "Разход" : "ROAS"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="mb-6">
      {/* Desktop — full combo, native hover tooltip */}
      <div className="hidden md:block">
        <ChartContainer
          title="Разход × ROAS"
          height={260}
          loading={isLoading}
          error={error}
          onRetry={() => mutate()}
          empty={empty}
        >
          <ComposedChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis yAxisId="spend" tick={axisTick} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `€${v}`} />
            <YAxis yAxisId="roas" orientation="right" tick={axisTick} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}x`} />
            <Tooltip content={tooltipContent} cursor={{ fill: c.surface2 }} />
            <Bar yAxisId="spend" dataKey="spend" fill={c.text3} radius={[3, 3, 0, 0]} maxBarSize={32} />
            <Line yAxisId="roas" type="monotone" dataKey="roas" stroke={c.accent} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ChartContainer>
      </div>

      {/* Mobile — one metric, scrubber-driven inspection (§13) */}
      <div className="md:hidden">
        <Card>
          <CardHeader action={toggle}>Разход × ROAS</CardHeader>
          <CardBody>
            {isLoading ? (
              <Skeleton className="w-full h-[220px]" />
            ) : error ? (
              <ErrorState error={error} onRetry={() => mutate()} compact />
            ) : empty ? (
              <div className="flex items-center justify-center h-[220px] text-[13px] text-text-2">
                Няма данни
              </div>
            ) : (
              <>
                <div ref={wrapperRef} {...pointerHandlers} className="h-[220px] touch-pan-y">
                  <ResponsiveContainer width="100%" height="100%">
                    {tab === "spend" ? (
                      <BarChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                        <YAxis tick={axisTick} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `€${v}`} />
                        {activeRow && <ReferenceLine x={activeRow.date} stroke={c.text3} strokeDasharray="3 3" />}
                        <Bar dataKey="spend" fill={c.text3} radius={[3, 3, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    ) : (
                      <LineChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                        <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}x`} />
                        {activeRow && <ReferenceLine x={activeRow.date} stroke={c.text3} strokeDasharray="3 3" />}
                        <Line type="monotone" dataKey="roas" stroke={c.accent} strokeWidth={2} dot={false} />
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
                <MobileScrubberRow
                  visible={activeRow !== null}
                  popup={activeRow ? <GlassTooltip {...buildTrendPopup(activeRow)} /> : null}
                >
                  <MobileScrubber count={trend.length} value={activeIdx} onChange={setActiveIdx} />
                </MobileScrubberRow>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
