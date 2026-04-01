import { ChevronDown, ChevronUp, ArrowUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";

export function SortButton<T extends string>({
  label,
  sortKey,
  currentKey,
  dir,
  onToggle,
}: {
  label: string;
  sortKey: T;
  currentKey: T;
  dir: SortDir;
  onToggle: (key: T) => void;
}) {
  const isActive = currentKey === sortKey;
  return (
    <button
      onClick={() => onToggle(sortKey)}
      className={`
        flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 cursor-pointer
        ${isActive
          ? "bg-surface-2 text-text border border-border-strong"
          : "text-text-3 hover:text-text-2"
        }
      `}
    >
      {label}
      {isActive ? (
        dir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />
      ) : (
        <ArrowUpDown size={10} className="opacity-40" />
      )}
    </button>
  );
}

export function FilterPill<T extends string>({
  label,
  value,
  currentValue,
  onChange,
}: {
  label: string;
  value: T;
  currentValue: T;
  onChange: (value: T) => void;
}) {
  const isActive = currentValue === value;
  return (
    <button
      onClick={() => onChange(value)}
      className={`
        px-3 py-1.5 rounded-full text-[12px] font-medium transition-all duration-150 cursor-pointer
        ${isActive
          ? "bg-accent text-white shadow-sm"
          : "text-text-3 hover:text-text-2 hover:bg-surface-2"
        }
      `}
    >
      {label}
    </button>
  );
}
