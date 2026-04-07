"use client";

import { useEffect, useState, useMemo, ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";

// ---------- useChartColors ----------

interface ChartColors {
  accent: string;
  blue: string;
  red: string;
  orange: string;
  purple: string;
  text: string;
  text2: string;
  text3: string;
  surface2: string;
  border: string;
  grid: string;
}

function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function useChartColors(): ChartColors {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const obs = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    setDark(document.documentElement.classList.contains("dark"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return useMemo(() => ({
    accent: readCssVar("--accent") || "#22c55e",
    blue: readCssVar("--blue") || "#007aff",
    red: readCssVar("--red") || "#ff3b30",
    orange: readCssVar("--orange") || "#ff9500",
    purple: readCssVar("--purple") || "#8b5cf6",
    text: readCssVar("--text") || "#1d1d1f",
    text2: readCssVar("--text-2") || "#6e6e73",
    text3: readCssVar("--text-3") || "#aeaeb2",
    surface2: readCssVar("--surface-2") || "#f9fafb",
    border: readCssVar("--border") || "rgba(0,0,0,0.06)",
    grid: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
  }), [dark]);
}

// ---------- ChartContainer ----------

interface ChartContainerProps {
  title?: string;
  action?: ReactNode;
  height?: number;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
  className?: string;
}

export function ChartContainer({
  title,
  action,
  height = 240,
  loading,
  empty,
  emptyText = "Няма данни",
  children,
  className = "",
}: ChartContainerProps) {
  if (loading) {
    return (
      <Card className={className}>
        {title && <CardHeader action={action}>{title}</CardHeader>}
        <CardBody>
          <div style={{ height }}><Skeleton className="w-full h-full" /></div>
        </CardBody>
      </Card>
    );
  }

  if (empty) {
    return (
      <Card className={className}>
        {title && <CardHeader action={action}>{title}</CardHeader>}
        <CardBody>
          <div className="flex items-center justify-center text-text-2 text-[13px]" style={{ height }}>
            {emptyText}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className={`flex flex-col ${className}`}>
      {title && <CardHeader action={action}>{title}</CardHeader>}
      <CardBody className="flex-1">
        <ResponsiveContainer width="100%" height={height}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      </CardBody>
    </Card>
  );
}
