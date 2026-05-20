/**
 * Delta badge used under KPI values across the analytics surface.
 *
 * Contract (see docs/analytics-design-contract.md §4 & §8):
 *   - Format is the SAME everywhere: arrow + pct + neutral label.
 *   - Accent (green) = ръст, red = спад. Flip with `inverse` for metrics
 *     where lower is better (CPA, bounce, cost-per-session).
 *   - `unit="pp"` для percentage-point metrics (engagement rate, conv rate)
 *     so the math stays honest ("↓ 2.1pp", not "↓ 2.1%").
 *   - Pass `null` for pct when the previous period had no data — we render
 *     a dash, not a fake "+∞%".
 */
interface DeltaProps {
  pct: number | null;
  label?: string;
  /** Use "pp" for rate metrics (engagement, conversion). Default "%". */
  unit?: "%" | "pp";
  /** Lower-is-better metric (CPA, bounce). Flips the color logic. */
  inverse?: boolean;
  className?: string;
}

export function Delta({ pct, label = "спрямо пр. период", unit = "%", inverse = false, className = "" }: DeltaProps) {
  if (pct === null || !Number.isFinite(pct)) {
    return (
      <div className={`text-[12px] text-text-3 tabular-nums ${className}`}>
        — {label}
      </div>
    );
  }

  // Treat absolute values under 0.05 as flat to avoid "▲ 0.0%" noise.
  const isFlat = Math.abs(pct) < 0.05;
  const isPositive = pct > 0;
  const isGood = isFlat ? null : (inverse ? !isPositive : isPositive);

  // Triangle glyphs (▲ ▼) are the visual anchor for direction — they read
  // faster than arrows and sit on the typographic baseline cleanly. Em-dash
  // for flat keeps the row height stable without implying motion.
  const marker = isFlat ? "—" : isPositive ? "▲" : "▼";
  const color =
    isGood === null ? "text-text-2" : isGood ? "text-accent" : "text-red";

  const formatted = isFlat ? "0" : Math.abs(pct).toFixed(1);

  return (
    <div className={`text-[12px] tabular-nums ${className}`}>
      <span className={`font-semibold ${color}`}>
        <span className="text-[10px] align-middle mr-0.5">{marker}</span>
        {formatted}{unit}
      </span>
      {label && <span className="text-text-3 ml-1.5">{label}</span>}
    </div>
  );
}

/**
 * Pure helper for computing delta percentage between two numeric values.
 * Returns null when the baseline is 0 — undefined "infinity %" is not a
 * number anyone should see on a dashboard.
 */
export function calcDeltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Percentage-point delta for rate metrics (engagement rate, conversion rate).
 * Inputs are expected as fractions (0.54 for 54%), output is in pp.
 */
export function calcDeltaPp(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return (current - previous) * 100;
}
