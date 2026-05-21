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

  // Gesture-intent state. A pointerdown inside the chart is ambiguous:
  // it could be the start of a horizontal scrub OR the start of a
  // vertical page scroll. Committing activeIdx on pointerdown flashed
  // the tooltip for one frame every time the operator tried to scroll
  // the page through the chart. So we withhold judgement: store the
  // start point, classify on the first move that clears the 6px
  // threshold, and only commit once the gesture is decided horizontal.
  // A pointerdown→pointerup with no move past threshold is a TAP and
  // commits at the tap position on release.
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const intentRef = useRef<"undecided" | "horizontal" | "vertical">(
    "undecided"
  );
  const INTENT_THRESHOLD_PX = 6;

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
      startRef.current = { x: e.clientX, y: e.clientY };
      intentRef.current = "undecided";
      // No setActiveIdx here — intent is still ambiguous. A flash-free
      // pointerdown is the whole point of this gate.
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return;
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const start = startRef.current;
      if (!start) return;

      // Once the gesture is classified vertical, stay out of the way —
      // the browser owns the page scroll (touch-action: pan-y on the
      // wrapper) and we never commit.
      if (intentRef.current === "vertical") return;

      if (intentRef.current === "undecided") {
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);
        if (dx < INTENT_THRESHOLD_PX && dy < INTENT_THRESHOLD_PX) {
          return; // too small to classify yet
        }
        intentRef.current = dx > dy ? "horizontal" : "vertical";
        if (intentRef.current === "vertical") return;
      }

      // intent === "horizontal"
      const idx = indexFromEvent(e);
      if (idx !== null) setActiveIdx(idx);
    },
    [indexFromEvent]
  );

  const releaseCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return;
      // A pointerup while still "undecided" means the finger never
      // travelled past the threshold — that's a TAP. Commit the index
      // at the tap position so a plain tap still inspects a point.
      // pointercancel (e.type) is the browser claiming the gesture for
      // a scroll; never commit on that.
      if (
        e.type === "pointerup" &&
        intentRef.current === "undecided" &&
        startRef.current
      ) {
        const idx = indexFromEvent(e);
        if (idx !== null) setActiveIdx(idx);
      }
      startRef.current = null;
      intentRef.current = "undecided";
      // Release the capture but DO NOT clear activeIdx — persistence
      // is the contract. The popup and chart cursor stay on the last
      // position the operator picked.
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [indexFromEvent]
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
