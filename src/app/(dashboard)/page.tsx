import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { TopProducts } from "@/components/dashboard/TopProducts";
import { NewsFeed } from "@/components/dashboard/NewsFeed";
import { RevenueTrend } from "@/components/dashboard/RevenueTrend";
import { ChannelBreakdown } from "@/components/dashboard/ChannelBreakdown";
import { PageHeader } from "@/components/shared/PageHeader";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Дашборд" />
      <KpiGrid />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <RevenueTrend />
        <ChannelBreakdown />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopProducts />
        <NewsFeed />
      </div>
    </>
  );
}
