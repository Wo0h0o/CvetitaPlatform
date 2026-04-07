import { Suspense } from "react";
import { Shell } from "@/components/layout/Shell";
import { DataProvider } from "@/providers/DataProvider";
import { ToastProvider } from "@/providers/ToastProvider";

// Force dynamic rendering for all dashboard pages (they use useSearchParams for date filters)
export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense>
      <DataProvider>
        <ToastProvider>
          <Shell>
            <Suspense>{children}</Suspense>
          </Shell>
        </ToastProvider>
      </DataProvider>
    </Suspense>
  );
}
