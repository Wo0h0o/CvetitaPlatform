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
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
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
        tick={{ fontSize: 10, fill: c.text2 }}
        tickLine={false}
        axisLine={false}
        width={120}
      />
      <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatValue(Number(value)), ""]} />
      <Bar dataKey={yKey} radius={[0, 4, 4, 0]} maxBarSize={24}>
        {data.map((_, i) => (
          <Cell key={i} fill={colors ? colors[i % colors.length] : fill} />
        ))}
      </Bar>
    </BarChart>
  ) : (
    <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
      <XAxis
        dataKey={xKey}
        tick={{ fontSize: 10, fill: c.text3 }}
        tickLine={false}
        axisLine={false}
        interval={0}
        angle={data.length > 6 ? -30 : 0}
        textAnchor={data.length > 6 ? "end" : "middle"}
        height={data.length > 6 ? 50 : 30}
      />
      <YAxis
        tick={{ fontSize: 11, fill: c.text3 }}
        tickLine={false}
        axisLine={false}
        width={45}
        tickFormatter={(v) => {
          const num = Number(v);
          if (num >= 1000) return `${(num / 1000).toFixed(0)}k`;
          return String(num);
        }}
      />
      <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatValue(Number(value)), ""]} />
      <Bar dataKey={yKey} radius={[4, 4, 0, 0]} maxBarSize={40}>
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
