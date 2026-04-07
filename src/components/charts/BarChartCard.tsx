"use client";

import { ReactNode } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { ChartContainer, useChartColors } from "./ChartContainer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface BarChartCardProps {
  data: AnyRecord[];
  xKey: string;
  yKey: string;
  title?: string;
  action?: ReactNode;
  height?: number;
  loading?: boolean;
  color?: string;
  colors?: string[];
  horizontal?: boolean;
  formatValue?: (v: number) => string;
  className?: string;
}

export function BarChartCard({
  data,
  xKey,
  yKey,
  title,
  action,
  height = 240,
  loading,
  color,
  colors,
  horizontal = false,
  formatValue = (v) => v.toLocaleString("bg-BG"),
  className,
}: BarChartCardProps) {
  const c = useChartColors();
  const fill = color || c.accent;

  const tooltipStyle = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    boxShadow: "var(--shadow-md)",
  };

  const chart = horizontal ? (
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={c.grid} horizontal={false} />
      <XAxis
        type="number"
        tick={{ fontSize: 11, fill: c.text3 }}
        tickLine={false}
        axisLine={false}
        tickFormatter={(v) => formatValue(Number(v))}
      />
      <YAxis
        type="category"
        dataKey={xKey}
        tick={{ fontSize: 11, fill: c.text2 }}
        tickLine={false}
        axisLine={false}
        width={100}
      />
      <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatValue(Number(value)), ""]} />
      <Bar dataKey={yKey} radius={[0, 4, 4, 0]} maxBarSize={24}>
        {data.map((_, i) => (
          <Cell key={i} fill={colors ? colors[i % colors.length] : fill} />
        ))}
      </Bar>
    </BarChart>
  ) : (
    <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
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
      <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatValue(Number(value)), ""]} />
      <Bar dataKey={yKey} radius={[4, 4, 0, 0]} maxBarSize={32}>
        {data.map((_, i) => (
          <Cell key={i} fill={colors ? colors[i % colors.length] : fill} />
        ))}
      </Bar>
    </BarChart>
  );

  return (
    <ChartContainer
      title={title}
      action={action}
      height={height}
      loading={loading}
      empty={!data.length}
      className={className}
    >
      {chart}
    </ChartContainer>
  );
}
