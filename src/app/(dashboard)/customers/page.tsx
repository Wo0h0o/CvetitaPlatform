"use client";

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { CustomerListTab } from "./_components/CustomerListTab";
import { CustomerAnalyticsTab } from "./_components/CustomerAnalyticsTab";
import { AgentStatsTab } from "./_components/AgentStatsTab";

type Tab = "list" | "analytics" | "agents";

const TABS: { key: Tab; label: string }[] = [
  { key: "list",      label: "Списък" },
  { key: "agents",    label: "Агенти" },
  { key: "analytics", label: "Аналитика" },
];

function CustomersPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tabParam = sp.get("tab");
  const activeTab: Tab =
    tabParam === "analytics" ? "analytics" :
    tabParam === "agents"    ? "agents" :
    "list";

  const setTab = useCallback(
    (next: Tab) => {
      const newSp = new URLSearchParams(sp.toString());
      if (next === "list") {
        newSp.delete("tab");
      } else {
        newSp.set("tab", next);
      }
      const qs = newSp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, sp]
  );

  return (
    <>
      <PageHeader title="Клиенти" />

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-border mb-5 -mt-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`
              px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap
              ${activeTab === t.key
                ? "border-accent text-text"
                : "border-transparent text-text-2 hover:text-text"}
            `}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "list" && <CustomerListTab />}
      {activeTab === "agents" && <AgentStatsTab />}
      {activeTab === "analytics" && <CustomerAnalyticsTab />}
    </>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <CustomersPageInner />
    </Suspense>
  );
}
