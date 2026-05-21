"use client";

import { useDateRange } from "@/hooks/useDateRange";
import { SalesDayPulse } from "./SalesDayPulse";
import { SalesRhythm } from "./SalesRhythm";

// ============================================================
// SalesRhythmPanel — adaptive "when do customers buy?" surface.
//
// The shape of the answer depends on what window the user picked:
//
//   * Single day (today / yesterday / custom from===to) →
//     SalesDayPulse — a 24-hour combo of orders bars + revenue line
//     with the prior day's revenue dashed on top. Weekday dimension
//     is meaningless in this window.
//
//   * Multi-day (7d / 30d / 90d / any custom range with from<to) →
//     SalesRhythm — 7 weekday small multiples + a 24-hour aggregate
//     strip, each with prior-period comparison.
//
// Detecting from the resolved range (not the preset name) means
// custom 1-day ranges entered manually also flip into Pulse mode,
// and custom ≥2-day ranges flip into Rhythm. 100% contextual to
// whatever window the date picker resolved.
// ============================================================

export function SalesRhythmPanel() {
  const { from, to } = useDateRange();
  if (from === to) return <SalesDayPulse />;
  return <SalesRhythm />;
}
