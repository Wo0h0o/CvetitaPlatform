"use client";

import { use, useState } from "react";
import useSWR, { mutate } from "swr";
import { PageHeader } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/shared/Skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs } from "@/components/shared/Tabs";
import { CompetitorHero } from "@/components/competitors/CompetitorHero";
import { OverviewTab } from "@/components/competitors/OverviewTab";
import { CatalogMapTab } from "@/components/competitors/CatalogMapTab";
import { useToast } from "@/providers/ToastProvider";
import { ShieldOff, LayoutDashboard, Link2 } from "lucide-react";

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
  return json;
});

interface CompetitorDetail {
  competitor: {
    id: string;
    slug: string;
    name: string;
    domain: string | null;
    facebook_page: string | null;
    category: string;
    logo_url: string | null;
    markets: string[];
    sisterDomains: string[];
    seedUrls: string[];
    lastScanAt: string | null;
  };
  latestPrices: Array<{
    product_name: string;
    product_url: string;
    price: number;
    currency: string;
    in_stock: boolean;
    scraped_at: string;
  }>;
  stats: {
    productsTracked: number;
    inStock: number;
    unreadAlerts: number;
    mappedProducts: number;
  };
}

type TabId = "overview" | "catalog";

export default function CompetitorDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { toast } = useToast();
  const { data, error, isLoading } = useSWR<CompetitorDetail>(
    `/api/competitors/${slug}`,
    fetcher,
    { revalidateOnFocus: false }
  );
  const [tab, setTab] = useState<TabId>("overview");
  const [scanning, setScanning] = useState(false);

  const handleScan = async () => {
    if (!data?.competitor.id) return;
    setScanning(true);
    try {
      const res = await fetch("/api/competitors/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitorId: data.competitor.id }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Scan failed");
      toast(`Сканирани ${result.productsExtracted} продукта`, "success");
      mutate(`/api/competitors/${slug}`);
      mutate(`/api/competitors/${slug}/mappings`);
    } catch (err) {
      toast(`Грешка: ${err instanceof Error ? err.message : "Scan failed"}`, "error");
    } finally {
      setScanning(false);
    }
  };

  if (isLoading) {
    return (
      <>
        <PageHeader title="Конкурент" />
        <Skeleton className="h-32 w-full mb-6" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader title="Конкурент" />
        <EmptyState
          icon={ShieldOff}
          title="Конкурентът не е намерен"
          description={`Няма конкурент с slug "${slug}" в твоята организация.`}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={data.competitor.name} />
      <CompetitorHero competitor={data.competitor} scanning={scanning} onScan={handleScan} />

      <Tabs<TabId>
        tabs={[
          { id: "overview", label: "Обзор", icon: <LayoutDashboard size={13} /> },
          {
            id: "catalog",
            label: "Каталогна карта",
            icon: <Link2 size={13} />,
            count: data.stats.mappedProducts,
          },
        ]}
        active={tab}
        onChange={setTab}
        className="mb-6"
      />

      {tab === "overview" && (
        <OverviewTab
          competitor={data.competitor}
          stats={data.stats}
          latestPrices={data.latestPrices}
        />
      )}

      {tab === "catalog" && (
        <CatalogMapTab competitorSlug={slug} latestPrices={data.latestPrices} />
      )}
    </>
  );
}
