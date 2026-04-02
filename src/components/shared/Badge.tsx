import { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type Variant = "green" | "red" | "blue" | "orange" | "neutral";

const styles: Record<Variant, string> = {
  green: "bg-accent-soft text-accent",
  red: "bg-red-soft text-red",
  blue: "bg-blue-soft text-blue",
  orange: "bg-orange-soft text-orange",
  neutral: "bg-surface-2 text-text-3",
};

export function Badge({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: Variant;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

export function ChangeBadge({
  value,
  suffix = "%",
}: {
  value: number | null;
  suffix?: string;
}) {
  if (value === null) return <Badge variant="neutral">--</Badge>;

  const variant = value > 0 ? "green" : value < 0 ? "red" : "neutral";
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  const prefix = value > 0 ? "+" : "";

  return (
    <Badge variant={variant}>
      <Icon size={12} />
      {prefix}
      {value.toFixed(1)}
      {suffix}
    </Badge>
  );
}
