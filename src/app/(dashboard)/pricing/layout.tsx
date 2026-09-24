import { LockGate } from "@/components/pricing/LockGate";

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (
    <LockGate module="standard" title="Оферти — Private Label">
      {children}
    </LockGate>
  );
}
