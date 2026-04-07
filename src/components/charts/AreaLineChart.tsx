"use client";

import { ReactNode } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { ChartContainer, useChartColors } from "./ChartContainer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface AreaLineChartProps {
  data: AnyRecord[];
  xKey: string;
  yKey: string;
  yKey2?: string;
  title?: string;
  action?: ReactNode;
  height?: number;
  loading?: boolean;
  color?: string;
  color2?: string;
  formatValue?: (v: number) => string;
  formatX?: (v: string) => string;
  className?: string;
}

export function AreaLineChart({
  data,
  xKey,
  yKey,
  yKey2,
  title,
  action,
  height = 240,
  loading,
  color,
  color2,
  formatValue = (v) => v.toLocaleString("bg-BG"),
  formatX,
  className,
}: AreaLineChartProps) {
  const c = useChartColors();
  const fill = color || c.accent;
  const fill2 = color2 || c.blue;

  return (
    <ChartContainer
      title={title}
      action={action}
      height={height}
      loading={loading}
      empty={!data.length}
      className={className}
    >
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id={`grad-${yKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity={0.2} />
            <stop offset="100%" stopColor={fill} stopOpacity={0} />
          </linearGradient>
          {yKey2 && (
            <linearGradient id={`grad-${yKey2}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fill2} stopOpacity={0.2} />
              <stop offset="100%" stopColor={fill2} stopOpacity={0} />
            </linearGradient>
          )}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: c.text3 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatX}
        />
        <YAxis
          tick={{ fontSize: 11, fill: c.text3 }}
          tickLine={false}
          axisLine={false}
          width={50}
          tickFormatter={(v) => {
            const num = Number(v);
            if (num >= 1000) return `${(num / 1000).toFixed(0)}k`;
            return formatValue(num);
          }}
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
          labelFormatter={formatX ? (label) => formatX(String(label)) : undefined}
        />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={fill}
          strokeWidth={2}
          fill={`url(#grad-${yKey})`}
          dot={false}
          activeDot={{ r: 4, stroke: fill, strokeWidth: 2, fill: "var(--surface)" }}
        />
        {yKey2 && (
          <Area
            type="monotone"
            dataKey={yKey2}
            stroke={fill2}
            strokeWidth={2}
            fill={`url(#grad-${yKey2})`}
            dot={false}
            activeDot={{ r: 4, stroke: fill2, strokeWidth: 2, fill: "var(--surface)" }}
          />
        )}
      </AreaChart>
    </ChartContainer>
  );
}
