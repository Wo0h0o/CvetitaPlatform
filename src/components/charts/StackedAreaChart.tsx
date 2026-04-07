"use client";

import { ReactNode } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { ChartContainer, useChartColors } from "./ChartContainer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface Series {
  key: string;
  label: string;
  color?: string;
}

interface StackedAreaChartProps {
  data: AnyRecord[];
  xKey: string;
  series: Series[];
  title?: string;
  action?: ReactNode;
  height?: number;
  loading?: boolean;
  formatValue?: (v: number) => string;
  className?: string;
}

const PALETTE = ["#22c55e", "#007aff", "#ff9500", "#8b5cf6", "#ff3b30", "#06b6d4"];

export function StackedAreaChart({
  data,
  xKey,
  series,
  title,
  action,
  height = 280,
  loading,
  formatValue = (v) => v.toLocaleString("bg-BG"),
  className,
}: StackedAreaChartProps) {
  const c = useChartColors();

  return (
    <ChartContainer
      title={title}
      action={action}
      height={height}
      loading={loading}
      empty={!data.length}
      className={className}
    >
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
        <defs>
          {series.map((s, i) => {
            const color = s.color || PALETTE[i % PALETTE.length];
            return (
              <linearGradient key={s.key} id={`stack-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: c.text3 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: c.text3 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatValue(Number(v))}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
            boxShadow: "var(--shadow-md)",
          }}
          formatter={(value) => [formatValue(Number(value)), ""]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        />
        {series.map((s, i) => {
          const color = s.color || PALETTE[i % PALETTE.length];
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stackId="1"
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#stack-${s.key})`}
            />
          );
        })}
      </AreaChart>
    </ChartContainer>
  );
}
