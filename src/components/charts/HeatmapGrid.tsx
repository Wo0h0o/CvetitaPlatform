"use client";

import { ReactNode } from "react";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";

interface HeatmapGridProps {
  rows: {
    label: string;
    cells: { value: number; label?: string }[];
  }[];
  columnLabels: string[];
  title?: string;
  action?: ReactNode;
  loading?: boolean;
  minColor?: string;
  maxColor?: string;
  formatCell?: (value: number) => string;
  className?: string;
}

function getHeatColor(value: number, min: number, max: number): string {
  if (max === min) return "var(--surface-2)";
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Accent green with varying opacity
  const alpha = 0.1 + ratio * 0.6;
  return `rgba(34, 197, 94, ${alpha})`;
}

export function HeatmapGrid({
  rows,
  columnLabels,
  title,
  action,
  loading,
  formatCell = (v) => `${v.toFixed(0)}%`,
  className = "",
}: HeatmapGridProps) {
  if (loading) {
    return (
      <Card className={className}>
        {title && <CardHeader action={action}>{title}</CardHeader>}
        <CardBody><Skeleton className="h-48 w-full" /></CardBody>
      </Card>
    );
  }

  if (!rows.length) {
    return (
      <Card className={className}>
        {title && <CardHeader action={action}>{title}</CardHeader>}
        <CardBody>
          <div className="text-center py-8 text-text-2 text-[13px]">Няма данни</div>
        </CardBody>
      </Card>
    );
  }

  // Find global min/max for color scaling
  const allValues = rows.flatMap((r) => r.cells.map((c) => c.value));
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);

  return (
    <Card className={className}>
      {title && <CardHeader action={action}>{title}</CardHeader>}
      <CardBody className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr>
              <th className="text-left text-[11px] font-semibold text-text-2 pb-2 pr-3 sticky left-0 bg-surface z-10">
                Кохорта
              </th>
              {columnLabels.map((label) => (
                <th key={label} className="text-center text-[11px] font-medium text-text-3 pb-2 px-1">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="text-[12px] font-medium text-text-2 py-1 pr-3 sticky left-0 bg-surface z-10 whitespace-nowrap">
                  {row.label}
                </td>
                {row.cells.map((cell, i) => (
                  <td key={i} className="px-1 py-1 text-center">
                    <div
                      className="rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors"
                      style={{
                        backgroundColor: cell.value > 0 ? getHeatColor(cell.value, min, max) : "var(--surface-2)",
                        color: cell.value > 0 ? "var(--text)" : "var(--text-3)",
                      }}
                    >
                      {cell.value > 0 ? (cell.label || formatCell(cell.value)) : "—"}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
