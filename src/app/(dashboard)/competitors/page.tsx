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
  Minus, X, Scan, Loader2, Package, ArrowDownRight,
  ArrowUpRight, AlertCircle, Megaphone, Trash2,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); });

// ---------- Types ----------

interface CompetitorPrice {
  product_name: string;
  price: number;
  currency: string;
  in_stock: boolean;
  scraped_at: string;
  product_url?: string;
}

interface Competitor {
  id: string;
  name: string;
  domain: string | null;
  facebook_page: string | null;
  category: string;
  logo_url: string | null;
  settings: { lastScanAt?: string; productUrls?: string[] } | null;
  latestPrices: CompetitorPrice[];
  activeAds: { ad_text: string; scraped_at: string }[];
}

interface AlertItem {
  id: string;
  type: string;
  title: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  competitors: { name: string } | null;
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
  const { data: alertsData } = useSWR<{ alerts: AlertItem[] }>("/api/competitors/alerts", fetcher, { revalidateOnFocus: false });
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
      const alertMsg = result.alertsGenerated > 0 ? ` | ${result.alertsGenerated} промени` : "";
      toast(`Сканирани ${result.productsExtracted} продукта${alertMsg}`, "success");
      mutate("/api/competitors");
      mutate("/api/competitors/alerts");
    } catch (err) {
      toast(`Грешка: ${err instanceof Error ? err.message : "Scan failed"}`, "error");
    } finally {
      setScanningId(null);
    }
  };

  const competitors = data?.competitors || [];
  const alerts = alertsData?.alerts || [];
  const intel = intelData?.intel || [];
  const unreadAlerts = alerts.filter((a) => !a.is_read);

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
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Име (напр. Gymbeam)" className="bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[14px] text-text outline-none focus:border-accent placeholder:text-text-3" />
              <input value={addDomain} onChange={(e) => setAddDomain(e.target.value)} placeholder="Домейн (напр. gymbeam.bg)" className="bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[14px] text-text outline-none focus:border-accent placeholder:text-text-3" />
              <input value={addFb} onChange={(e) => setAddFb(e.target.value)} placeholder="Facebook страница" className="bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[14px] text-text outline-none focus:border-accent placeholder:text-text-3" />
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
          action={<Button onClick={() => setShowAdd(true)}><Plus size={14} /> Добави конкурент</Button>}
        />
      ) : (
        <>
          {/* Alerts Feed — top of page */}
          {unreadAlerts.length > 0 && (
            <Card className="mb-6">
              <CardHeader action={<Badge variant="red">{unreadAlerts.length} нови</Badge>}>
                Промени от последния scan
              </CardHeader>
              <CardBody className="space-y-1">
                {unreadAlerts.slice(0, 10).map((alert) => (
                  <AlertRow key={alert.id} alert={alert} />
                ))}
              </CardBody>
            </Card>
          )}

          {/* No changes state */}
          {unreadAlerts.length === 0 && competitors.some((c) => c.settings?.lastScanAt) && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-surface-2 text-[13px] text-text-2">
              <AlertCircle size={14} className="text-text-3" />
              Няма нови промени. Последен scan: {formatTimeAgo(
                competitors.reduce((latest, c) => {
                  const t = c.settings?.lastScanAt;
                  return t && t > latest ? t : latest;
                }, "")
              )}
            </div>
          )}

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
          {competitors.filter((c) => c.latestPrices.length > 0).length >= 1 && (
            <BarChartCard
              data={competitors
                .filter((c) => c.latestPrices.length > 0)
                .map((c) => ({
                  name: c.name,
                  avgPrice: Number((c.latestPrices.reduce((s, p) => s + p.price, 0) / c.latestPrices.length).toFixed(2)),
                }))}
              xKey="name"
              yKey="avgPrice"
              title="Сравнение на средни цени"
              height={200}
              formatValue={(v) => `${v.toFixed(2)}`}
              colors={["#ff3b30", "#ff9500", "#8b5cf6", "#007aff", "#06b6d4"]}
              className="mb-6"
            />
          )}

          {/* Intel Feed */}
          {intel.length > 0 && (
            <Card>
              <CardHeader action={<span className="text-[12px] text-text-2">{intel.length} новини</span>}>
                Разузнаване
              </CardHeader>
              <CardBody className="space-y-3">
                {intel.slice(0, 10).map((item) => (
                  <IntelRow key={item.id} item={item} />
                ))}
              </CardBody>
            </Card>
          )}
        </>
      )}
    </>
  );
}

// ---------- Alert Row ----------

function AlertRow({ alert }: { alert: AlertItem }) {
  const data = alert.data;
  const isPrice = alert.type === "price_drop" || alert.type === "price_increase";
  const isDrop = alert.type === "price_drop";

  const iconMap: Record<string, { icon: typeof Package; color: string }> = {
    price_drop: { icon: ArrowDownRight, color: "text-red" },
    price_increase: { icon: ArrowUpRight, color: "text-orange" },
    new_product: { icon: Package, color: "text-accent" },
    url_added: { icon: Globe, color: "text-blue" },
    url_removed: { icon: Trash2, color: "text-red" },
  };
  const { icon: Icon, color: iconColor } = iconMap[alert.type] || { icon: AlertCircle, color: "text-text-3" };

  return (
    <div className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-surface-2 transition-colors">
      <Icon size={16} className={iconColor} />
      <div className="flex-1 min-w-0">
        <span className="text-[13px] text-text">{alert.title}</span>
      </div>
      {isPrice && (
        <div className="flex items-center gap-2 flex-shrink-0 text-[12px]">
          <span className="text-text-3 line-through">{Number(data.oldPrice).toFixed(2)}</span>
          <span className={isDrop ? "text-red font-semibold" : "text-orange font-semibold"}>
            {Number(data.newPrice).toFixed(2)} {String(data.currency)}
          </span>
        </div>
      )}
      <span className="text-[11px] text-text-3 flex-shrink-0">
        {formatTimeAgo(alert.created_at)}
      </span>
    </div>
  );
}

// ---------- Competitor Card (cleaned up) ----------

function CompetitorCard({ competitor: comp, scanning, onScan }: { competitor: Competitor; scanning: boolean; onScan: () => void }) {
  const prices = comp.latestPrices;
  const priceCount = prices.length;
  const inStockCount = prices.filter((p) => p.in_stock).length;
  const avgPrice = priceCount > 0 ? prices.reduce((s, p) => s + p.price, 0) / priceCount : 0;
  const minPrice = priceCount > 0 ? Math.min(...prices.map((p) => p.price)) : 0;
  const maxPrice = priceCount > 0 ? Math.max(...prices.map((p) => p.price)) : 0;
  const lastScan = comp.settings?.lastScanAt;

  return (
    <Card hover>
      <CardBody>
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-soft flex items-center justify-center flex-shrink-0">
              <Shield size={18} className="text-red" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-text">{comp.name}</div>
              {comp.domain && (
                <a href={`https://${comp.domain}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] text-text-2 hover:text-accent transition-colors">
                  <Globe size={10} />
                  {comp.domain}
                  <ExternalLink size={8} />
                </a>
              )}
            </div>
          </div>
          <Badge variant={comp.category === "direct" ? "red" : comp.category === "indirect" ? "orange" : "neutral"}>
            {comp.category}
          </Badge>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[11px] text-text-3">Продукти</div>
            <div className="text-[15px] font-semibold text-text">{priceCount}</div>
            {priceCount > 0 && (
              <div className="text-[11px] text-text-3">{inStockCount} налични</div>
            )}
          </div>
          <div>
            <div className="text-[11px] text-text-3">Ср. цена</div>
            <div className="text-[15px] font-semibold text-text">
              {avgPrice > 0 ? `${avgPrice.toFixed(2)}` : "—"}
            </div>
            {priceCount > 1 && (
              <div className="text-[11px] text-text-3">{minPrice.toFixed(0)}–{maxPrice.toFixed(0)}</div>
            )}
          </div>
          <div>
            <div className="text-[11px] text-text-3">Последен scan</div>
            <div className="text-[13px] font-medium text-text">
              {lastScan ? formatTimeAgo(lastScan) : "—"}
            </div>
          </div>
        </div>

        {/* Meta Ad Library link (real, not fake data) */}
        {comp.facebook_page && (
          <a
            href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BG&q=${encodeURIComponent(comp.name)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-text-2 hover:bg-surface-2 border border-border transition-colors mb-2"
          >
            <Megaphone size={14} />
            <span>Виж реклами в Meta Ad Library</span>
            <ExternalLink size={10} className="ml-auto" />
          </a>
        )}

        {/* Top 3 products preview */}
        {prices.length > 0 && (
          <div className="border-t border-border pt-2 mt-1 space-y-1">
            {prices.slice(0, 3).map((p, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[12px] text-text-2 truncate flex-1 mr-2">{p.product_name}</span>
                <span className="text-[12px] font-semibold text-text flex-shrink-0">
                  {p.price.toFixed(2)} {p.currency}
                </span>
              </div>
            ))}
            {prices.length > 3 && (
              <div className="text-[11px] text-text-3">+{prices.length - 3} още</div>
            )}
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

// ---------- Intel Row ----------

function IntelRow({ item }: { item: IntelItem }) {
  const SentimentIcon = item.sentiment === "positive" ? TrendingUp : item.sentiment === "negative" ? TrendingDown : Minus;
  const sentimentColor = item.sentiment === "positive" ? "text-accent" : item.sentiment === "negative" ? "text-red" : "text-text-3";

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border last:border-0">
      <SentimentIcon size={14} className={`mt-0.5 flex-shrink-0 ${sentimentColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {item.competitors?.name && <Badge variant="neutral">{item.competitors.name}</Badge>}
          <span className="text-[11px] text-text-3">{new Date(item.discovered_at).toLocaleDateString("bg-BG")}</span>
        </div>
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-text hover:text-accent transition-colors flex items-center gap-1">
          {item.title}
          <ExternalLink size={10} className="flex-shrink-0" />
        </a>
        {item.summary && <p className="text-[12px] text-text-2 mt-0.5 line-clamp-2">{item.summary}</p>}
      </div>
    </div>
  );
}

// ---------- Helpers ----------

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "току-що";
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}ч`;
  const days = Math.floor(hours / 24);
  return `${days}д`;
}
