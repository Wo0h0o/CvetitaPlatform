import { ChangeBadge } from "@/components/shared/Badge";

export interface KpiData {
  label: string;
  value: string;
  change: number | null;
  suffix?: string;
}

export function KpiCard({ label, value, change, suffix = "%" }: KpiData) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
      <div className="text-[13px] font-semibold text-text mb-3">
        {label}
      </div>
      <div className="text-[32px] font-bold tracking-tight text-text leading-none mb-2">
        {value}
      </div>
      <ChangeBadge value={change} suffix={suffix} />
    </div>
  );
}
