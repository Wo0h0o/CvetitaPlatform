"use client";

import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useChartColors } from "./ChartContainer";

interface SparkLineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}

export function SparkLine({
  data,
  color,
  width = 80,
  height = 24,
  className = "",
}: SparkLineProps) {
  const c = useChartColors();
  const fill = color || c.accent;

  if (!data.length) return null;

  const points = data.map((v, i) => ({ v, i }));

  return (
    <div className={`inline-block ${className}`} style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={fill}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
