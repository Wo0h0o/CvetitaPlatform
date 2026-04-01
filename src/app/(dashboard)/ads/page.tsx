"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import useSWR, { mutate } from "swr";
import Masonry from "react-masonry-css";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import {
  Megaphone, Euro, ShoppingCart, MousePointerClick,
  Target, TrendingUp, ArrowUpDown, ChevronDown, ChevronUp,
  CreditCard, Pause, Play, X, Image as ImageIcon, Search,
  Film,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ---- Types ----

interface AdsOverview {
  spend: number; revenue: number; roas: number; purchases: number; cpa: number;
  impressions: number; clicks: number; cpc: number; cpm: number; ctr: number;
  addToCart: number; initiateCheckout: number; landingPageViews: number;
  linkClicks: number; period: { start: string; end: string };
}

interface AdItem {
  id: string; name: string; campaignName: string; campaignId: string; adsetName: string;
  status: string; thumbnail: string | null; videoUrl: string | null; isVideo: boolean;
  creativeTitle: string | null; creativeBody: string | null;
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

const PRESET_MAP: Record<string, string> = {
  today: "today", "7d": "7d", "30d": "30d", "90d": "30d",
};

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
  const { preset } = useDateRange();
  const metaPreset = PRESET_MAP[preset] || "7d";

  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedId]);

  // KPI overview
  const { data: overviewData, isLoading: ovLoading } = useSWR<{ overview: AdsOverview; error?: string }>(
    `/api/dashboard/ads?preset=${metaPreset}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  // Individual ads
  const { data: adsData, isLoading: adsLoading } = useSWR<AdsIndividualData>(
    `/api/dashboard/ads/individual?preset=${metaPreset}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = useMemo(() => {
    if (!adsData?.ads) return [];
    let ads = adsData.ads;
    if (filter !== "all") ads = ads.filter((a) => a.status === filter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      ads = ads.filter((a) =>
        a.name.toLowerCase().includes(q) || a.campaignName.toLowerCase().includes(q)
      );
    }
    const dir = sortDir === "desc" ? -1 : 1;
    return [...ads].sort((a, b) => ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) * dir);
  }, [adsData?.ads, filter, searchQuery, sortKey, sortDir]);

  const selectedAd = selectedId ? filtered.find((a) => a.id === selectedId) : null;

  const handleToggleStatus = async (adId: string, newStatus: "ACTIVE" | "PAUSED") => {
    const key = `/api/dashboard/ads/individual?preset=${metaPreset}`;
    mutate(key, (current: AdsIndividualData | undefined) => {
      if (!current) return current;
      return { ...current, ads: current.ads.map((ad) => ad.id === adId ? { ...ad, status: newStatus } : ad) };
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
      mutate(key);
    }
  };

  if (ovLoading) {
    return (
      <>
        <PageHeader title="Реклами" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <AdCardSkeleton key={i} />)}
        </div>
      </>
    );
  }

  if (overviewData?.error === "Meta Ads not configured") {
    return (
      <>
        <PageHeader title="Реклами" />
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

  const ov = overviewData?.overview;

  return (
    <>
      <PageHeader title="Реклами">
        <DateRangePicker />
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

      {/* Sort, Filter & Search */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-1 flex-wrap">
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
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Търси..."
              className="pl-8 pr-3 py-1.5 rounded-lg bg-surface-2 border border-border text-[12px] text-text outline-none focus:border-accent w-36 md:w-48"
            />
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
          </div>
          <span className="text-[12px] text-text-3">{filtered.length} реклами</span>
        </div>
      </div>

      {/* Ad Cards */}
      {adsLoading ? (
        <Masonry breakpointCols={{ default: 3, 1024: 2, 640: 1 }} className="flex gap-4 -ml-4" columnClassName="pl-4 space-y-4">
          {[1, 2, 3, 4, 5, 6].map((i) => <AdCardSkeleton key={i} />)}
        </Masonry>
      ) : (
        <>
          {filtered.length > 0 ? (
            <Masonry
              breakpointCols={{ default: 3, 1024: 2, 640: 1 }}
              className="flex gap-4 -ml-4"
              columnClassName="pl-4 space-y-4"
            >
              {filtered.map((ad) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  isSelected={selectedId === ad.id}
                  isConfirming={confirmingId === ad.id}
                  isPlaying={playingVideoId === ad.id}
                  onSelect={() => setSelectedId(selectedId === ad.id ? null : ad.id)}
                  onPlayVideo={() => setPlayingVideoId(playingVideoId === ad.id ? null : ad.id)}
                  onConfirmStart={() => setConfirmingId(ad.id)}
                  onConfirmCancel={() => setConfirmingId(null)}
                  onToggleStatus={(status) => handleToggleStatus(ad.id, status)}
                />
              ))}
            </Masonry>
          ) : (
            <div className="text-center py-12 text-[13px] text-text-3">
              Няма реклами за избрания период
            </div>
          )}

          {selectedAd && (
            <div className="mt-4" ref={detailRef}>
              <AdDetailPanel
                ad={selectedAd}
                averages={adsData?.accountAverages}
                onClose={() => setSelectedId(null)}
                onToggleStatus={(status) => handleToggleStatus(selectedAd.id, status)}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}

// ---- Ad Card ----

function AdCard({ ad, isSelected, isConfirming, isPlaying, onSelect, onPlayVideo, onConfirmStart, onConfirmCancel, onToggleStatus }: {
  ad: AdItem; isSelected: boolean; isConfirming: boolean; isPlaying: boolean;
  onSelect: () => void; onPlayVideo: () => void; onConfirmStart: () => void; onConfirmCancel: () => void;
  onToggleStatus: (status: "ACTIVE" | "PAUSED") => void;
}) {
  const scoreStyle = getScoreStyle(ad.score);
  const st = STATUS_MAP[ad.status] || { label: ad.status, variant: "neutral" as const };
  const isActive = ad.status === "ACTIVE";

  return (
    <Card hover className={isSelected ? "ring-2 ring-accent" : ""}>
      <div className="relative">
        {/* Inline video player */}
        {isPlaying && ad.videoUrl ? (
          <video
            src={ad.videoUrl}
            controls
            autoPlay
            poster={ad.thumbnail || undefined}
            className="w-full rounded-t-xl bg-black max-h-[400px]"
          />
        ) : (
          <div className="cursor-pointer" onClick={ad.isVideo && ad.videoUrl ? onPlayVideo : onSelect}>
            {ad.thumbnail ? (
              <img src={ad.thumbnail} alt="" className="w-full object-contain rounded-t-xl bg-surface-2 max-h-[300px]" />
            ) : (
              <div className="w-full h-[160px] rounded-t-xl bg-surface-2 flex items-center justify-center">
                <ImageIcon size={32} className="text-text-3" />
              </div>
            )}
            {ad.isVideo && ad.videoUrl && (
              <>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center transition-transform hover:scale-110">
                    <Play size={24} className="text-white ml-1" fill="white" />
                  </div>
                </div>
                <div className="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/60 text-[10px] font-medium text-white flex items-center gap-1">
                  <Film size={10} /> Video
                </div>
              </>
            )}
          </div>
        )}
        <div className={`absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold shadow-lg ${scoreStyle.colorClass} ${ad.confidence < 0.5 ? "border-2 border-dashed border-white/50" : ""}`}>
          {ad.score}
        </div>
      </div>
      <div className="p-4">
        <div className="cursor-pointer" onClick={onSelect}>
          <div className="text-[13px] font-semibold text-text truncate mb-0.5">{ad.name}</div>
          <div className="text-[11px] text-text-3 truncate mb-1.5">{ad.campaignName}</div>
          <div className="flex items-center gap-2 mb-3">
            <Badge variant={st.variant}>{st.label}</Badge>
            <Badge variant={scoreStyle.variant}>{scoreStyle.label}</Badge>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-x-3 gap-y-2 mb-3">
          <MetricCell label="Spend" value={`€${fmt(ad.spend)}`} />
          <MetricCell label="Revenue" value={`€${fmt(ad.revenue)}`} />
          <MetricCell label="ROAS" value={ad.roas > 0 ? `${fmt(ad.roas)}x` : "—"} highlight={ad.roas >= 2} bad={ad.roas > 0 && ad.roas < 1} />
          <MetricCell label="CTR" value={`${fmt(ad.ctr)}%`} />
          <MetricCell label="CPA" value={ad.cpa > 0 ? `€${fmt(ad.cpa)}` : "—"} />
          <MetricCell label="Покупки" value={fmtInt(ad.purchases)} />
        </div>
        {isConfirming ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-2">Сигурен?</span>
            <button onClick={() => onToggleStatus(isActive ? "PAUSED" : "ACTIVE")} className="flex-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent-hover transition-colors">Да</button>
            <button onClick={onConfirmCancel} className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-3 hover:bg-surface-2 transition-colors">Не</button>
          </div>
        ) : (
          <button onClick={onConfirmStart} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-2 hover:bg-surface-2 transition-colors">
            {isActive ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Resume</>}
          </button>
        )}
      </div>
    </Card>
  );
}

// ---- Detail Panel ----

function AdDetailPanel({ ad, averages, onClose, onToggleStatus }: {
  ad: AdItem; averages: AdsIndividualData["accountAverages"] | undefined;
  onClose: () => void; onToggleStatus: (status: "ACTIVE" | "PAUSED") => void;
}) {
  const isActive = ad.status === "ACTIVE";
  const b = ad.scoreBreakdown;

  return (
    <Card>
      <CardHeader action={<button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-2 transition-colors"><X size={16} className="text-text-3" /></button>}>
        {ad.name}
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-[22px] font-bold ${getScoreStyle(ad.score).colorClass}`}>{ad.score}</div>
              <div>
                <div className="text-[15px] font-semibold text-text">Performance Score</div>
                <div className="text-[12px] text-text-3">Confidence: {Math.round(ad.confidence * 100)}%</div>
              </div>
            </div>
            <div className="space-y-3">
              <ScoreBar label="ROAS (35%)" value={b.roas} avg={averages?.roas} current={ad.roas} unit="x" />
              <ScoreBar label="CPA (25%)" value={b.cpa} avg={averages?.cpa} current={ad.cpa} unit="€" inverted />
              <ScoreBar label="CTR (15%)" value={b.ctr} avg={averages?.ctr} current={ad.ctr} unit="%" />
              <ScoreBar label="CVR (15%)" value={b.cvr} avg={averages?.cvr} current={ad.cvr} unit="%" />
              <ScoreBar label="Fatigue (10%)" value={b.fatigue} current={ad.frequency} unit="freq" />
            </div>
          </div>
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
          <div>
            <h4 className="text-[13px] font-semibold text-text mb-3">Creative</h4>
            {ad.videoUrl ? (
              <video
                src={ad.videoUrl}
                controls
                poster={ad.thumbnail || undefined}
                className="w-full rounded-lg mb-3 bg-black max-h-[400px]"
                preload="metadata"
              />
            ) : ad.thumbnail ? (
              <img src={ad.thumbnail} alt="" className="w-full rounded-lg mb-3 bg-surface-2" />
            ) : null}
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
                isActive ? "bg-surface border border-border text-text hover:bg-surface-2" : "bg-accent text-white hover:bg-accent-hover"
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

function MiniKpi({ icon: Icon, label, value, highlight }: { icon: React.ElementType; label: string; value: string; highlight?: boolean }) {
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

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-text-2">{label}</span>
      <span className="text-[13px] font-semibold text-text">{value}</span>
    </div>
  );
}

function MetricCell({ label, value, highlight, bad }: { label: string; value: string; highlight?: boolean; bad?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-text-3 uppercase tracking-wider">{label}</div>
      <div className={`text-[13px] font-semibold ${highlight ? "text-accent" : bad ? "text-red" : "text-text"}`}>{value}</div>
    </div>
  );
}

function ScoreBar({ label, value, avg, current, unit, inverted }: { label: string; value: number; avg?: number; current?: number; unit: string; inverted?: boolean }) {
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
