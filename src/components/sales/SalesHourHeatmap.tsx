"use client";

import { useAnalyticsSWR } from "@/hooks/useAnalyticsSWR";
import { useMemo, useState } from "react";
import { HeatmapGrid } from "@/components/charts/HeatmapGrid";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { ErrorState } from "@/components/shared/ErrorState";
import { MetricChips } from "@/components/shared/MetricChips";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import {
  fmtCompactEur,
  fmtCompactInt,
  fmtEur,
  fmtInt,
} from "@/lib/format";
import type { HourWeekdayBucket } from "@/lib/sales-queries";

// ============================================================
// SalesHourHeatmap — the 7×24 matrix view.
//
// Lives on the store drill-down (`/sales/store/[id]`) as the "give me
// the full matrix" power-user view. The main /sales page replaced
// this with the SalesRhythmPanel (Ритъм + Пулс) which presents the
// same data in a less dense, comparison-aware layout — but for a
// single store the grid is dense enough to be readable, so we keep
// it for the drill-down's "drill into one shop" context.
//
// When `storeId` is passed, the heatmap scopes itself to that store.
// Otherwise it honours useStoreSelection (legacy /sales path —
// retained so older code paths don't break during migration).
// ============================================================

// ============================================================
// SalesHourHeatmap — "когато купуват" rhythm view.
//
// 7 weekdays (rows, ISO Mon-first) × 24 hours (columns) coloured by
// revenue or order count in the selected period. Accent-shade ladder
// per design-contract §1 — never categorical colours.
//
// Toggle between Приходи / Поръчки: revenue answers "where the money
// is", orders answers "where the volume is". On a healthy account
// they correlate; divergence is interesting (e.g. weekend orders are
// many but small).
//
// Why this is a real ops tool, not eye candy:
//   * "Twenty-percent of weekly revenue lands Saturday 20:00–23:00" is
//     actionable — schedule the email send, the ad push, the support
//     coverage around it.
//   * Empty zones reveal opportunity — if Tuesday afternoon is dead but
//     same-product market shows demand, that's a media-buy hypothesis.
//
// Mobile: 600px min-width with horizontal scroll inside the card
// (handled by HeatmapGrid). The card itself fits in any column.
// ============================================================


interface HourWeekdayResponse {
  buckets: HourWeekdayBucket[];
  error?: string;
}

// ISO Mon-first. Bulgarian short weekday names — match the calendar
// convention БГ users see everywhere else (`Пон, Вт, Ср, Чет, Пет, Сб, Нд`).
const WEEKDAY_LABELS_BG = ["Пон", "Вт", "Ср", "Чет", "Пет", "Сб", "Нд"];
const WEEKDAY_LABELS_FULL_BG = ["Понеделник", "Вторник", "Сряда", "Четвъртък", "Петък", "Събота", "Неделя"];

// Hour column headers — every 3 hours we print, others stay blank to
// reduce visual noise. "00 _ _ 03 _ _ 06" reads as a rhythm; "00 01 02
// 03..." reads as a dense table.
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? String(h).padStart(2, "0") : ""));

type Metric = "revenue" | "orders";


interface PeakCallout {
  weekday: number;
  hour: number;
  value: number;
}

function findPeak(buckets: HourWeekdayBucket[], key: "revenue" | "orders"): PeakCallout | null {
  if (buckets.length === 0) return null;
  let peak: PeakCallout | null = null;
  for (const b of buckets) {
    const v = b[key];
    if (v <= 0) continue;
    if (!peak || v > peak.value) {
      peak = { weekday: b.weekday, hour: b.hour, value: v };
    }
  }
  return peak;
}

interface SalesHourHeatmapProps {
  /** Scope to a single store. When omitted, defers to URL-driven store
   *  selection (multi-store / "all" mode). */
  storeId?: string;
}

export function SalesHourHeatmap({ storeId }: SalesHourHeatmapProps = {}) {
  const { queryString } = useDateRange();
  const { storeParam: urlStoreParam } = useStoreSelection();
  // When invoked with an explicit storeId we always force that store —
  // the drill-down page never shows "all" via this widget.
  const storeParam = storeId ? `stores=${storeId}` : urlStoreParam;
  const [metric, setMetric] = useState<Metric>("revenue");

  const { data, isLoading, error, mutate } = useAnalyticsSWR<HourWeekdayResponse>(
    `/api/sales/hour-weekday?${queryString}&${storeParam}`
  );

  const buckets = useMemo(() => data?.buckets ?? [], [data?.buckets]);

  // Build 7 rows × 24 cells. ISO weekday is 1-7, we index our label
  // array 0-6, so wd-1 is the row index.
  const rows = useMemo(() => {
    const grid: { label: string; cells: { value: number; label?: string; tooltip?: string }[] }[] = [];
    const fmtCompact = metric === "revenue" ? fmtCompactEur : fmtCompactInt;
    const fmtFull = metric === "revenue" ? fmtEur : fmtInt;
    for (let wd = 1; wd <= 7; wd++) {
      const cells: { value: number; label?: string; tooltip?: string }[] = [];
      for (let h = 0; h <= 23; h++) {
        const bucket = buckets.find((b) => b.weekday === wd && b.hour === h);
        const v = bucket ? bucket[metric] : 0;
        cells.push({
          value: v,
          label: v > 0 ? fmtCompact(v) : undefined,
          tooltip:
            v > 0
              ? `${WEEKDAY_LABELS_FULL_BG[wd - 1]} ${String(h).padStart(2, "0")}:00 — ${fmtFull(v)}`
              : undefined,
        });
      }
      grid.push({ label: WEEKDAY_LABELS_BG[wd - 1], cells });
    }
    return grid;
  }, [buckets, metric]);

  const peak = useMemo(() => findPeak(buckets, metric), [buckets, metric]);

  const peakCallout = peak
    ? `Пик: ${WEEKDAY_LABELS_FULL_BG[peak.weekday - 1]} ${String(peak.hour).padStart(2, "0")}:00 • ${
        metric === "revenue" ? fmtEur(peak.value) : fmtInt(peak.value)
      } ${metric === "orders" ? "поръчки" : ""}`.trim()
    : null;

  if (error) {
    return (
      <Card>
        <CardHeader>Кога купуват</CardHeader>
        <CardBody>
          <ErrorState error={error} onRetry={() => mutate()} />
        </CardBody>
      </Card>
    );
  }

  return (
    <HeatmapGrid
      title="Кога купуват"
      rowHeader="Ден"
      rows={rows}
      columnLabels={HOUR_LABELS}
      formatCell={metric === "revenue" ? fmtCompactEur : fmtCompactInt}
      loading={isLoading}
      emptyText="Няма поръчки в избрания период"
      action={
        <div className="flex items-center gap-3">
          {peakCallout && (
            <span className="text-[11px] text-text-3 tabular-nums hidden sm:inline">
              {peakCallout}
            </span>
          )}
          <MetricChips<Metric>
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "revenue", label: "Приходи" },
              { value: "orders", label: "Поръчки" },
            ]}
          />
        </div>
      }
    />
  );
}
