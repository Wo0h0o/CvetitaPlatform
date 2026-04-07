"use client";

import { ReactNode } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
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
  height = 260,
  loading,
  colors = DEFAULT_PALETTE,
  formatValue = (v) => v.toLocaleString("bg-BG"),
  className,
}: DonutChartProps) {
  const chartData = data.map((d) => ({
    name: String(d[nameKey]),
    value: Number(d[valueKey]),
  }));

  const total = chartData.reduce((s, d) => s + d.value, 0) || 1;

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
          cy="45%"
          innerRadius="50%"
          outerRadius="75%"
          paddingAngle={2}
          dataKey="value"
          nameKey="name"
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
          formatter={(value) => {
            const num = Number(value);
            const pct = ((num / total) * 100).toFixed(0);
            return [`${formatValue(num)} (${pct}%)`, ""];
          }}
        />
        <Legend
          layout="horizontal"
          verticalAlign="bottom"
          align="center"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          formatter={(value: string) => {
            const item = chartData.find((d) => d.name === value);
            const pct = item ? ((item.value / total) * 100).toFixed(0) : "0";
            return `${value} ${pct}%`;
          }}
        />
      </PieChart>
    </ChartContainer>
  );
}
