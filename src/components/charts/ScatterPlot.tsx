"use client";

import { ReactNode } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ZAxis, Cell,
} from "recharts";
import { ChartContainer, useChartColors } from "./ChartContainer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface ScatterPlotProps {
  data: AnyRecord[];
  xKey: string;
  yKey: string;
  zKey?: string;
  title?: string;
  action?: ReactNode;
  height?: number;
  loading?: boolean;
  xLabel?: string;
  yLabel?: string;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  getColor?: (item: AnyRecord) => string;
  className?: string;
}

export function ScatterPlot({
  data,
  xKey,
  yKey,
  zKey,
  title,
  action,
  height = 280,
  loading,
  xLabel,
  yLabel,
  formatX = (v) => v.toLocaleString("bg-BG"),
  formatY = (v) => v.toLocaleString("bg-BG"),
  getColor,
  className,
}: ScatterPlotProps) {
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
      <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: -4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
        <XAxis
          type="number"
          dataKey={xKey}
          name={xLabel || xKey}
          tick={{ fontSize: 11, fill: c.text3 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatX(Number(v))}
        />
        <YAxis
          type="number"
          dataKey={yKey}
          name={yLabel || yKey}
          tick={{ fontSize: 11, fill: c.text3 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatY(Number(v))}
        />
        {zKey && <ZAxis type="number" dataKey={zKey} range={[40, 400]} />}
        <Tooltip
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
            boxShadow: "var(--shadow-md)",
          }}
        />
        <Scatter data={data} fill={c.accent}>
          {getColor && data.map((item, i) => (
            <Cell key={i} fill={getColor(item)} />
          ))}
        </Scatter>
      </ScatterChart>
    </ChartContainer>
  );
}
