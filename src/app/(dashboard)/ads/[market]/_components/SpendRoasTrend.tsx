"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  ComposedChart, BarChart, LineChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { ChartContainer, useChartColors } from "@/components/charts/ChartContainer";
import { buildRechartsTooltip } from "@/components/charts/GlassTooltip";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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

// Single tooltip vocabulary (§11) — both desktop combo and mobile single-metric
// charts render the same GlassTooltip with both numbers.
const tooltipContent = buildRechartsTooltip<TrendPoint>((row) => ({
  header: fmtDate(row.date),
  rows: [
    { label: "Разход", value: `€${fmtEur(row.spend)}` },
    { label: "ROAS", value: `${row.roas.toFixed(2)}x` },
  ],
}));

/**
 * Spend × ROAS daily trend. Spend is a per-day count → bars; ROAS is a
 * ratio → line; the two are mechanically linked → combo on a shared axis
 * (design contract §9.4). On mobile the combo collapses to a one-metric
 * tab toggle (§9.6) rather than cramming dual axes onto 375px.
 */
export function SpendRoasTrend({ market, preset }: { market: string; preset: string }) {
  const c = useChartColors();
  const [tab, setTab] = useState<"spend" | "roas">("spend");

  const { data, isLoading } = useSWR<{ trend: TrendPoint[]; error?: string }>(
    `/api/dashboard/ads/trend?market=${market}&preset=${preset}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const trend = data?.trend ?? [];
  const empty = !isLoading && trend.length === 0;

  const axisTick = { fontSize: 11, fill: c.text3 };

  return (
    <div className="mb-6">
      {/* Desktop — full combo */}
      <div className="hidden md:block">
        <ChartContainer title="Разход × ROAS" height={260} loading={isLoading} empty={empty}>
          <ComposedChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date" tickFormatter={fmtDate} tick={axisTick}
              axisLine={false} tickLine={false} minTickGap={24}
            />
            <YAxis
              yAxisId="spend" tick={axisTick} axisLine={false} tickLine={false}
              width={52} tickFormatter={(v) => `€${v}`}
            />
            <YAxis
              yAxisId="roas" orientation="right" tick={axisTick}
              axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}x`}
            />
            <Tooltip content={tooltipContent} cursor={{ fill: c.surface2 }} />
            <Bar yAxisId="spend" dataKey="spend" fill={c.text3} radius={[3, 3, 0, 0]} maxBarSize={32} />
            <Line yAxisId="roas" type="monotone" dataKey="roas" stroke={c.accent} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ChartContainer>
      </div>

      {/* Mobile — one metric at a time */}
      <div className="md:hidden">
        <ChartContainer
          title="Разход × ROAS"
          height={220}
          loading={isLoading}
          empty={empty}
          action={
            <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
              {(["spend", "roas"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    tab === k ? "bg-surface text-text shadow-sm" : "text-text-2"
                  }`}
                >
                  {k === "spend" ? "Разход" : "ROAS"}
                </button>
              ))}
            </div>
          }
        >
          {tab === "spend" ? (
            <BarChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `€${v}`} />
              <Tooltip content={tooltipContent} cursor={{ fill: c.surface2 }} />
              <Bar dataKey="spend" fill={c.text3} radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          ) : (
            <LineChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}x`} />
              <Tooltip content={tooltipContent} cursor={{ fill: c.surface2 }} />
              <Line type="monotone" dataKey="roas" stroke={c.accent} strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ChartContainer>
      </div>
    </div>
  );
}
