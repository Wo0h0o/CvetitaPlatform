"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { Button } from "@/components/shared/Button";
import { Skeleton } from "@/components/shared/Skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { useToast } from "@/providers/ToastProvider";
import { BarChartCard } from "@/components/charts";
import {
  Shield, Plus, Globe, ExternalLink, TrendingUp, TrendingDown,
  Minus, X, Megaphone, Scan, Loader2,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ---------- Types ----------

interface Competitor {
  id: string;
  name: string;
  domain: string | null;
  facebook_page: string | null;
  category: string;
  logo_url: string | null;
  latestPrices: { product_name: string; price: number; currency: string; in_stock: boolean; scraped_at: string }[];
  activeAds: { ad_text: string; scraped_at: string }[];
}

interface IntelItem {
  id: number;
  title: string;
  summary: string;
  url: string;
  sentiment: string;
  discovered_at: string;
  competitors: { name: string } | null;
}

// ---------- Page ----------

export default function CompetitorsPage() {
  const { toast } = useToast();
  const { data, isLoading } = useSWR<{ competitors: Competitor[] }>("/api/competitors", fetcher, { revalidateOnFocus: false });
  const { data: intelData } = useSWR<{ intel: IntelItem[] }>("/api/competitors/intel", fetcher, { revalidateOnFocus: false });

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDomain, setAddDomain] = useState("");
  const [addFb, setAddFb] = useState("");
  const [adding, setAdding] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!addName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addName, domain: addDomain, facebookPage: addFb }),
      });
      if (!res.ok) throw new Error();
      toast("Конкурент добавен", "success");
      setShowAdd(false);
      setAddName("");
      setAddDomain("");
      setAddFb("");
      mutate("/api/competitors");
    } catch {
      toast("Грешка при добавяне", "error");
    } finally {
      setAdding(false);
    }
  };

  const handleScan = async (competitorId: string) => {
    setScanningId(competitorId);
    try {
      const res = await fetch("/api/competitors/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitorId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Scan failed");
      toast(`Сканирани ${result.productsExtracted} продукта от ${result.urlsFound} URL-а`, "success");
      mutate("/api/competitors");
    } catch (err) {
      toast(`Грешка: ${err instanceof Error ? err.message : "Scan failed"}`, "error");
    } finally {
      setScanningId(null);
    }
  };

  const competitors = data?.competitors || [];
  const intel = intelData?.intel || [];

  if (isLoading) {
    return (
      <>
        <PageHeader title="Конкуренти" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardBody><Skeleton className="h-40 w-full" /></CardBody></Card>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Конкуренти">
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? <><X size={14} /> Отказ</> : <><Plus size={14} /> Добави</>}
        </Button>
      </PageHeader>

      {/* Add Competitor Form */}
      {showAdd && (
        <Card className="mb-6">
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Име (напр. Gymbeam)"
                className="bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[14px] text-text outline-none focus:border-accent placeholder:text-text-3"
              />
              <input
                value={addDomain}
                onChange={(e) => setAddDomain(e.target.value)}
                placeholder="Домейн (напр. gymbeam.bg)"
                className="bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[14px] text-text outline-none focus:border-accent placeholder:text-text-3"
              />
              <input
                value={addFb}
                onChange={(e) => setAddFb(e.target.value)}
                placeholder="Facebook страница"
                className="bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[14px] text-text outline-none focus:border-accent placeholder:text-text-3"
              />
              <Button onClick={handleAdd} disabled={adding || !addName.trim()}>
                {adding ? "Добавяне..." : "Запази"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {competitors.length === 0 && !showAdd ? (
        <EmptyState
          icon={Shield}
          title="Няма добавени конкуренти"
          description="Добави конкуренти, за да следиш техните цени, реклами и пазарна активност."
          action={
            <Button onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Добави конкурент
            </Button>
          }
        />
      ) : (
        <>
          {/* Competitor Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {competitors.map((comp) => (
              <CompetitorCard
                key={comp.id}
                competitor={comp}
                scanning={scanningId === comp.id}
                onScan={() => handleScan(comp.id)}
              />
            ))}
          </div>

          {/* Price Comparison Chart */}
          {competitors.some((c) => c.latestPrices.length > 0) && (
            <PriceComparisonChart competitors={competitors} />
          )}

          {/* Intel Feed */}
          <Card className="mt-6">
            <CardHeader
              action={<span className="text-[12px] text-text-2">{intel.length} новини</span>}
            >
              Разузнаване
            </CardHeader>
            <CardBody>
              {intel.length > 0 ? (
                <div className="space-y-3">
                  {intel.slice(0, 15).map((item) => (
                    <IntelRow key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-text-2 text-[13px]">
                  Няма налични данни. Стартирай scrape или изчакай дневния cron.
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}

// ---------- Competitor Card ----------

function CompetitorCard({ competitor: comp, scanning, onScan }: { competitor: Competitor; scanning: boolean; onScan: () => void }) {
  const priceCount = comp.latestPrices.length;
  const adCount = comp.activeAds.length;
  const avgPrice = priceCount > 0
    ? comp.latestPrices.reduce((s, p) => s + p.price, 0) / priceCount
    : 0;

  return (
    <Card hover>
      <CardBody>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-soft flex items-center justify-center flex-shrink-0">
              <Shield size={18} className="text-red" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-text">{comp.name}</div>
              {comp.domain && (
                <div className="flex items-center gap-1 text-[12px] text-text-2">
                  <Globe size={10} />
                  {comp.domain}
                </div>
              )}
            </div>
          </div>
          <Badge variant={comp.category === "direct" ? "red" : comp.category === "indirect" ? "orange" : "neutral"}>
            {comp.category}
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[11px] text-text-3">Продукти</div>
            <div className="text-[15px] font-semibold text-text">{priceCount}</div>
          </div>
          <div>
            <div className="text-[11px] text-text-3">Ср. цена</div>
            <div className="text-[15px] font-semibold text-text">
              {avgPrice > 0 ? `${avgPrice.toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-text-3">Реклами</div>
            <div className="text-[15px] font-semibold text-text">{adCount}</div>
          </div>
        </div>

        {/* Latest ads preview */}
        {comp.activeAds.length > 0 && (
          <div className="border-t border-border pt-2 mt-2">
            <div className="flex items-center gap-1 mb-1">
              <Megaphone size={10} className="text-text-3" />
              <span className="text-[11px] text-text-3">Последна реклама</span>
            </div>
            <p className="text-[12px] text-text-2 line-clamp-2">
              {comp.activeAds[0].ad_text}
            </p>
          </div>
        )}

        {/* Scan button */}
        {comp.domain && (
          <button
            onClick={onScan}
            disabled={scanning}
            className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium text-text-2 hover:bg-surface-2 border border-border transition-colors disabled:opacity-50"
          >
            {scanning ? (
              <><Loader2 size={14} className="animate-spin" /> Сканиране...</>
            ) : (
              <><Scan size={14} /> Сканирай продукти</>
            )}
          </button>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Price Comparison ----------

function PriceComparisonChart({ competitors }: { competitors: Competitor[] }) {
  const chartData = competitors
    .filter((c) => c.latestPrices.length > 0)
    .map((c) => ({
      name: c.name,
      avgPrice: Number((c.latestPrices.reduce((s, p) => s + p.price, 0) / c.latestPrices.length).toFixed(2)),
    }));

  if (chartData.length < 2) return null;

  return (
    <BarChartCard
      data={chartData}
      xKey="name"
      yKey="avgPrice"
      title="Сравнение на средни цени"
      height={200}
      formatValue={(v) => `${v.toFixed(2)} лв.`}
      colors={["#ff3b30", "#ff9500", "#8b5cf6", "#007aff", "#06b6d4", "#22c55e"]}
    />
  );
}

// ---------- Intel Row ----------

function IntelRow({ item }: { item: IntelItem }) {
  const SentimentIcon = item.sentiment === "positive" ? TrendingUp
    : item.sentiment === "negative" ? TrendingDown : Minus;
  const sentimentColor = item.sentiment === "positive" ? "text-accent"
    : item.sentiment === "negative" ? "text-red" : "text-text-3";

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border last:border-0">
      <SentimentIcon size={14} className={`mt-0.5 flex-shrink-0 ${sentimentColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {item.competitors?.name && (
            <Badge variant="neutral">{item.competitors.name}</Badge>
          )}
          <span className="text-[11px] text-text-3">
            {new Date(item.discovered_at).toLocaleDateString("bg-BG")}
          </span>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-medium text-text hover:text-accent transition-colors flex items-center gap-1"
        >
          {item.title}
          <ExternalLink size={10} className="flex-shrink-0" />
        </a>
        {item.summary && (
          <p className="text-[12px] text-text-2 mt-0.5 line-clamp-2">{item.summary}</p>
        )}
      </div>
    </div>
  );
}
