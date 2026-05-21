/**
 * Shared series helpers for the home dashboard tempo charts.
 *
 * The home tempo strip has three rendering kinds:
 *   hourly  — 24 buckets (today / yesterday)
 *   daily   — N buckets (7d / 30d / short customs)
 *   weekly  — N/7 buckets (90d / long customs, anchored on `to` rolling
 *             back in 7-day windows; the oldest bucket may be partial)
 *
 * The route picks the kind from the resolved DateWindow + preset, then
 * shapes both the current and comparison arrays through the same helpers
 * so the two lines on the chart share an x-axis index by construction.
 */

import { shiftDate, sofiaHoursElapsed } from "./sofia-date";

export type SeriesKind = "hourly" | "daily" | "weekly";

export interface SeriesShape<T = number> {
  kind: SeriesKind;
  /** Bucket labels — ISO date for daily/weekly, "00"-"23" for hourly. */
  labels: string[];
  /** Current-window values, one per label. */
  current: T[];
  /**
   * Comparison-window values, aligned to the same bucket positions.
   * Null when no baseline is available (e.g. first-time hourly run with
   * <4 prior same-weekdays in the table).
   */
  comparison: T[] | null;
  /**
   * For hourly only: the highest bucket index with real data. UI draws a
   * vertical "now" marker here and stops the area fill past it.
   * Undefined for daily/weekly (the whole window is filled).
   */
  nowIndex?: number;
  /**
   * For weekly only: true at indices whose bucket aggregates <7 days
   * (the oldest bucket when the window length isn't a multiple of 7).
   * UI renders these with reduced opacity + a "(частична седмица)" hint
   * in the tooltip. Undefined / all-false for daily / hourly.
   */
  partial?: boolean[];
}

// ============================================================
// Hourly cumulative helpers
// ============================================================

/**
 * Cumulative sum: `[a, b, c, ...]` → `[a, a+b, a+b+c, ...]`.
 * The hourly tempo curve is read as "how much accumulated by hour H",
 * mirroring the matched-hour `vsTypical` headline arithmetic.
 */
export function cumulative(values: number[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const v of values) {
    sum += v;
    out.push(Number(sum.toFixed(2)));
  }
  return out;
}

/**
 * Build the typical-day hourly baseline as an average across N prior
 * same-weekday hourly arrays. Each input is a 24-element array (raw
 * per-hour values, not cumulative); the output is the per-hour average
 * across them. Caller wraps with `cumulative()` when the chart wants
 * the rolling baseline.
 *
 * Returns null when `priors` is empty so the caller can render the
 * single-line "няма сравнителна линия" fallback rather than a flat zero.
 */
export function averageHourly(priors: number[][]): number[] | null {
  if (priors.length === 0) return null;
  const out: number[] = new Array(24).fill(0);
  for (const p of priors) {
    for (let h = 0; h < 24; h++) {
      out[h] += p[h] ?? 0;
    }
  }
  for (let h = 0; h < 24; h++) {
    out[h] = Number((out[h] / priors.length).toFixed(2));
  }
  return out;
}

/**
 * Index of the last hour we should treat as "filled with real data" for
 * today's intraday curve. Returns the floor of the current Sofia hour
 * elapsed — i.e. while it is 14:35 Sofia, hours 0..14 are real and 15+
 * have not happened yet. Yesterday and earlier days always return 23.
 */
export function nowIndexForToday(isToday: boolean): number | undefined {
  if (!isToday) return undefined;
  // sofiaHoursElapsed returns 0-24 fractional; the latest fully-elapsed
  // hour is floor. At exactly 14:00 Sofia, hour 14 has just begun (0
  // minutes of real data), so we expose 13 as the last fully-rendered
  // bucket. clamp [0..23].
  const elapsed = sofiaHoursElapsed();
  const idx = Math.min(23, Math.max(0, Math.floor(elapsed)));
  return idx;
}

// ============================================================
// Weekly bucketing for 90d
// ============================================================

/**
 * Bucket a daily series into weekly aggregates, anchored on the *latest*
 * date and rolling back in 7-day windows. The oldest bucket may be
 * partial (1-6 days) when the input length isn't a multiple of 7.
 *
 * Pre-conditions:
 *   * `dates` is sorted ascending (oldest first) and matches `values` length.
 *   * `agg = 'sum'` for additive metrics (revenue, orders, spend).
 *   * `agg = 'mean'` for rate metrics (ROAS, AOV, attribution pct).
 *
 * Returns:
 *   labels — ISO date of the LAST day in each bucket (the "week-ending"
 *            convention used in finance reports). Newest bucket last.
 *   values — aggregated per bucket, in the same order.
 *   partial — bitmask: true when that bucket holds <7 days.
 */
export function weeklyBucketize(
  dates: string[],
  values: number[],
  agg: "sum" | "mean" = "sum"
): { labels: string[]; values: number[]; partial: boolean[] } {
  if (dates.length === 0 || dates.length !== values.length) {
    return { labels: [], values: [], partial: [] };
  }

  // Walk backwards from the newest date, taking 7-day chunks. This keeps
  // the "last bucket = last 7 days" invariant regardless of total length,
  // which is what readers want: the rightmost bar is always "this week so
  // far".
  const labels: string[] = [];
  const out: number[] = [];
  const partial: boolean[] = [];

  for (let end = dates.length; end > 0; end -= 7) {
    const start = Math.max(0, end - 7);
    const slice = values.slice(start, end);
    const sum = slice.reduce((a, b) => a + b, 0);
    const value = agg === "mean" ? (slice.length > 0 ? sum / slice.length : 0) : sum;
    labels.unshift(dates[end - 1]);
    out.unshift(Number(value.toFixed(2)));
    partial.unshift(slice.length < 7);
  }

  return { labels, values: out, partial };
}

// ============================================================
// Series-kind picker
// ============================================================

/**
 * Pick the right rendering kind for a resolved date window. Centralised so
 * the route, the response shape, and the tooltip formatter agree on what
 * the labels mean.
 *
 * - preset=today / yesterday → hourly
 * - preset=90d              → weekly (always — keeps mobile tooltip usable)
 * - other relative presets  → daily
 * - custom: daily up to 60 days, weekly beyond. Avoids a third "monthly"
 *   kind for now — KISS — but matches the 90d mobile rationale for any
 *   wide custom range.
 */
export function pickSeriesKind(preset: string, days: number): SeriesKind {
  if (preset === "today" || preset === "yesterday") return "hourly";
  if (preset === "90d") return "weekly";
  if (preset === "custom" && days > 60) return "weekly";
  return "daily";
}

// ============================================================
// Build the anchored window dates (oldest first)
// ============================================================

/** Inclusive ISO date range expanded to an array, oldest first. */
export function expandRange(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  if (fromIso > toIso) return out;
  let cursor = toIso;
  let guard = 0;
  while (cursor >= fromIso && guard < 400) {
    out.unshift(cursor);
    cursor = shiftDate(cursor, 1);
    guard++;
  }
  return out;
}

// ============================================================
// Generic alignment for comparison windows
// ============================================================

/**
 * Given a window's date list and a same-shape comparison date list, look
 * up the values in `byDate` and zero-fill missing days. Output arrays
 * have identical length so chart indices line up.
 */
export function alignDaily<T extends Record<string, number>>(
  byDate: Map<string, T>,
  dates: string[],
  field: keyof T
): number[] {
  return dates.map((d) => {
    const row = byDate.get(d);
    if (!row) return 0;
    const v = row[field];
    return typeof v === "number" ? v : 0;
  });
}
