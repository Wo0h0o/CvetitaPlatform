"use client";

import { useMemo } from "react";
import { HeatmapGrid } from "@/components/charts/HeatmapGrid";
import { fmtInt } from "@/lib/format";

// ============================================================
// TrafficRhythm — "кога идва трафикът" 7×24 heatmap.
//
// 7 ISO weekdays (rows, Mon-first) × 24 hours coloured by the
// AVERAGE sessions per occurrence of that (weekday, hour) cell.
// Design contract §9: "кога през деня/седмицата" → hour×weekday
// heatmap. §12: averaged view — the API already divided each
// bucket by how many of that weekday lived in the (complete-days)
// window, and hands us that divisor as `weekdayCounts` so the
// tooltip can surface "средно от N" — never a raw cross-bucket sum.
//
// Purely presentational: the /traffic page owns the single GA4
// fetch and passes the rhythm slice down (mirrors KpiStrip on Home).
// ============================================================

interface RhythmBucket {
  /** ISO weekday, 1=Mon .. 7=Sun. */
  weekday: number;
  hour: number;
  sessions: number;
  avgSessions: number;
}

type HeatRow = {
  label: string;
  cells: { value: number; label?: string; tooltip?: string }[];
};

const WEEKDAY_SHORT = ["Пон", "Вт", "Ср", "Чет", "Пет", "Сб", "Нд"];
const WEEKDAY_FULL = [
  "Понеделник",
  "Вторник",
  "Сряда",
  "Четвъртък",
  "Петък",
  "Събота",
  "Неделя",
];

// Print every 3rd hour; blanks between read as a rhythm, not a dense table.
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) =>
  h % 3 === 0 ? String(h).padStart(2, "0") : ""
);

export function TrafficRhythm({
  rhythm,
  weekdayCounts,
}: {
  rhythm: RhythmBucket[];
  /** ISO-weekday → occurrence count in the rhythm window (the §12 divisor). */
  weekdayCounts: Record<string, number>;
}) {
  const rows = useMemo<HeatRow[]>(() => {
    if (rhythm.length === 0) return [];
    const grid: HeatRow[] = [];
    for (let wd = 1; wd <= 7; wd++) {
      const n = weekdayCounts[String(wd)] ?? 0;
      const cells: HeatRow["cells"] = [];
      for (let h = 0; h <= 23; h++) {
        const bucket = rhythm.find((x) => x.weekday === wd && x.hour === h);
        const v = bucket ? Math.round(bucket.avgSessions) : 0;
        cells.push({
          value: v,
          tooltip:
            v > 0
              ? `${WEEKDAY_FULL[wd - 1]} ${String(h).padStart(2, "0")}:00 — средно ${fmtInt(
                  v
                )} сесии${n > 0 ? ` (от ${n})` : ""}`
              : undefined,
        });
      }
      grid.push({ label: WEEKDAY_SHORT[wd - 1], cells });
    }
    return grid;
  }, [rhythm, weekdayCounts]);

  // Peak = highest per-occurrence average, so it isn't biased toward
  // whichever weekday simply had more occurrences in the window.
  const peak = useMemo(() => {
    let best: RhythmBucket | null = null;
    for (const b of rhythm) {
      if (b.avgSessions <= 0) continue;
      if (!best || b.avgSessions > best.avgSessions) best = b;
    }
    return best;
  }, [rhythm]);

  const peakCallout = peak
    ? `Пик: ${WEEKDAY_FULL[peak.weekday - 1]} ${String(peak.hour).padStart(
        2,
        "0"
      )}:00 • средно ${fmtInt(Math.round(peak.avgSessions))} сесии`
    : null;

  return (
    <HeatmapGrid
      title="Кога идва трафикът"
      rowHeader="Ден"
      rows={rows}
      columnLabels={HOUR_LABELS}
      formatCell={(v) => fmtInt(v)}
      emptyText="Недостатъчно пълни дни за ритъм"
      action={
        peakCallout ? (
          <span className="text-[11px] text-text-3 tabular-nums hidden sm:inline">
            {peakCallout}
          </span>
        ) : undefined
      }
    />
  );
}
