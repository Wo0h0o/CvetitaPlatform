"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { Card, CardBody } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import {
  Euro, ShoppingCart, MousePointerClick,
  Target, TrendingUp, CreditCard, Search, ArrowUpDown,
  ChevronDown, ChevronUp, Users,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AdSet {
  id: string; name: string; campaignName: string; campaignId: string;
  status: string; spend: number; revenue: number; roas: number;
  purchases: number; cpa: number; impressions: number; clicks: number;
  cpc: number; ctr: number; frequency: number; reach: number;
  budget: string; dailyBudget: number | null; lifetimeBudget: number | null;
  optimizationGoal: string | null; createdTime: string | null;
}

interface AdSetsData {
  adsets: AdSet[];
  error?: string;
}

const STATUS_MAP: Record<string, { label: string; variant: "green" | "red" | "orange" | "neutral" }> = {
  ACTIVE: { label: "Active", variant: "green" },
  PAUSED: { label: "Paused", variant: "neutral" },
  DELETED: { label: "Deleted", variant: "red" },
  ARCHIVED: { label: "Archived", variant: "neutral" },
  CAMPAIGN_PAUSED: { label: "Camp. Paused", variant: "neutral" },
  IN_PROCESS: { label: "Processing", variant: "orange" },
  WITH_ISSUES: { label: "Issues", variant: "red" },
};

const PRESET_MAP: Record<string, string> = {
  today: "today", yesterday: "yesterday", "7d": "7d", "30d": "30d", "90d": "30d",
};

type SortKey = "spend" | "revenue" | "roas" | "purchases" | "cpa" | "ctr" | "frequency";
type FilterKey = "all" | "ACTIVE" | "PAUSED";

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("bg-BG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("bg-BG");
}

export default function AdSetsPage() {
  const { preset } = useDateRange();
  const metaPreset = PRESET_MAP[preset] || "7d";

  const { data, isLoading } = useSWR<AdSetsData>(
    `/api/dashboard/ads/adsets?preset=${metaPreset}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("all");

  const allAdSets = data?.adsets || [];

  const campaigns = useMemo(() => {
    const names = new Set(allAdSets.map((a) => a.campaignName));
    return Array.from(names).sort();
  }, [allAdSets]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = useMemo(() => {
    let adsets = allAdSets;
    if (filter !== "all") adsets = adsets.filter((a) => a.status === filter);
    if (campaignFilter !== "all") adsets = adsets.filter((a) => a.campaignName === campaignFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      adsets = adsets.filter((a) => a.name.toLowerCase().includes(q) || a.campaignName.toLowerCase().includes(q));
    }
    const dir = sortDir === "desc" ? -1 : 1;
    return [...adsets].sort((a, b) => ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) * dir);
  }, [allAdSets, filter, campaignFilter, searchQuery, sortKey, sortDir]);

  // Aggregate KPIs
  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, a) => ({
        spend: acc.spend + a.spend,
        revenue: acc.revenue + a.revenue,
        purchases: acc.purchases + a.purchases,
        clicks: acc.clicks + a.clicks,
        impressions: acc.impressions + a.impressions,
      }),
      { spend: 0, revenue: 0, purchases: 0, clicks: 0, impressions: 0 }
    );
  }, [filtered]);

  if (isLoading) {
    return (
      <>
        <PageHeader title="Ad Sets" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
      </>
    );
  }

  if (data?.error) {
    return (
      <>
        <PageHeader title="Ad Sets" />
        <Card><CardBody>
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-2xl bg-blue-soft flex items-center justify-center mx-auto mb-4">
              <Users size={24} className="text-blue" />
            </div>
            <p className="text-[15px] font-medium text-text mb-2">Meta Ads не е свързан</p>
            <p className="text-[13px] text-text-3">Добави META_ACCESS_TOKEN и META_AD_ACCOUNT_ID.</p>
          </div>
        </CardBody></Card>
      </>
    );
  }

  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
  const cpa = totals.purchases > 0 ? totals.spend / totals.purchases : 0;
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;

  return (
    <>
      <PageHeader title="Ad Sets">
        <DateRangePicker />
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <MiniKpi icon={CreditCard} label="Spend" value={`€${fmt(totals.spend)}`} />
        <MiniKpi icon={Euro} label="Revenue" value={`€${fmt(totals.revenue)}`} />
        <MiniKpi icon={TrendingUp} label="ROAS" value={`${fmt(roas)}x`} highlight={roas >= 2} />
        <MiniKpi icon={ShoppingCart} label="Покупки" value={fmtInt(totals.purchases)} />
        <MiniKpi icon={Target} label="CPA" value={`€${fmt(cpa)}`} />
        <MiniKpi icon={MousePointerClick} label="CTR" value={`${fmt(ctr)}%`} />
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-1 flex-wrap">
          {([["spend", "Spend"], ["revenue", "Revenue"], ["roas", "ROAS"], ["purchases", "Покупки"], ["cpa", "CPA"], ["ctr", "CTR"], ["frequency", "Freq"]] as [SortKey, string][]).map(([key, label]) => (
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
          <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-[12px] text-text outline-none focus:border-accent max-w-48 truncate"
          >
            <option value="all">Всички кампании</option>
            {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
          <span className="text-[12px] text-text-3">{filtered.length} ad sets</span>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardBody>
          <div className="overflow-x-auto -mx-5 px-5">
            <div className="min-w-[1100px]">
              <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-border text-[11px] font-medium uppercase tracking-wider text-text-3">
                <div className="col-span-3">Ad Set</div>
                <div className="col-span-1 text-right">Budget</div>
                <div className="col-span-1 text-right">Spend</div>
                <div className="col-span-1 text-right">Revenue</div>
                <div className="col-span-1 text-right">ROAS</div>
                <div className="col-span-1 text-right">Покупки</div>
                <div className="col-span-1 text-right">CPA</div>
                <div className="col-span-1 text-right">CTR</div>
                <div className="col-span-1 text-right">Freq</div>
              </div>
              {filtered.map((adset) => {
                const st = STATUS_MAP[adset.status] || { label: adset.status, variant: "neutral" as const };
                return (
                  <div key={adset.id} className="grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors">
                    <div className="col-span-3">
                      <div className="text-[13px] font-medium text-text truncate">{adset.name}</div>
                      <div className="text-[11px] text-text-3 truncate">{adset.campaignName}</div>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>
                    <div className="col-span-1 text-right text-[12px] text-text-2">{adset.budget}</div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">€{fmt(adset.spend)}</div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">€{fmt(adset.revenue)}</div>
                    <div className={`col-span-1 text-right text-[13px] font-semibold ${adset.roas >= 2 ? "text-accent" : adset.roas >= 1 ? "text-text" : "text-red"}`}>
                      {adset.roas > 0 ? `${fmt(adset.roas)}x` : "—"}
                    </div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">{fmtInt(adset.purchases)}</div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">{adset.cpa > 0 ? `€${fmt(adset.cpa)}` : "—"}</div>
                    <div className="col-span-1 text-right text-[13px] text-text-2">{fmt(adset.ctr)}%</div>
                    <div className={`col-span-1 text-right text-[13px] ${adset.frequency > 3 ? "text-orange font-medium" : "text-text-2"}`}>
                      {fmt(adset.frequency)}
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-center py-8 text-[13px] text-text-3">Няма данни за избрания период</div>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

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
