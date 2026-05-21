"use client";

import type { ReactNode } from "react";

// ============================================================
// MobileScrubber — the touch-driven "tap a point" affordance.
//
// On mobile the global Recharts tooltip handler is muted (see
// globals.css) because direct finger taps obscured the very data the
// operator was trying to read AND painted a global focus outline
// around the entire SVG. Instead, every chart that wants per-point
// inspection on mobile renders this scrubber below it.
//
// Behaviour:
//   - Range input scaled to N data buckets.
//   - Caller owns the active index state — null when idle, number
//     when the user is dragging the thumb.
//   - On release / blur / pointer-cancel the slider clears the
//     active state via `onRelease`, so the breakdown popup fades.
//   - Hidden on md+ (desktop hover model takes over).
//
// The component is intentionally headless about the tooltip — the
// chart's parent renders its own glass card from the active row,
// positioned above the slider per the user-flow contract ("popup
// should appear, just never overlap the slider").
// ============================================================

export interface MobileScrubberProps {
  /** Total number of data points the slider scrubs across. */
  count: number;
  /** Current thumb position; rendered at 0 when caller passes null. */
  value: number | null;
  /** Fired as the user drags the thumb. */
  onChange: (idx: number) => void;
  /** Fired when the user lifts their finger / releases the mouse. */
  onRelease: () => void;
  /** Optional aria label override (defaults to a Bulgarian generic). */
  ariaLabel?: string;
  className?: string;
}

export function MobileScrubber({
  count,
  value,
  onChange,
  onRelease,
  ariaLabel = "Преглед на стойностите по точки",
  className,
}: MobileScrubberProps) {
  // A single-point series has nothing to scrub across; render nothing
  // so the card doesn't carry a non-functional slider on data-thin
  // periods (e.g. a custom 1-bucket window).
  if (count < 2) return null;

  return (
    <input
      type="range"
      min={0}
      max={count - 1}
      step={1}
      value={value ?? 0}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
      // Release signals — every reasonable "finger up" event the
      // platform might fire. PointerUp covers iOS Safari, TouchEnd
      // covers older Android WebViews, Blur covers keyboard tabbing
      // out, MouseUp covers desktop pointer just in case the layout
      // ever leaks past the md breakpoint.
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onTouchEnd={onRelease}
      onMouseUp={onRelease}
      onBlur={onRelease}
      className={`chart-scrubber ${className ?? ""}`}
      aria-label={ariaLabel}
    />
  );
}

// ============================================================
// MobileScrubberRow — convenience wrapper that lays out the breakdown
// popup directly above the slider, so the popup can never overlap
// the slider (the user-flow contract from the screenshot review).
// Chart parents use it like:
//
//   <MobileScrubberRow
//     visible={activeIdx !== null}
//     popup={activeRow ? <GlassCard row={activeRow} /> : null}
//   >
//     <MobileScrubber count={rows.length} ... />
//   </MobileScrubberRow>
//
// The wrapper is `md:hidden` — desktop uses Recharts' hover tooltip.
// ============================================================

export function MobileScrubberRow({
  visible,
  popup,
  children,
}: {
  visible: boolean;
  popup: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="md:hidden mt-3">
      {/* Reserve vertical space for the popup even when invisible so
          the chart doesn't reflow upward as the user starts scrubbing
          — the visual "centre of gravity" stays put. */}
      <div className="min-h-[58px] mb-1.5 flex items-start">
        <div
          className={`w-full transition-opacity duration-150 ${
            visible ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          aria-live="polite"
        >
          {popup}
        </div>
      </div>
      {children}
    </div>
  );
}
