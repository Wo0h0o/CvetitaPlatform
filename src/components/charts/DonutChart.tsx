"use client";

import { ReactNode } from "react";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { ChartContainer } from "./ChartContainer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface DonutChartProps {
  data: AnyRecord[];
  nameKey: string;
  valueKey: string;
  title?: string;
  action?: ReactNode;
  height?: number;
  loading?: boolean;
  colors?: string[];
  formatValue?: (v: number) => string;
  className?: string;
}

const DEFAULT_PALETTE = [
  "#22c55e", "#007aff", "#ff9500", "#8b5cf6", "#ff3b30", "#06b6d4",
];

export function DonutChart({
  data,
  nameKey,
  valueKey,
  title,
  action,
  height = 240,
  loading,
  colors = DEFAULT_PALETTE,
  formatValue = (v) => v.toLocaleString("bg-BG"),
  className,
}: DonutChartProps) {
  const chartData = data.map((d) => ({
    name: String(d[nameKey]),
    value: Number(d[valueKey]),
  }));

  return (
    <ChartContainer
      title={title}
      action={action}
      height={height}
      loading={loading}
      empty={!data.length}
      className={className}
    >
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
          dataKey="value"
          nameKey="name"
          label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} stroke="none" />
          ))}
        </Pie>
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
      </PieChart>
    </ChartContainer>
  );
}
