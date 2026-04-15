import { SparkLine } from "@/components/charts/SparkLine";

interface MiniKpiProps {
  icon: React.ElementType;
  label: string;
  value: string;
  /** Optional secondary line below the value (used by the email dashboard). */
  sub?: string;
  highlight?: boolean;
  sparkData?: number[];
}

/**
 * Dashboard KPI tile used on the home page, market pages, traffic, email,
 * products, customers, and every /ads/* subpage. Consolidated from 8 inline
 * copies (§5.4 cleanup). If you need another prop, add it here rather than
 * re-declaring a local `function MiniKpi(...)` — the whole point of having
 * one tile component is that changes to the visual language propagate.
 */
export function MiniKpi({ icon: Icon, label, value, sub, highlight, sparkData }: MiniKpiProps) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-text-3" />
        <span className="text-[13px] font-semibold text-text">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className={`text-[22px] font-bold tracking-tight ${highlight ? "text-accent" : "text-text"}`}>
          {value}
        </div>
        {sparkData && sparkData.length > 1 && (
          <SparkLine data={sparkData} height={20} width={64} />
        )}
      </div>
      {sub && <div className="text-[12px] text-text-2 mt-1">{sub}</div>}
    </div>
  );
}
