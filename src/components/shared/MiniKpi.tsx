import { SparkLine } from "@/components/charts/SparkLine";

interface MiniKpiProps {
  icon: React.ElementType;
  label: string;
  value: string;
  highlight?: boolean;
  sparkData?: number[];
}

export function MiniKpi({ icon: Icon, label, value, highlight, sparkData }: MiniKpiProps) {
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
    </div>
  );
}
