"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import {
  Megaphone, Euro, ShoppingCart, MousePointerClick,
  Eye, Target, TrendingUp, ArrowRight, ShoppingBag,
  CreditCard, Calendar,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ---- Types ----

interface Campaign {
  name: string; id: string; status: string; spend: number; revenue: number;
  roas: number; purchases: number; impressions: number; clicks: number;
  cpc: number; ctr: number; addToCart: number;
  createdTime: string | null; startTime: string | null;
}

type CreatedFilter = "all" | "7d" | "30d" | "90d";

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

const PRESET_MAP: Record<string, string> = {
  today: "today", "7d": "7d", "30d": "30d", "90d": "30d",
};

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("bg-BG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("bg-BG");
}

export default function CampaignsPage() {
  const { preset } = useDateRange();
  const metaPreset = PRESET_MAP[preset] || "7d";

  const { data, isLoading } = useSWR<AdsData>(
    `/api/dashboard/ads?preset=${metaPreset}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <>
        <PageHeader title="Кампании" />
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
        <PageHeader title="Кампании" />
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
  const allCampaigns = data?.campaigns || [];
  const [createdFilter, setCreatedFilter] = useState<CreatedFilter>("all");

  const campaigns = useMemo(() => {
    if (createdFilter === "all") return allCampaigns;
    const days = createdFilter === "7d" ? 7 : createdFilter === "30d" ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return allCampaigns.filter((c) => {
      if (!c.createdTime) return true;
      return new Date(c.createdTime) >= cutoff;
    });
  }, [allCampaigns, createdFilter]);

  return (
    <>
      <PageHeader title="Кампании">
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

      {/* Funnel + Stats */}
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

      {/* Created Filter + Campaigns Table */}
      <Card>
        <CardHeader action={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Calendar size={12} className="text-text-3" />
              {([["all", "Всички"], ["7d", "< 7 дни"], ["30d", "< 30 дни"], ["90d", "< 90 дни"]] as [CreatedFilter, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setCreatedFilter(key)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    createdFilter === key ? "bg-accent text-white" : "text-text-3 hover:text-text-2 hover:bg-surface-2"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[12px] text-text-3">{campaigns.length} кампании</span>
          </div>
        }>
          Кампании
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto -mx-5 px-5">
            <div className="min-w-[1000px]">
              <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-border text-[11px] font-medium uppercase tracking-wider text-text-3">
                <div className="col-span-3">Кампания</div>
                <div className="col-span-1 text-right">Създадена</div>
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
                const created = c.createdTime ? new Date(c.createdTime) : null;
                return (
                  <div key={c.id} className="grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors">
                    <div className="col-span-3">
                      <div className="text-[13px] font-medium text-text truncate">{c.name}</div>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>
                    <div className="col-span-1 text-right text-[11px] text-text-3">
                      {created ? created.toLocaleDateString("bg-BG", { day: "numeric", month: "short" }) : "—"}
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

// ---- Components ----

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
