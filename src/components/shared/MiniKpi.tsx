import { SparkLine } from "@/components/charts/SparkLine";
import { KpiSpark } from "@/components/charts/KpiSpark";
import { Delta } from "@/components/shared/Delta";

interface MiniKpiProps {
  /** Optional — analytics screens omit per design contract §3. */
  icon?: React.ElementType;
  label: string;
  value: string;
  /** Optional secondary line below the value (used by the email dashboard). */
  sub?: string;
  highlight?: boolean;
  sparkData?: number[];
  /**
   * Spark shape — "bars" for discrete counts (orders, purchases,
   * conversions), "area" for continuous metrics. Design contract §9.2.
   * Only applied in the `hero` layout. Defaults to "area".
   */
  sparkKind?: "area" | "bars";
  /**
   * Optional comparison delta. When set, renders the contract's unified
   * delta badge under the value. See docs/analytics-design-contract.md §4.
   */
  delta?: {
    pct: number | null;
    label?: string;
    unit?: "%" | "pp";
    inverse?: boolean;
  };
  /**
   * When true, renders the analytics-contract layout: bigger hero number,
   * label above the value, no icon. Falls back to the legacy compact layout
   * (used on Home/Products/Email/Ads/Customers) when false.
   */
  hero?: boolean;
}

/**
 * Dashboard KPI tile used on the home page, market pages, traffic, email,
 * products, customers, and every /ads/* subpage. Consolidated from 8 inline
 * copies (§5.4 cleanup). If you need another prop, add it here rather than
 * re-declaring a local `function MiniKpi(...)` — the whole point of having
 * one tile component is that changes to the visual language propagate.
 *
 * Two layouts:
 *   - Default (compact, with optional icon) — kept for legacy dashboards.
 *   - `hero` — used in analytics screens. Label on top, big value, optional
 *     delta below. Strict typography from the design contract.
 */
export function MiniKpi({ icon: Icon, label, value, sub, highlight, sparkData, sparkKind, delta, hero }: MiniKpiProps) {
  if (hero) {
    // Spark sits full-width BELOW the value — never crammed beside it.
    // A wide hero number ("108 816") otherwise squeezes the old corner
    // sparkline into an unreadable stub or off the tile entirely.
    return (
      <div className="bg-surface rounded-xl shadow-sm p-5 flex flex-col">
        <div className="text-[13px] font-semibold text-text-2 mb-2">{label}</div>
        <div className={`text-[28px] font-bold tracking-tight tabular-nums ${highlight ? "text-accent" : "text-text"}`}>
          {value}
        </div>
        {delta && <Delta pct={delta.pct} label={delta.label} unit={delta.unit} inverse={delta.inverse} className="mt-2" />}
        {sub && !delta && <div className="text-[12px] text-text-2 mt-1">{sub}</div>}
        {sparkData && sparkData.length > 1 && (
          <div className="mt-3">
            <KpiSpark data={sparkData} kind={sparkKind} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon size={16} className="text-text-3" />}
        <span className="text-[13px] font-semibold text-text">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className={`text-[22px] font-bold tracking-tight tabular-nums ${highlight ? "text-accent" : "text-text"}`}>
          {value}
        </div>
        {sparkData && sparkData.length > 1 && (
          <SparkLine data={sparkData} height={20} width={64} />
        )}
      </div>
      {delta && <Delta pct={delta.pct} label={delta.label} unit={delta.unit} inverse={delta.inverse} className="mt-1.5" />}
      {sub && !delta && <div className="text-[12px] text-text-2 mt-1">{sub}</div>}
    </div>
  );
}
