import { Suspense } from "react";
import { Shell } from "@/components/layout/Shell";

// Force dynamic rendering for all dashboard pages (they use useSearchParams for date filters)
export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense>
      <Shell>
        <Suspense>{children}</Suspense>
      </Shell>
    </Suspense>
  );
}
