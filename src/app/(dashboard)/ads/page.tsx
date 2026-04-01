"use client";

import { useState, useMemo } from "react";
import useSWR, { mutate } from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Megaphone, Euro, ShoppingCart, MousePointerClick,
  Eye, Target, TrendingUp, ArrowRight, ShoppingBag,
  CreditCard, Pause, Play, X, ChevronDown, ChevronUp,
  ArrowUpDown, Image as ImageIcon,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ---- Types ----

interface Campaign {
  name: string; id: string; status: string; spend: number; revenue: number;
  roas: number; purchases: number; impressions: number; clicks: number;
  cpc: number; ctr: number; addToCart: number;
}

interface AdsData {
  overview: {
    spend: number; revenue: number; roas: number; purchases: number; cpa: number;
    impressions: number; clicks: number; cpc: number; cpm: number; ctr: number;
    addToCart: number; initiateCheckout: number; landingPageViews: number;
    linkClicks: number; period: { start: string; end: string };
  };
  campaigns: Campaign[];
  error?: string;
}

interface AdItem {
  id: string; name: string; campaignName: string; campaignId: string; adsetName: string;
  status: string; thumbnail: string | null; creativeTitle: string | null; creativeBody: string | null;
  spend: number; revenue: number; roas: number; purchases: number; cpa: number;
  impressions: number; clicks: number; cpc: number; cpm: number; ctr: number;
  cvr: number; frequency: number; reach: number; addToCart: number;
  score: number; scoreBreakdown: { roas: number; cpa: number; ctr: number; cvr: number; fatigue: number };
  confidence: number;
}

interface AdsIndividualData {
  ads: AdItem[];
  accountAverages: { roas: number; cpa: number; ctr: number; cvr: number; frequency: number };
  error?: string;
}

// ---- Constants ----

const PRESETS = [
  { key: "today", label: "Днес" }, { key: "yesterday", label: "Вчера" },
  { key: "7d", label: "7 дни" }, { key: "14d", label: "14 дни" },
  { key: "30d", label: "30 дни" }, { key: "this_month", label: "Този месец" },
];

const STATUS_MAP: Record<string, { label: string; variant: "green" | "red" | "orange" | "neutral" }> = {
  ACTIVE: { label: "Active", variant: "green" },
  PAUSED: { label: "Paused", variant: "neutral" },
  DELETED: { label: "Deleted", variant: "red" },
  ARCHIVED: { label: "Archived", variant: "neutral" },
  CAMPAIGN_PAUSED: { label: "Paused", variant: "neutral" },
  ADSET_PAUSED: { label: "Paused", variant: "neutral" },
  IN_PROCESS: { label: "Processing", variant: "orange" },
  WITH_ISSUES: { label: "Issues", variant: "red" },
};

const SCORE_LABELS: { min: number; label: string; variant: "green" | "blue" | "neutral" | "orange" | "red" }[] = [
  { min: 80, label: "Top", variant: "green" },
  { min: 60, label: "Good", variant: "blue" },
  { min: 40, label: "Avg", variant: "neutral" },
  { min: 20, label: "Below", variant: "orange" },
  { min: 0, label: "Poor", variant: "red" },
];

type SortKey = "score" | "spend" | "roas" | "ctr" | "purchases";
type FilterKey = "all" | "ACTIVE" | "PAUSED";

// ---- Helpers ----

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("bg-BG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("bg-BG");
}

function getScoreStyle(score: number) {
  const s = SCORE_LABELS.find((l) => score >= l.min) || SCORE_LABELS[SCORE_LABELS.length - 1];
  const colors: Record<string, string> = {
    green: "bg-accent text-white",
    blue: "bg-blue text-white",
    neutral: "bg-surface-2 text-text-2",
    orange: "bg-orange text-white",
    red: "bg-red text-white",
  };
  return { ...s, colorClass: colors[s.variant] };
}

// ---- Main Page ----

export default function AdsPage() {
  const [preset, setPreset] = useState("7d");
  const [view, setView] = useState<"campaigns" | "ads">("campaigns");

  // Campaign-level data (always fetched for KPIs)
  const { data, isLoading } = useSWR<AdsData>(
    `/api/dashboard/ads?preset=${preset}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  // Ad-level data (fetched only when ads view is active)
  const adsKey = view === "ads" ? `/api/dashboard/ads/individual?preset=${preset}` : null;
  const { data: adsData, isLoading: adsLoading } = useSWR<AdsIndividualData>(
    adsKey,
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <>
        <PageHeader title="Meta Ads" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
      </>
    );
  }

  if (data?.error === "Meta Ads not configured") {
    return (
      <>
        <PageHeader title="Meta Ads" />
        <Card><CardBody>
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-2xl bg-blue-soft flex items-center justify-center mx-auto mb-4">
              <Megaphone size={24} className="text-blue" />
            </div>
            <p className="text-[15px] font-medium text-text mb-2">Meta Ads не е свързан</p>
            <p className="text-[13px] text-text-3">
              Добави META_ACCESS_TOKEN и META_AD_ACCOUNT_ID в Vercel Environment Variables.
            </p>
          </div>
        </CardBody></Card>
      </>
    );
  }

  const ov = data?.overview;

  return (
    <>
      <PageHeader title="Meta Ads">
        <div className="flex items-center gap-1 bg-surface rounded-lg p-1 shadow-sm">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                preset === p.key ? "bg-accent text-white" : "text-text-3 hover:text-text hover:bg-surface-2"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <MiniKpi icon={CreditCard} label="Spend" value={`€${fmt(ov?.spend || 0)}`} />
        <MiniKpi icon={Euro} label="Revenue" value={`€${fmt(ov?.revenue || 0)}`} />
        <MiniKpi icon={TrendingUp} label="ROAS" value={`${fmt(ov?.roas || 0)}x`} highlight={(ov?.roas ?? 0) >= 2} />
        <MiniKpi icon={ShoppingCart} label="Покупки" value={fmtInt(ov?.purchases || 0)} />
        <MiniKpi icon={Target} label="CPA" value={`€${fmt(ov?.cpa || 0)}`} />
        <MiniKpi icon={MousePointerClick} label="CTR" value={`${fmt(ov?.ctr || 0)}%`} />
      </div>

      {/* View Toggle */}
      <div className="flex items-center gap-1 bg-surface rounded-lg p-1 shadow-sm w-fit mb-6">
        {(["campaigns", "ads"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 rounded-md text-[13px] font-medium transition-colors ${
              view === v ? "bg-accent text-white" : "text-text-3 hover:text-text hover:bg-surface-2"
            }`}
          >
            {v === "campaigns" ? "Кампании" : "Реклами"}
          </button>
        ))}
      </div>

      {/* Campaign View */}
      {view === "campaigns" && (
        <CampaignsView
          overview={ov}
          campaigns={data?.campaigns || []}
        />
      )}

      {/* Ads View */}
      {view === "ads" && (
        <AdsView
          data={adsData}
          isLoading={adsLoading}
          preset={preset}
        />
      )}
    </>
  );
}

// ---- Campaigns View (existing) ----

function CampaignsView({ overview: ov, campaigns }: { overview: AdsData["overview"] | undefined; campaigns: Campaign[] }) {
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-2">
          <CardHeader>Фуния</CardHeader>
          <CardBody>
            <div className="space-y-3">
              <FunnelStep icon={Eye} label="Impressions" value={fmtInt(ov?.impressions || 0)} />
              <FunnelArrow rate={ov?.impressions ? ((ov?.linkClicks || 0) / ov.impressions * 100) : 0} />
              <FunnelStep icon={MousePointerClick} label="Link Clicks" value={fmtInt(ov?.linkClicks || 0)} />
              <FunnelArrow rate={ov?.linkClicks ? ((ov?.landingPageViews || 0) / ov.linkClicks * 100) : 0} />
              <FunnelStep icon={Eye} label="Landing Page Views" value={fmtInt(ov?.landingPageViews || 0)} />
              <FunnelArrow rate={ov?.landingPageViews ? ((ov?.addToCart || 0) / ov.landingPageViews * 100) : 0} />
              <FunnelStep icon={ShoppingBag} label="Add to Cart" value={fmtInt(ov?.addToCart || 0)} />
              <FunnelArrow rate={ov?.addToCart ? ((ov?.initiateCheckout || 0) / ov.addToCart * 100) : 0} />
              <FunnelStep icon={CreditCard} label="Initiate Checkout" value={fmtInt(ov?.initiateCheckout || 0)} />
              <FunnelArrow rate={ov?.initiateCheckout ? ((ov?.purchases || 0) / ov.initiateCheckout * 100) : 0} />
              <FunnelStep icon={ShoppingCart} label="Purchases" value={fmtInt(ov?.purchases || 0)} highlight />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Статистики</CardHeader>
          <CardBody>
            <div className="space-y-4">
              <StatRow label="CPC (avg)" value={`€${fmt(ov?.cpc || 0)}`} />
              <StatRow label="CPM" value={`€${fmt(ov?.cpm || 0)}`} />
              <StatRow label="Clicks (total)" value={fmtInt(ov?.clicks || 0)} />
              <StatRow label="Impressions" value={fmtInt(ov?.impressions || 0)} />
              <StatRow label="Revenue / Purchase" value={`€${fmt(ov?.purchases ? (ov?.revenue || 0) / ov.purchases : 0)}`} />
              <StatRow label="Cart → Purchase" value={`${fmt(ov?.addToCart ? (ov?.purchases || 0) / ov.addToCart * 100 : 0)}%`} />
              {ov?.period?.start && (
                <div className="pt-3 border-t border-border">
                  <p className="text-[11px] text-text-3">Период: {ov.period.start} — {ov.period.end}</p>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader action={<span className="text-[12px] text-text-3">{campaigns.length} кампании</span>}>Кампании</CardHeader>
        <CardBody>
          <div className="overflow-x-auto -mx-5 px-5">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-border text-[11px] font-medium uppercase tracking-wider text-text-3">
                <div className="col-span-4">Кампания</div>
                <div className="col-span-1 text-right">Spend</div>
                <div className="col-span-1 text-right">Revenue</div>
                <div className="col-span-1 text-right">ROAS</div>
                <div className="col-span-1 text-right">Покупки</div>
                <div className="col-span-1 text-right">Clicks</div>
                <div className="col-span-1 text-right">CPC</div>
                <div className="col-span-1 text-right">CTR</div>
                <div className="col-span-1 text-right">ATC</div>
              </div>
              {campaigns.map((c) => {
                const st = STATUS_MAP[c.status] || { label: c.status, variant: "neutral" as const };
                return (
                  <div key={c.id} className="grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors">
                    <div className="col-span-4">
                      <div className="text-[13px] font-medium text-text truncate">{c.name}</div>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">€{fmt(c.spend)}</div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">€{fmt(c.revenue)}</div>
                    <div className={`col-span-1 text-right text-[13px] font-semibold ${c.roas >= 2 ? "text-accent" : c.roas >= 1 ? "text-text" : "text-red"}`}>
                      {c.roas > 0 ? `${fmt(c.roas)}x` : "—"}
                    </div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">{fmtInt(c.purchases)}</div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">{fmtInt(c.clicks)}</div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">€{fmt(c.cpc)}</div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">{fmt(c.ctr)}%</div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">{fmtInt(c.addToCart)}</div>
                  </div>
                );
              })}
              {campaigns.length === 0 && (
                <div className="text-center py-8 text-[13px] text-text-3">Няма данни за избрания период</div>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

// ---- Ads View ----

function AdsView({ data, isLoading, preset }: { data: AdsIndividualData | undefined; isLoading: boolean; preset: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = useMemo(() => {
    if (!data?.ads) return [];
    let ads = data.ads;
    if (filter !== "all") ads = ads.filter((a) => a.status === filter);
    const dir = sortDir === "desc" ? -1 : 1;
    return [...ads].sort((a, b) => ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) * dir);
  }, [data?.ads, filter, sortKey, sortDir]);

  const selectedAd = selectedId ? filtered.find((a) => a.id === selectedId) : null;

  const handleToggleStatus = async (adId: string, newStatus: "ACTIVE" | "PAUSED") => {
    const key = `/api/dashboard/ads/individual?preset=${preset}`;
    // Optimistic update
    mutate(key, (current: AdsIndividualData | undefined) => {
      if (!current) return current;
      return {
        ...current,
        ads: current.ads.map((ad) => ad.id === adId ? { ...ad, status: newStatus } : ad),
      };
    }, { revalidate: false });
    setConfirmingId(null);

    try {
      const res = await fetch(`/api/dashboard/ads/${adId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      mutate(key);
    } catch {
      mutate(key); // Revert on failure
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => <AdCardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <>
      {/* Sort & Filter */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-1">
          {([["score", "Score"], ["spend", "Spend"], ["roas", "ROAS"], ["ctr", "CTR"], ["purchases", "Покупки"]] as [SortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => toggleSort(key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                sortKey === key ? "bg-surface-2 text-text border border-border" : "text-text-3 hover:text-text-2"
              }`}
            >
              {label}
              {sortKey === key ? (sortDir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />) : <ArrowUpDown size={10} className="opacity-40" />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {([["all", "Всички"], ["ACTIVE", "Active"], ["PAUSED", "Paused"]] as [FilterKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                filter === key ? "bg-accent text-white" : "text-text-3 hover:text-text-2 hover:bg-surface-2"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="text-[12px] text-text-3 ml-2">{filtered.length} реклами</span>
        </div>
      </div>

      {/* Ad Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((ad) => (
          <AdCard
            key={ad.id}
            ad={ad}
            isSelected={selectedId === ad.id}
            isConfirming={confirmingId === ad.id}
            onSelect={() => setSelectedId(selectedId === ad.id ? null : ad.id)}
            onConfirmStart={() => setConfirmingId(ad.id)}
            onConfirmCancel={() => setConfirmingId(null)}
            onToggleStatus={(status) => handleToggleStatus(ad.id, status)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-12 text-[13px] text-text-3">
            Няма реклами за избрания период
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedAd && (
        <div className="mt-4">
          <AdDetailPanel
            ad={selectedAd}
            averages={data?.accountAverages}
            onClose={() => setSelectedId(null)}
            onToggleStatus={(status) => handleToggleStatus(selectedAd.id, status)}
          />
        </div>
      )}
    </>
  );
}

// ---- Ad Card ----

function AdCard({ ad, isSelected, isConfirming, onSelect, onConfirmStart, onConfirmCancel, onToggleStatus }: {
  ad: AdItem; isSelected: boolean; isConfirming: boolean;
  onSelect: () => void; onConfirmStart: () => void; onConfirmCancel: () => void;
  onToggleStatus: (status: "ACTIVE" | "PAUSED") => void;
}) {
  const scoreStyle = getScoreStyle(ad.score);
  const st = STATUS_MAP[ad.status] || { label: ad.status, variant: "neutral" as const };
  const isActive = ad.status === "ACTIVE";

  return (
    <Card hover className={isSelected ? "ring-2 ring-accent" : ""}>
      {/* Thumbnail + Score Badge */}
      <div className="relative cursor-pointer" onClick={onSelect}>
        {ad.thumbnail ? (
          <img
            src={ad.thumbnail}
            alt=""
            className="w-full aspect-video object-cover rounded-t-xl bg-surface-2"
          />
        ) : (
          <div className="w-full aspect-video rounded-t-xl bg-surface-2 flex items-center justify-center">
            <ImageIcon size={32} className="text-text-3" />
          </div>
        )}
        {/* Score Badge */}
        <div className={`absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold shadow-lg ${scoreStyle.colorClass} ${ad.confidence < 0.5 ? "border-2 border-dashed border-white/50" : ""}`}>
          {ad.score}
        </div>
      </div>

      <div className="p-4">
        {/* Name + Status */}
        <div className="cursor-pointer" onClick={onSelect}>
          <div className="text-[13px] font-semibold text-text truncate mb-0.5">{ad.name}</div>
          <div className="text-[11px] text-text-3 truncate mb-1.5">{ad.campaignName}</div>
          <div className="flex items-center gap-2 mb-3">
            <Badge variant={st.variant}>{st.label}</Badge>
            <Badge variant={scoreStyle.variant}>{scoreStyle.label}</Badge>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-x-3 gap-y-2 mb-3">
          <MetricCell label="Spend" value={`€${fmt(ad.spend)}`} />
          <MetricCell label="Revenue" value={`€${fmt(ad.revenue)}`} />
          <MetricCell label="ROAS" value={ad.roas > 0 ? `${fmt(ad.roas)}x` : "—"} highlight={ad.roas >= 2} bad={ad.roas > 0 && ad.roas < 1} />
          <MetricCell label="CTR" value={`${fmt(ad.ctr)}%`} />
          <MetricCell label="CPA" value={ad.cpa > 0 ? `€${fmt(ad.cpa)}` : "—"} />
          <MetricCell label="Покупки" value={fmtInt(ad.purchases)} />
        </div>

        {/* Action Button */}
        {isConfirming ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-2">Сигурен?</span>
            <button
              onClick={() => onToggleStatus(isActive ? "PAUSED" : "ACTIVE")}
              className="flex-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              Да
            </button>
            <button
              onClick={onConfirmCancel}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-3 hover:bg-surface-2 transition-colors"
            >
              Не
            </button>
          </div>
        ) : (
          <button
            onClick={onConfirmStart}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-2 hover:bg-surface-2 transition-colors"
          >
            {isActive ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Resume</>}
          </button>
        )}
      </div>
    </Card>
  );
}

// ---- Detail Panel ----

function AdDetailPanel({ ad, averages, onClose, onToggleStatus }: {
  ad: AdItem;
  averages: AdsIndividualData["accountAverages"] | undefined;
  onClose: () => void;
  onToggleStatus: (status: "ACTIVE" | "PAUSED") => void;
}) {
  const isActive = ad.status === "ACTIVE";
  const breakdown = ad.scoreBreakdown;

  return (
    <Card>
      <CardHeader action={
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-2 transition-colors">
          <X size={16} className="text-text-3" />
        </button>
      }>
        {ad.name}
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Score Breakdown */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-[22px] font-bold ${getScoreStyle(ad.score).colorClass}`}>
                {ad.score}
              </div>
              <div>
                <div className="text-[15px] font-semibold text-text">Performance Score</div>
                <div className="text-[12px] text-text-3">Confidence: {Math.round(ad.confidence * 100)}%</div>
              </div>
            </div>
            <div className="space-y-3">
              <ScoreBar label="ROAS (35%)" value={breakdown.roas} avg={averages?.roas} current={ad.roas} unit="x" />
              <ScoreBar label="CPA (25%)" value={breakdown.cpa} avg={averages?.cpa} current={ad.cpa} unit="€" inverted />
              <ScoreBar label="CTR (15%)" value={breakdown.ctr} avg={averages?.ctr} current={ad.ctr} unit="%" />
              <ScoreBar label="CVR (15%)" value={breakdown.cvr} avg={averages?.cvr} current={ad.cvr} unit="%" />
              <ScoreBar label="Fatigue (10%)" value={breakdown.fatigue} current={ad.frequency} unit="freq" />
            </div>
          </div>

          {/* Full Metrics */}
          <div>
            <h4 className="text-[13px] font-semibold text-text mb-3">Метрики</h4>
            <div className="space-y-2.5">
              <StatRow label="Spend" value={`€${fmt(ad.spend)}`} />
              <StatRow label="Revenue" value={`€${fmt(ad.revenue)}`} />
              <StatRow label="ROAS" value={ad.roas > 0 ? `${fmt(ad.roas)}x` : "—"} />
              <StatRow label="Purchases" value={fmtInt(ad.purchases)} />
              <StatRow label="CPA" value={ad.cpa > 0 ? `€${fmt(ad.cpa)}` : "—"} />
              <StatRow label="Impressions" value={fmtInt(ad.impressions)} />
              <StatRow label="Reach" value={fmtInt(ad.reach)} />
              <StatRow label="Clicks" value={fmtInt(ad.clicks)} />
              <StatRow label="CTR" value={`${fmt(ad.ctr)}%`} />
              <StatRow label="CPC" value={`€${fmt(ad.cpc)}`} />
              <StatRow label="CPM" value={`€${fmt(ad.cpm)}`} />
              <StatRow label="Frequency" value={fmt(ad.frequency)} />
              <StatRow label="Add to Cart" value={fmtInt(ad.addToCart)} />
            </div>
          </div>

          {/* Creative + Actions */}
          <div>
            <h4 className="text-[13px] font-semibold text-text mb-3">Creative</h4>
            {ad.thumbnail && (
              <img src={ad.thumbnail} alt="" className="w-full rounded-lg mb-3 bg-surface-2" />
            )}
            {ad.creativeTitle && (
              <div className="mb-2">
                <span className="text-[11px] text-text-3 uppercase tracking-wider">Заглавие</span>
                <p className="text-[13px] text-text">{ad.creativeTitle}</p>
              </div>
            )}
            {ad.creativeBody && (
              <div className="mb-4">
                <span className="text-[11px] text-text-3 uppercase tracking-wider">Текст</span>
                <p className="text-[12px] text-text-2 whitespace-pre-line line-clamp-6">{ad.creativeBody}</p>
              </div>
            )}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px] text-text-3">Campaign:</span>
              <span className="text-[12px] text-text">{ad.campaignName}</span>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[12px] text-text-3">Ad Set:</span>
              <span className="text-[12px] text-text">{ad.adsetName}</span>
            </div>
            <button
              onClick={() => onToggleStatus(isActive ? "PAUSED" : "ACTIVE")}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                isActive
                  ? "bg-surface border border-border text-text hover:bg-surface-2"
                  : "bg-accent text-white hover:bg-accent-hover"
              }`}
            >
              {isActive ? <><Pause size={14} /> Pause Ad</> : <><Play size={14} /> Resume Ad</>}
            </button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ---- Shared Components ----

function MiniKpi({ icon: Icon, label, value, highlight }: {
  icon: React.ElementType; label: string; value: string; highlight?: boolean;
}) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-text-3" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-3">{label}</span>
      </div>
      <div className={`text-[22px] font-bold tracking-tight ${highlight ? "text-accent" : "text-text"}`}>{value}</div>
    </div>
  );
}

function FunnelStep({ icon: Icon, label, value, highlight }: {
  icon: React.ElementType; label: string; value: string; highlight?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg ${highlight ? "bg-accent-soft" : "bg-surface-2"}`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${highlight ? "bg-accent text-white" : "bg-surface"}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 flex items-center justify-between">
        <span className="text-[13px] font-medium text-text">{label}</span>
        <span className={`text-[15px] font-bold ${highlight ? "text-accent" : "text-text"}`}>{value}</span>
      </div>
    </div>
  );
}

function FunnelArrow({ rate }: { rate: number }) {
  return (
    <div className="flex items-center justify-center gap-2 py-0.5">
      <ArrowRight size={14} className="text-text-3 rotate-90" />
      <span className="text-[11px] font-medium text-text-3">{rate.toFixed(1)}%</span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-text-2">{label}</span>
      <span className="text-[13px] font-semibold text-text">{value}</span>
    </div>
  );
}

function MetricCell({ label, value, highlight, bad }: {
  label: string; value: string; highlight?: boolean; bad?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] text-text-3 uppercase tracking-wider">{label}</div>
      <div className={`text-[13px] font-semibold ${highlight ? "text-accent" : bad ? "text-red" : "text-text"}`}>{value}</div>
    </div>
  );
}

function ScoreBar({ label, value, avg, current, unit, inverted }: {
  label: string; value: number; avg?: number; current?: number; unit: string; inverted?: boolean;
}) {
  const barColor = value >= 70 ? "bg-accent" : value >= 40 ? "bg-blue" : "bg-red";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-text-2">{label}</span>
        <span className="text-[11px] font-medium text-text">{value}/100</span>
      </div>
      <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${value}%` }} />
      </div>
      {current !== undefined && (
        <div className="text-[10px] text-text-3 mt-0.5">
          {unit === "freq" ? `Freq: ${current.toFixed(1)}` :
           inverted ? `€${current.toFixed(2)} (avg: €${avg?.toFixed(2) || "—"})` :
           `${current.toFixed(2)}${unit} (avg: ${avg?.toFixed(2) || "—"}${unit})`}
        </div>
      )}
    </div>
  );
}

function AdCardSkeleton() {
  return (
    <div className="bg-surface rounded-xl shadow-sm overflow-hidden">
      <Skeleton className="w-full aspect-video rounded-none" />
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="grid grid-cols-3 gap-2 pt-2">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-8" />)}
        </div>
      </div>
    </div>
  );
}
