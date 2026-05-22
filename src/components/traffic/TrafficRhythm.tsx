"use client";

import { useMemo } from "react";
import { HeatmapGrid } from "@/components/charts/HeatmapGrid";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { fmtInt } from "@/lib/format";

// ============================================================
// TrafficRhythm — "кога идва трафикът".
//
// Two layouts, one dataset (design contract §9.6 — a heatmap must
// NOT cram 7×24 = 168 cells into a horizontally-scrolled strip on
// a phone):
//
//   * Desktop (md+) — the full 7×24 HeatmapGrid. Sessions per
//     (weekday, hour), averaged per occurrence.
//   * Mobile (<md)  — collapses to a weekday summary: 7 bars of
//     average sessions/day. No horizontal scroll, so no sticky-
//     column bleed.
//
// §12: the API already divided each bucket by how many of that
// weekday the (complete-days) window held, and hands us that
// divisor as `weekdayCounts` for the tooltip's "средно от N".
//
// Purely presentational — the /traffic page owns the single GA4
// fetch and passes the rhythm slice down.
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
  // --- Desktop: full 7×24 grid ---
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

  // --- Mobile: per-weekday daily average. Summing the per-occurrence
  // hourly averages over 24h yields the average sessions of a typical
  // [weekday] — see §12. ---
  const weekdayTotals = useMemo(() => {
    const totals = WEEKDAY_SHORT.map((label, i) => ({
      weekday: i + 1,
      label,
      avg: 0,
    }));
    for (const b of rhythm) {
      const t = totals[b.weekday - 1];
      if (t) t.avg += b.avgSessions;
    }
    return totals;
  }, [rhythm]);
  const maxWeekday = Math.max(...weekdayTotals.map((w) => w.avg), 1);
  const topWeekday = weekdayTotals.reduce(
    (a, b) => (b.avg > a.avg ? b : a),
    weekdayTotals[0]
  );

  // Peak = highest per-occurrence hourly average, so it isn't biased
  // toward whichever weekday simply had more occurrences in the window.
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

  const peakBadge = peakCallout ? (
    <span className="text-[11px] text-text-3 tabular-nums hidden sm:inline">
      {peakCallout}
    </span>
  ) : undefined;

  return (
    <>
      {/* Desktop — full 7×24 heatmap */}
      <div className="hidden md:block">
        <HeatmapGrid
          title="Кога идва трафикът"
          rowHeader="Ден"
          rows={rows}
          columnLabels={HOUR_LABELS}
          formatCell={(v) => fmtInt(v)}
          emptyText="Недостатъчно пълни дни за ритъм"
          action={peakBadge}
        />
      </div>

      {/* Mobile — weekday summary, no horizontal scroll (§9.6) */}
      <div className="md:hidden">
        <Card>
          <CardHeader>Кога идва трафикът</CardHeader>
          <CardBody>
            {rhythm.length === 0 ? (
              <p className="text-center py-8 text-[13px] text-text-2">
                Недостатъчно пълни дни за ритъм
              </p>
            ) : (
              <>
                <div className="text-[12px] text-text-3 mb-3">
                  Средно сесии на ден
                </div>
                <div className="space-y-3">
                  {weekdayTotals.map((w) => {
                    const isTop = w.avg > 0 && w.weekday === topWeekday.weekday;
                    return (
                      <div key={w.weekday}>
                        <div className="flex items-center justify-between gap-2 text-[13px] mb-1">
                          <span className="text-text">
                            {WEEKDAY_FULL[w.weekday - 1]}
                          </span>
                          <span className="text-text-2 tabular-nums flex-shrink-0">
                            {fmtInt(Math.round(w.avg))}
                          </span>
                        </div>
                        <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              isTop ? "bg-accent" : "bg-text-3"
                            }`}
                            style={{ width: `${(w.avg / maxWeekday) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {peakCallout && (
                  <p className="text-[11px] text-text-3 tabular-nums mt-4 pt-3 border-t border-border">
                    {peakCallout}
                  </p>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
