import type { ReactNode } from "react";

// ============================================================
// GlassTooltip — the surface vocabulary used by every chart card on
// /sales (hero strip, trend, day-pulse, rhythm hour-strip). Hoisted
// out of those files so the visual language can't drift row to row.
//
//   bg-surface/85 backdrop-blur-xl
//   border-border/60 rounded-xl shadow-xl
//   px-3 py-2.5
//   text-[11px] leading-tight
//   header in font-medium text-[11.5px]
//   hairline divider
//   label→value grid with tabular-nums
//
// Consumers pass:
//   - `header` (e.g. "12 май", "14:00 ч.")
//   - `rows` (array of {label, value, accent?: 'good'|'bad'|'flat'})
//
// Used in two contexts:
//   1. As a Recharts Tooltip content function (desktop hover).
//   2. Rendered inline above the mobile scrubber when activeIdx
//      is set (touch flow).
// ============================================================

export interface GlassTooltipRowAccent {
  tone: "good" | "bad" | "flat" | "neutral";
  suffix?: string; // e.g. "▲ 12%", "▼ 100%"
}

export interface GlassTooltipRow {
  label: string;
  value: string;
  /** Optional accent suffix next to the value (e.g. delta chip). */
  accent?: GlassTooltipRowAccent;
}

export function GlassTooltip({
  header,
  rows,
  minWidth = 200,
  className,
}: {
  header: string;
  rows: GlassTooltipRow[];
  minWidth?: number;
  className?: string;
}) {
  return (
    <div
      className={`
        bg-surface/85 backdrop-blur-xl
        border border-border/60 rounded-xl shadow-xl
        px-3 py-2.5
        text-[11px] leading-tight
        ${className ?? ""}
      `}
      style={{ minWidth }}
    >
      <div className="text-text font-medium text-[11.5px]">{header}</div>
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        {rows.map((r, i) => (
          <GlassRow key={i} row={r} />
        ))}
      </div>
    </div>
  );
}

function GlassRow({ row }: { row: GlassTooltipRow }) {
  const toneColor =
    row.accent?.tone === "good"
      ? "text-accent"
      : row.accent?.tone === "bad"
        ? "text-red"
        : row.accent?.tone === "flat"
          ? "text-text-3"
          : "text-text-2";

  return (
    <>
      <span className="text-text-3">{row.label}</span>
      <span className="text-text font-semibold tabular-nums text-right">
        <span>{row.value}</span>
        {row.accent?.suffix && (
          <span className={`ml-2 tabular-nums ${toneColor}`}>
            {row.accent.suffix}
          </span>
        )}
      </span>
    </>
  );
}

// ============================================================
// Helper — build the comparison-delta accent suffix the way every
// /sales card already does it. Kept here so the rounding + flat
// threshold + ▲/▼/— glyph choice stay identical across charts.
// ============================================================

export function deltaAccent(
  current: number,
  comparison: number | null,
  unit: "%" | "pp" = "%"
): GlassTooltipRowAccent | undefined {
  if (comparison === null || comparison <= 0) return undefined;
  const pct = Math.round(((current - comparison) / comparison) * 100);
  const isFlat = Math.abs(pct) < 1;
  const arrow = isFlat ? "—" : pct > 0 ? "▲" : "▼";
  return {
    tone: isFlat ? "flat" : pct > 0 ? "good" : "bad",
    suffix: `${arrow} ${Math.abs(pct)}${unit}`,
  };
}

// Wrap an arbitrary inline node as a custom Recharts Tooltip content
// renderer. Recharts passes `active` and `payload`; this avoids each
// chart file repeating the same `if (!active || !payload?.length)
// return null` guard. The build callback receives the first payload
// row (which carries our typed PulseRow / ChartRow / etc) and
// returns the GlassTooltip element.
export function buildRechartsTooltip<TRow>(
  build: (row: TRow) => { header: string; rows: GlassTooltipRow[]; minWidth?: number } | null
) {
  return function RechartsContent({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: ReadonlyArray<{ payload?: TRow }>;
  }): ReactNode {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    const built = build(row);
    if (!built) return null;
    return (
      <GlassTooltip
        header={built.header}
        rows={built.rows}
        minWidth={built.minWidth}
      />
    );
  };
}
