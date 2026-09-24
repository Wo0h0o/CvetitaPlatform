import { LockGate } from "@/components/pricing/LockGate";

export default function PricingKeyLayout({ children }: { children: React.ReactNode }) {
  return (
    <LockGate module="key" title="Оферти — Ключови клиенти (реални цени/себестойности)">
      {children}
    </LockGate>
  );
}
