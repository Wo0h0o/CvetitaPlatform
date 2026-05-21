"use client";

import { useCallback, useRef, useState } from "react";

// ============================================================
// useChartScrubber — the unified chart inspection model.
//
// Three behaviours, one source of truth:
//
//   1. Chart-touch input. A pointerdown anywhere on the chart wrapper
//      captures the pointer and maps the X position to a data index.
//      Subsequent pointermove events while pressed update the index.
//      Recharts' own touch handlers stay muted by the globals.css
//      mobile rule, so the chart never paints its own tooltip — the
//      user's finger drives the same activeIdx the slider drives.
//
//   2. Slider input. The MobileScrubber below the chart writes to
//      the same activeIdx via setActiveIdx. Slider and chart-touch
//      are two input paths into one state, hence one popup.
//
//   3. Persistence on release. activeIdx is NOT cleared on
//      pointerup/touchend — the operator's last position stays
//      pinned so the cursor + popup stay visible between
//      interactions. Consistency over implicit dismissal.
//
// Layout note: chart wrappers using this hook should add the
// `touch-pan-y` Tailwind class so vertical page scrolling still
// works through the chart while horizontal finger movement engages
// the scrubber.
// ============================================================

export interface ChartScrubberHook {
  activeIdx: number | null;
  /** Direct setter — used by the MobileScrubber slider and by any
   *  imperative reset / programmatic move. */
  setActiveIdx: (idx: number | null) => void;
  /** Ref to attach to the chart wrapper div. */
  wrapperRef: React.RefObject<HTMLDivElement>;
  /** Spread onto the chart wrapper. */
  pointerHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
  };
}

export interface UseChartScrubberOptions {
  /** Number of data points the scrubber maps across. < 2 disables. */
  count: number;
}

export function useChartScrubber({
  count,
}: UseChartScrubberOptions): ChartScrubberHook {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Maps a pointer event's clientX to a 0..count-1 data index via the
  // wrapper's bounding box. We deliberately don't try to compensate
  // for axis padding here — visually, "left edge of card → idx 0" is
  // what an operator expects regardless of where the Y-axis labels
  // happen to sit. Off-by-half-bucket at the edges is invisible at
  // 24–30 buckets across a phone-width chart.
  const indexFromEvent = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): number | null => {
      const wrapper = wrapperRef.current;
      if (!wrapper || count < 2) return null;
      const rect = wrapper.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const rel = (e.clientX - rect.left) / rect.width;
      const clamped = Math.max(0, Math.min(1, rel));
      return Math.round(clamped * (count - 1));
    },
    [count]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Mouse-driven desktop already has Recharts hover; only engage
      // the scrubber for touch / pen.
      if (e.pointerType === "mouse") return;
      // Capture so subsequent moves track even when the finger slides
      // outside the wrapper (e.g. past the card border).
      e.currentTarget.setPointerCapture(e.pointerId);
      const idx = indexFromEvent(e);
      if (idx !== null) setActiveIdx(idx);
    },
    [indexFromEvent]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return;
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const idx = indexFromEvent(e);
      if (idx !== null) setActiveIdx(idx);
    },
    [indexFromEvent]
  );

  const releaseCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Release the capture but DO NOT clear activeIdx — persistence
      // is the contract. The popup and chart cursor stay on the last
      // position the operator picked.
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    []
  );

  return {
    activeIdx,
    setActiveIdx,
    wrapperRef,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: releaseCapture,
      onPointerCancel: releaseCapture,
    },
  };
}
