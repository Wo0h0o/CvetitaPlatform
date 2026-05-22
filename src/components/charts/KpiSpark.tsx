"use client";

import { useId } from "react";
import { Area, Bar, ComposedChart, ResponsiveContainer } from "recharts";

// ============================================================
// KpiSpark — the trend spark under a KPI tile.
//
// Replaces the old bare 64×20 <SparkLine>, which — crammed next to a
// wide hero number — rendered as an unreadable scribble (and got
// squeezed out entirely behind long values like "108 816"). This is
// the SalesHeroStrip `MiniSpark` look distilled into a shared module:
// a full-width, gradient-filled smooth area, given real height below
// the value rather than fighting it for horizontal space.
//
// §7 — a sparkline is a SHAPE, not a reference table: no axes, no
// grid, no dots. §9.2 — counts (orders, purchases, conversions) get
// bars; continuous metrics (sessions, revenue, rates) get the area.
// ============================================================

interface KpiSparkProps {
  data: number[];
  /** "area" for continuous metrics, "bars" for discrete counts (§9.2). */
  kind?: "area" | "bars";
  height?: number;
}

export function KpiSpark({ data, kind = "area", height = 48 }: KpiSparkProps) {
  // useId — Recharts <defs> share a global SVG scope; two tiles with
  // the same gradient id clash.
  const gradId = `kpiSpark-${useId().replace(/:/g, "")}`;

  // Area/line need ≥2 points to draw a segment; a single bar is fine.
  if (data.length < (kind === "bars" ? 1 : 2)) return null;
  const rows = data.map((v, i) => ({ i, v }));

  return (
    <div className="w-full -mx-1" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          {kind === "area" && (
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
          )}
          {kind === "bars" ? (
            <Bar
              dataKey="v"
              fill="var(--accent)"
              radius={[2, 2, 0, 0]}
              maxBarSize={9}
              isAnimationActive={false}
            />
          ) : (
            <Area
              type="monotone"
              dataKey="v"
              stroke="var(--accent)"
              strokeWidth={1.75}
              fill={`url(#${gradId})`}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
