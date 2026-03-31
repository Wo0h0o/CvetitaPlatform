import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { MarketPulse } from "@/components/dashboard/MarketPulse";
import { NewsFeed } from "@/components/dashboard/NewsFeed";

export default function DashboardPage() {
  return (
    <>
      <KpiGrid />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MarketPulse />
        <NewsFeed />
      </div>
    </>
  );
}
