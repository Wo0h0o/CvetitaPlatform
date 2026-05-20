"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import {
  Card, CardHeader, CardBody,
} from "@/components/shared/Card";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import {
  Search, DollarSign, TrendingUp, ShoppingCart, MousePointerClick, Eye,
  ArrowUpDown, ChevronDown, ChevronUp, Video, Crown, Sparkles, Info,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import { MiniKpi } from "@/components/shared/MiniKpi";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Bucket {
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  clicks: number;
  impressions: number;
  sharePct: number;
}

interface Campaign {
  name: string;
  spend: number;
  clicks: number;
  impressions: number;
  purchases: number;
  revenue: number;
  roas: number;
  ctr: number;
  cpa: number;
  cpc: number;
  isBrand: boolean;
  isVideo: boolean;
}

interface GoogleAdsData {
  period: string;
  overview: {
    spend: number; revenue: number; roas: number; purchases: number;
    clicks: number; impressions: number; ctr: number; cpa: number; cpc: number;
  };
  brandSplit: { brand: Bucket; nonBrand: Bucket };
  campaigns: Campaign[];
  error?: string;
}

type SortKey = "spend" | "roas" | "purchases" | "ctr";
type ViewFilter = "all" | "brand" | "non-brand";

const fmtMoney = (n: number) => n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR";
const fmtInt = (n: number) => Math.round(n).toLocaleString("bg-BG");
const fmtPct = (n: number, digits = 1) => (n * 100).toFixed(digits) + "%";
const fmtRoas = (n: number) => n.toFixed(2) + "x";

// Tier colors for ROAS. Brand-search-intercept and pure-prospecting
// have different healthy bands, but a global threshold is a good first
// pass; the brand/non-brand split below also fixes the mental model.
function roasTier(roas: number, isVideo: boolean): "good" | "watch" | "poor" | "view-through" {
  if (isVideo && roas === 0) return "view-through";
  if (roas >= 2.5) return "good";
  if (roas >= 1) return "watch";
  return "poor";
}
const TIER_STYLES: Record<ReturnType<typeof roasTier>, string> = {
  good: "text-emerald-600 dark:text-emerald-400 font-semibold",
  watch: "text-amber-600 dark:text-amber-400 font-medium",
  poor: "text-red-600 dark:text-red-400 font-semibold",
  "view-through": "text-text-3 italic",
};

export default function GoogleAdsPage() {
  const { queryString, label } = useDateRange();
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [view, setView] = useState<ViewFilter>("all");

  const { data, isLoading, error: swrError } = useSWR<GoogleAdsData>(
    `/api/dashboard/google-ads?${queryString}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filteredCampaigns = useMemo(() => {
    if (!data?.campaigns) return [];
    let list = data.campaigns;
    if (view === "brand") list = list.filter((c) => c.isBrand);
    if (view === "non-brand") list = list.filter((c) => !c.isBrand);
    const dir = sortDir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) * dir);
  }, [data?.campaigns, view, sortKey, sortDir]);

  if (isLoading) {
    return (
      <>
        <PageHeader title="Google Ads"><DateRangePicker /></PageHeader>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
      </>
    );
  }

  if (swrError || data?.error) {
    const isNotConfigured = data?.error === "GA4 not configured";
    return (
      <>
        <PageHeader title="Google Ads"><DateRangePicker /></PageHeader>
        <Card>
          <CardBody>
            <div className="text-center py-12">
              <p className="text-[15px] font-medium text-text mb-2">
                {isNotConfigured ? "GA4 не е свързан" : "Грешка при зареждане на Google Ads данните"}
              </p>
              <p className="text-[13px] text-text-2">
                {isNotConfigured
                  ? "Добави GA4_CLIENT_ID, GA4_CLIENT_SECRET и GA4_REFRESH_TOKEN в Vercel Environment Variables."
                  : "Опитай отново по-късно или провери дали GA4 property-то е свързано с Google Ads (GA4 admin → Product Links → Google Ads)."}
              </p>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  const ov = data?.overview;
  const split = data?.brandSplit;
  const hasVideoCampaigns = (data?.campaigns || []).some((c) => c.isVideo);

  return (
    <>
      <PageHeader title="Google Ads"><DateRangePicker /></PageHeader>

      <p className="text-[12px] text-text-2 mb-4">
        Данни от GA4 (last-click attribution). Brand vs Non-brand сплит изключва (not set) bucket-а
        — реален ROAS, не GA4 default-ният inflated.
      </p>

      {/* Overview KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <MiniKpi icon={DollarSign} label={`Spend (${label})`} value={fmtMoney(ov?.spend || 0)} />
        <MiniKpi icon={TrendingUp} label="Revenue" value={fmtMoney(ov?.revenue || 0)} />
        <MiniKpi icon={Sparkles} label="ROAS" value={fmtRoas(ov?.roas || 0)} />
        <MiniKpi icon={ShoppingCart} label="Покупки" value={fmtInt(ov?.purchases || 0)} />
        <MiniKpi icon={MousePointerClick} label="Clicks" value={fmtInt(ov?.clicks || 0)} />
        <MiniKpi icon={Eye} label="CTR" value={fmtPct(ov?.ctr || 0, 2)} />
      </div>

      {/* Brand vs Non-Brand split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {[
          { key: "brand" as const, data: split?.brand, label: "Brand", icon: Crown, hint: "Хора, които вече знаят Cvetita и търсят името. Високите ROAS числа са естествени — не са знак, че campaign-ите 'работят'." },
          { key: "non-brand" as const, data: split?.nonBrand, label: "Non-Brand", icon: Search, hint: "Prospecting + retargeting от non-brand search. Тук е реалният growth signal — целта е ROAS ≥ 2x минимум." },
        ].map(({ key, data: b, label: lab, icon: Icon, hint }) => {
          if (!b) return null;
          const tier = b.roas >= 2.5 ? "good" : b.roas >= 1 ? "watch" : "poor";
          return (
            <Card key={key}>
              <CardHeader action={
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                  tier === "good" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : tier === "watch" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                }`}>
                  {b.sharePct.toFixed(0)}% от spend-а
                </span>
              }>
                <div className="flex items-center gap-2">
                  <Icon size={16} className="text-text-2" />
                  <span>{lab}</span>
                </div>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-text-3 mb-0.5">Spend</div>
                    <div className="text-[14px] font-semibold text-text">{fmtMoney(b.spend)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-text-3 mb-0.5">Revenue</div>
                    <div className="text-[14px] font-semibold text-text">{fmtMoney(b.revenue)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-text-3 mb-0.5">ROAS</div>
                    <div className={`text-[16px] ${TIER_STYLES[tier]}`}>{fmtRoas(b.roas)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-text-3 mb-0.5">Покупки</div>
                    <div className="text-[14px] font-semibold text-text">{fmtInt(b.purchases)}</div>
                  </div>
                </div>
                <p className="text-[11px] text-text-3 leading-snug mt-3 pt-3 border-t border-border">{hint}</p>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Video-attribution warning callout */}
      {hasVideoCampaigns && (
        <Card className="mb-4">
          <CardBody>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <Info size={16} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-text mb-1">Demand Gen / Video кампании</div>
                <p className="text-[12px] text-text-2 leading-relaxed">
                  Видео кампаниите се измерват с last-click attribution тук. Реалната им стойност идва от
                  engaged-view conversions (различна метрика, не е достъпна през GA4 Data API). Не вземай
                  ROAS 0x за тях буквално — само ги маркирай за отделна оценка през Google Ads UI.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Campaign table */}
      <Card>
        <CardHeader action={
          <div className="flex items-center gap-2">
            {/* View filter */}
            <div className="flex items-center gap-0.5 bg-surface-2 rounded-lg p-0.5">
              {([
                ["all", "Всички"],
                ["brand", "Brand"],
                ["non-brand", "Non-Brand"],
              ] as [ViewFilter, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    view === v ? "bg-surface text-text shadow-sm" : "text-text-3 hover:text-text-2"
                  }`}
                >{l}</button>
              ))}
            </div>
            {/* Sort buttons */}
            <div className="flex items-center gap-1">
              {([
                ["spend", "Spend"],
                ["roas", "ROAS"],
                ["purchases", "Покупки"],
                ["ctr", "CTR"],
              ] as [SortKey, string][]).map(([k, l]) => (
                <button key={k} onClick={() => toggleSort(k)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                    sortKey === k ? "bg-surface-2 text-text border border-border" : "text-text-3 hover:text-text-2"
                  }`}
                >
                  {l}
                  {sortKey === k ? (sortDir === "desc" ? <ChevronDown size={10} /> : <ChevronUp size={10} />) : <ArrowUpDown size={9} className="opacity-40" />}
                </button>
              ))}
            </div>
          </div>
        }>Кампании ({filteredCampaigns.length})</CardHeader>
        <CardBody>
          {filteredCampaigns.length === 0 ? (
            <p className="text-center py-8 text-[13px] text-text-2">Няма кампании за този филтър</p>
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <div className="min-w-[900px]">
                <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-border text-[12px] font-semibold text-text-2">
                  <div className="col-span-5">Кампания</div>
                  <div className="col-span-1 text-right">Spend</div>
                  <div className="col-span-1 text-right">Clicks</div>
                  <div className="col-span-1 text-right">CTR</div>
                  <div className="col-span-1 text-right">Покупки</div>
                  <div className="col-span-1 text-right">Revenue</div>
                  <div className="col-span-1 text-right">CPA</div>
                  <div className="col-span-1 text-right">ROAS</div>
                </div>
                {filteredCampaigns.map((c) => {
                  const tier = roasTier(c.roas, c.isVideo);
                  return (
                    <div key={c.name} className="grid grid-cols-12 gap-2 py-2 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors">
                      <div className="col-span-5 flex items-center gap-1.5 min-w-0">
                        {c.isBrand && <Crown size={11} className="text-amber-500 flex-shrink-0" />}
                        {c.isVideo && <Video size={11} className="text-purple-500 flex-shrink-0" />}
                        <span className="text-[12px] text-text truncate" title={c.name}>{c.name}</span>
                      </div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{c.spend.toFixed(0)}</div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{fmtInt(c.clicks)}</div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{(c.ctr * 100).toFixed(1)}%</div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{c.purchases}</div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{c.revenue.toFixed(0)}</div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{c.cpa > 0 ? c.cpa.toFixed(0) : "—"}</div>
                      <div className={`col-span-1 text-right text-[12px] tabular-nums ${TIER_STYLES[tier]}`}>
                        {tier === "view-through" ? "view" : fmtRoas(c.roas)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
