"use client";

import { use, useState, useMemo, useEffect, useCallback } from "react";
import useSWR, { mutate } from "swr";
import Masonry from "react-masonry-css";
import { Card, CardBody } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import { useToast } from "@/providers/ToastProvider";
import {
  Megaphone, Euro, ShoppingCart, MousePointerClick,
  Target, TrendingUp, ArrowUpDown, ChevronDown, ChevronUp,
  CreditCard, Pause, Play, X, Image as ImageIcon, Search,
  Film,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ============================================================
// Types
// ============================================================

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
  score: number; scoringStatus: "scored" | "gathering_data";
  scoreBreakdown: { hook: number; engage: number; convert: number; freshness: number };
  diagnostics: { hook: number; engage: number | null; convert: number | null; freshness: number };
  confidence: number;
  scoreMeta: { shrunkRoas: number | null; dataGate: string; conversions: number; isVideo: boolean };
  /** Tagged server-side by /api/dashboard/ads/individual after per-account fan-out. */
  integration_account_id: string | null;
}

interface AdsIndividualData {
  ads: AdItem[];
  accountAverages: { roas: number; cpa: number; ctr: number; cvr: number; frequency: number };
  error?: string;
}

interface MarketBinding {
  integrationAccountId: string;
  role: "primary" | "secondary" | "legacy";
  displayName: string;
}

interface MarketResponse {
  storeId: string;
  marketCode: string;
  storeName: string;
  bindings: MarketBinding[];
  error?: string;
}

// ============================================================
// Constants
// ============================================================

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
  today: "today", yesterday: "yesterday", "7d": "7d", "30d": "30d", "90d": "90d",
};

const FLAG_BY_MARKET: Record<string, string> = {
  bg: "🇧🇬",
  gr: "🇬🇷",
  ro: "🇷🇴",
};

// Sub-brand filter labels — keyed by binding role. Hardcoded for BG's
// topology (Cvetita primary / ProteinBar secondary / legacy archive).
// For single-binding markets (GR, RO) the filter UI is hidden entirely.
const ROLE_LABEL_BG: Record<MarketBinding["role"], string> = {
  primary: "Cvetita",
  secondary: "ProteinBar",
  legacy: "Архив",
};

// ============================================================
// Helpers
// ============================================================

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

// ============================================================
// Main Page
// ============================================================

export default function AdsMarketPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market } = use(params);
  const { toast } = useToast();
  const { preset } = useDateRange();
  const metaPreset = PRESET_MAP[preset] || "7d";

  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  /** Selected sub-brand filter key (binding.role) or "all". Only meaningful when market has >1 bindings. */
  const [subBrand, setSubBrand] = useState<"all" | MarketBinding["role"]>("all");

  const closeModal = useCallback(() => { setSelectedId(null); setPlayingVideoId(null); }, []);

  useEffect(() => {
    if (!selectedId) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeModal(); };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", handleKey); document.body.style.overflow = ""; };
  }, [selectedId, closeModal]);

  // Market metadata — used for PageHeader title, sub-brand filter labels,
  // and as a quick 404 signal when the URL segment doesn't resolve.
  const { data: marketData, error: marketError } = useSWR<MarketResponse>(
    `/api/dashboard/markets/${market}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  // Overview (KPIs)
  const overviewKey = `/api/dashboard/ads?market=${market}&preset=${metaPreset}`;
  const { data: overviewData, isLoading: ovLoading } = useSWR<{ overview: AdsOverview; error?: string }>(
    overviewKey,
    fetcher,
    { revalidateOnFocus: false }
  );

  // Ads — active first (faster), then paused as a background fetch
  const activeKey = `/api/dashboard/ads/individual?market=${market}&preset=${metaPreset}&status=ACTIVE`;
  const restKey = `/api/dashboard/ads/individual?market=${market}&preset=${metaPreset}&status=PAUSED,CAMPAIGN_PAUSED,ADSET_PAUSED`;

  const { data: activeData, isLoading: adsLoading } = useSWR<AdsIndividualData>(activeKey, fetcher, { revalidateOnFocus: false });
  const { data: restData } = useSWR<AdsIndividualData>(
    activeData ? restKey : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const adsData = useMemo((): AdsIndividualData | undefined => {
    if (!activeData) return undefined;
    if (!restData) return activeData;
    return {
      ads: [...activeData.ads, ...restData.ads],
      accountAverages: activeData.accountAverages,
    };
  }, [activeData, restData]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  // Sub-brand filter UI visibility + options derived from bindings
  const subBrandOptions = useMemo(() => {
    if (!marketData || marketData.bindings.length <= 1) return [];
    return [
      { key: "all" as const, label: "Всички", accountIds: null as string[] | null },
      ...marketData.bindings.map((b) => ({
        key: b.role,
        label: ROLE_LABEL_BG[b.role] ?? b.displayName,
        accountIds: [b.integrationAccountId],
      })),
    ];
  }, [marketData]);

  const filtered = useMemo(() => {
    if (!adsData?.ads) return [];
    let ads = adsData.ads;

    // Sub-brand filter (client-side, against server-tagged integration_account_id)
    if (subBrand !== "all" && subBrandOptions.length > 0) {
      const opt = subBrandOptions.find((o) => o.key === subBrand);
      if (opt?.accountIds) {
        const allowed = new Set(opt.accountIds);
        ads = ads.filter((a) => a.integration_account_id && allowed.has(a.integration_account_id));
      }
    }

    if (filter !== "all") ads = ads.filter((a) => a.status === filter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      ads = ads.filter((a) =>
        a.name.toLowerCase().includes(q) || a.campaignName.toLowerCase().includes(q)
      );
    }
    const dir = sortDir === "desc" ? -1 : 1;
    return [...ads].sort((a, b) => ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) * dir);
  }, [adsData?.ads, filter, searchQuery, sortKey, sortDir, subBrand, subBrandOptions]);

  const selectedAd = selectedId ? filtered.find((a) => a.id === selectedId) : null;

  const handleToggleStatus = async (adId: string, newStatus: "ACTIVE" | "PAUSED") => {
    // Find the ad across both cache entries so we can send its source account id.
    const findAd = (key: string): AdItem | undefined => {
      const cache = key === activeKey ? activeData : restData;
      return cache?.ads.find((a) => a.id === adId);
    };
    const found = findAd(activeKey) || findAd(restKey);
    const integrationAccountId = found?.integration_account_id ?? undefined;

    // Optimistic update — flip status on whichever cache holds this ad
    const optimistic = (current: AdsIndividualData | undefined) => {
      if (!current) return current;
      return { ...current, ads: current.ads.map((ad) => ad.id === adId ? { ...ad, status: newStatus } : ad) };
    };
    mutate(activeKey, optimistic, { revalidate: false });
    mutate(restKey, optimistic, { revalidate: false });
    setConfirmingId(null);

    try {
      const res = await fetch(`/api/dashboard/ads/${adId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, integrationAccountId }),
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      toast("Грешка при смяна на статуса", "error");
    }
    mutate(activeKey);
    mutate(restKey);
  };

  // 404 from /api/dashboard/markets/[market]
  if (marketError || marketData?.error) {
    return (
      <>
        <PageHeader title="Реклами" />
        <Card><CardBody>
          <div className="text-center py-12">
            <p className="text-[15px] font-medium text-text mb-2">Магазин не е намерен</p>
            <p className="text-[13px] text-text-2">Кодът „{market}“ не съответства на активен магазин.</p>
          </div>
        </CardBody></Card>
      </>
    );
  }

  if (ovLoading || !marketData) {
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
            <p className="text-[13px] text-text-2">
              Добави META_ACCESS_TOKEN и META_AD_ACCOUNT_ID в Vercel Environment Variables.
            </p>
          </div>
        </CardBody></Card>
      </>
    );
  }

  const ov = overviewData?.overview;
  const flag = FLAG_BY_MARKET[marketData.marketCode] ?? "";

  return (
    <>
      <PageHeader title={`Реклами ${flag ? "— " + flag : ""} ${marketData.storeName}`}>
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

      {/* Sub-brand filter (BG only — multi-binding markets) */}
      {subBrandOptions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-[12px] text-text-3">Суб-бранд:</span>
          {subBrandOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSubBrand(opt.key)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                subBrand === opt.key ? "bg-accent text-white" : "text-text-3 hover:text-text-2 hover:bg-surface-2 border border-border"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

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
          <span className="text-[12px] text-text-2">{filtered.length} реклами</span>
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
            <div className="text-center py-12 text-[13px] text-text-2">
              Няма реклами за избрания период
            </div>
          )}

          {selectedAd && (
            <AdModal
              ad={selectedAd}
              onClose={closeModal}
              onToggleStatus={(status) => handleToggleStatus(selectedAd.id, status)}
            />
          )}
        </>
      )}
    </>
  );
}

// ============================================================
// Ad Card
// ============================================================

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
        {isPlaying && ad.videoUrl ? (
          <video
            src={ad.videoUrl}
            controls
            autoPlay
            poster={ad.thumbnail || undefined}
            className="w-full rounded-t-xl bg-black max-h-[400px]"
          />
        ) : (
          <div className="cursor-pointer" onClick={onSelect}>
            {ad.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ad.thumbnail}
                alt=""
                className="w-full object-contain rounded-t-xl bg-surface-2 max-h-[350px]"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-full h-[160px] rounded-t-xl bg-surface-2 flex items-center justify-center">
                <ImageIcon size={32} className="text-text-3" />
              </div>
            )}
            {ad.isVideo && ad.videoUrl && (
              <>
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  onClick={(e) => { e.stopPropagation(); onPlayVideo(); }}
                >
                  <div className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center transition-transform hover:scale-110 cursor-pointer">
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
        {ad.scoringStatus === "gathering_data" ? (
          <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-surface-2/90 backdrop-blur-sm text-[11px] font-medium text-text-2 shadow-lg border border-border">
            Данни...
          </div>
        ) : (
          <div className={`absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold shadow-lg ${scoreStyle.colorClass} ${ad.confidence < 0.5 ? "border-2 border-dashed border-white/50" : ""}`}>
            {ad.score}
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="cursor-pointer" onClick={onSelect}>
          <div className="text-[13px] font-semibold text-text truncate mb-0.5">{ad.name}</div>
          <div className="text-[12px] text-text-2 truncate mb-1.5">{ad.campaignName}</div>
          <div className="flex items-center gap-2 mb-3">
            <Badge variant={st.variant}>{st.label}</Badge>
            {ad.scoringStatus === "gathering_data"
              ? <Badge variant="neutral">Данни...</Badge>
              : <Badge variant={scoreStyle.variant}>{scoreStyle.label}</Badge>
            }
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

// ============================================================
// Ad Modal
// ============================================================

function AdModal({ ad, onClose, onToggleStatus }: {
  ad: AdItem;
  onClose: () => void; onToggleStatus: (status: "ACTIVE" | "PAUSED") => void;
}) {
  const isActive = ad.status === "ACTIVE";
  const b = ad.scoreBreakdown;
  const scoreStyle = getScoreStyle(ad.score);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full h-full md:h-auto md:max-h-[90vh] md:max-w-lg md:rounded-2xl bg-surface shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-border bg-surface/95 backdrop-blur-sm">
          <div className="min-w-0 flex-1 mr-3">
            <div className="text-[15px] font-semibold text-text truncate">{ad.name}</div>
            <div className="text-[12px] text-text-2 truncate">{ad.campaignName}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-2 transition-colors flex-shrink-0">
            <X size={18} className="text-text-3" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <ModalCreative ad={ad} />

          <div className="flex gap-4">
            {ad.scoringStatus === "gathering_data" ? (
              <div className="w-16 h-16 rounded-2xl flex flex-col items-center justify-center flex-shrink-0 bg-surface-2 border-2 border-dashed border-border">
                <div className="text-[12px] font-medium text-text-2 text-center leading-tight">Данни...</div>
              </div>
            ) : (
              <div className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center flex-shrink-0 ${scoreStyle.colorClass}`}>
                <div className="text-[22px] font-bold leading-none">{ad.score}</div>
                <div className="text-[9px] font-medium opacity-80 mt-0.5">{scoreStyle.label}</div>
              </div>
            )}
            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1.5">
              <StatRow label="Spend" value={`€${fmt(ad.spend)}`} />
              <StatRow label="Revenue" value={`€${fmt(ad.revenue)}`} />
              <StatRow label="ROAS" value={ad.roas > 0 ? `${fmt(ad.roas)}x` : "—"} />
              {ad.scoreMeta?.shrunkRoas != null && <StatRow label="Adj. ROAS" value={`${fmt(ad.scoreMeta.shrunkRoas)}x`} />}
              <StatRow label="Покупки" value={fmtInt(ad.purchases)} />
              <StatRow label="CPA" value={ad.cpa > 0 ? `€${fmt(ad.cpa)}` : "—"} />
              <StatRow label="CTR" value={`${fmt(ad.ctr)}%`} />
              <StatRow label="Frequency" value={fmt(ad.frequency)} />
              <StatRow label="Confidence" value={`${Math.round(ad.confidence * 100)}%`} />
            </div>
          </div>

          <div>
            <h4 className="text-[13px] font-semibold text-text mb-2">Диагностика</h4>
            <div className="space-y-2">
              <ScoreBar label="Hook (15%)" value={b.hook} current={ad.ctr} unit="% CTR" />
              <ScoreBar label="Фуния (15%)" value={b.engage} current={ad.addToCart} unit=" ATC" />
              <ScoreBar label="Конверсия (45%)" value={b.convert} current={ad.scoreMeta?.shrunkRoas ?? ad.roas} unit="x ROAS" />
              <ScoreBar label="Свежест (25%)" value={b.freshness} current={ad.frequency} unit=" freq" />
            </div>
          </div>

          {(ad.creativeTitle || ad.creativeBody) && (
            <div>
              {ad.creativeTitle && <p className="text-[13px] font-medium text-text mb-1">{ad.creativeTitle}</p>}
              {ad.creativeBody && <p className="text-[12px] text-text-2 whitespace-pre-line line-clamp-4">{ad.creativeBody}</p>}
            </div>
          )}

          <div className="text-[12px] text-text-2 space-y-0.5">
            <div>Campaign: <span className="text-text-2">{ad.campaignName}</span></div>
            <div>Ad Set: <span className="text-text-2">{ad.adsetName}</span></div>
          </div>
        </div>

        <div className="sticky bottom-0 p-4 border-t border-border bg-surface/95 backdrop-blur-sm">
          <button
            onClick={() => onToggleStatus(isActive ? "PAUSED" : "ACTIVE")}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[14px] font-medium transition-colors ${
              isActive ? "bg-surface-2 border border-border text-text hover:bg-border" : "bg-accent text-white hover:bg-accent-hover"
            }`}
          >
            {isActive ? <><Pause size={16} /> Pause Ad</> : <><Play size={16} /> Resume Ad</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Shared sub-components (inline)
// ============================================================

function MiniKpi({ icon: Icon, label, value, highlight }: { icon: React.ElementType; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-text-3" />
        <span className="text-[13px] font-semibold text-text">{label}</span>
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
      <div className="text-[11px] text-text-2">{label}</div>
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
        <div className="text-[11px] text-text-2 mt-0.5">
          {unit === "freq" ? `Freq: ${current.toFixed(1)}` :
           inverted ? `€${current.toFixed(2)} (avg: €${avg?.toFixed(2) || "—"})` :
           `${current.toFixed(2)}${unit} (avg: ${avg?.toFixed(2) || "—"}${unit})`}
        </div>
      )}
    </div>
  );
}

function ModalCreative({ ad }: { ad: AdItem }) {
  const [videoFailed, setVideoFailed] = useState(false);

  if (ad.isVideo && ad.videoUrl && !videoFailed) {
    return (
      <video
        src={ad.videoUrl}
        controls
        autoPlay
        poster={ad.thumbnail || undefined}
        className="w-full rounded-xl bg-black aspect-video object-contain"
        onError={() => setVideoFailed(true)}
      />
    );
  }

  if (ad.isVideo && ad.thumbnail) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={ad.thumbnail} alt="" className="w-full rounded-xl bg-surface-2 max-h-[400px] object-contain" />
    );
  }

  if (ad.thumbnail) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={ad.thumbnail}
        alt=""
        className="w-full rounded-xl bg-surface-2 max-h-[400px] object-contain"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }

  return null;
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
