import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { TopProducts } from "@/components/dashboard/TopProducts";
import { NewsFeed } from "@/components/dashboard/NewsFeed";

export default function DashboardPage() {
  return (
    <>
      <KpiGrid />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopProducts />
        <NewsFeed />
      </div>
    </>
  );
}
