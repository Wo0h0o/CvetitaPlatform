"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { SortButton, FilterPill, type SortDir } from "@/components/shared/SortButton";
import { useDateRange } from "@/hooks/useDateRange";
import {
  TrendingUp,
  Mail,
  MousePointerClick,
  Eye,
  Zap,
  ArrowRight,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FlowData {
  id: string;
  name: string;
  revenue: number;
  recipients: number;
  openRate: number;
  clickRate: number;
  status: string;
}

interface CampaignData {
  name: string;
  status: string;
  sendTime: string | null;
  revenue: number;
  openRate: number;
  clickRate: number;
  recipients: number;
}

interface EmailData {
  totalRevenue: number;
  campaignRevenue: number;
  flowRevenue: number;
  totalEmails: number;
  avgOpenRate: number;
  avgClickRate: number;
  activeFlows: number;
  totalFlows: number;
  topFlows: FlowData[];
  campaigns: CampaignData[];
  error?: string;
}

const statusVariant: Record<string, "green" | "blue" | "orange" | "neutral"> = {
  Sent: "green",
  Draft: "neutral",
  Scheduled: "blue",
  Sending: "orange",
  Cancelled: "neutral",
};

type CampaignFilter = "all" | "Sent" | "Draft" | "Scheduled";
type CampaignSort = "date" | "revenue" | "openRate" | "clickRate";
type FlowFilter = "active" | "all";

export default function EmailPage() {
  const { queryString, label } = useDateRange();
  const { data, isLoading } = useSWR<EmailData>(
    `/api/dashboard/email?${queryString}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");
  const [campaignSort, setCampaignSort] = useState<CampaignSort>("date");
  const [campaignSortDir, setCampaignSortDir] = useState<SortDir>("desc");
  const [flowFilter, setFlowFilter] = useState<FlowFilter>("active");
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);

  const toggleCampaignSort = (key: CampaignSort) => {
    if (campaignSort === key) {
      setCampaignSortDir(campaignSortDir === "desc" ? "asc" : "desc");
    } else {
      setCampaignSort(key);
      setCampaignSortDir("desc");
    }
  };

  const filteredCampaigns = useMemo(() => {
    if (!data?.campaigns) return [];
    let campaigns = data.campaigns;

    if (campaignFilter !== "all") {
      campaigns = campaigns.filter((c) => c.status === campaignFilter);
    }

    const mult = campaignSortDir === "desc" ? -1 : 1;
    campaigns = [...campaigns].sort((a, b) => {
      switch (campaignSort) {
        case "revenue": return (a.revenue - b.revenue) * mult;
        case "openRate": return (a.openRate - b.openRate) * mult;
        case "clickRate": return (a.clickRate - b.clickRate) * mult;
        case "date":
        default:
          return (new Date(a.sendTime || 0).getTime() - new Date(b.sendTime || 0).getTime()) * mult;
      }
    });

    return campaigns;
  }, [data?.campaigns, campaignFilter, campaignSort, campaignSortDir]);

  const visibleCampaigns = showAllCampaigns ? filteredCampaigns : filteredCampaigns.slice(0, 10);
  const totalCampaigns = filteredCampaigns.length;

  const filteredFlows = useMemo(() => {
    if (!data?.topFlows) return [];
    if (flowFilter === "active") {
      return data.topFlows.filter((f) => f.status === "live");
    }
    return data.topFlows;
  }, [data?.topFlows, flowFilter]);

  if (isLoading) {
    return (
      <>
        <PageHeader title="Имейл Маркетинг">
          <DateRangePicker />
        </PageHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2"><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
          <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
        </div>
      </>
    );
  }

  if (data?.error === "Klaviyo not configured") {
    return (
      <>
        <PageHeader title="Имейл Маркетинг" />
        <Card>
          <CardBody>
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-blue-soft flex items-center justify-center mx-auto mb-4">
                <Mail size={24} className="text-blue" />
              </div>
              <h2 className="text-[18px] font-semibold text-text mb-2">Klaviyo не е свързан</h2>
              <p className="text-[14px] text-text-2 max-w-md mx-auto mb-6">
                Добави Klaviyo Private API Key в Vercel Environment Variables.
              </p>
              <div className="bg-surface-2 rounded-xl p-4 max-w-sm mx-auto text-left">
                <ol className="text-[12px] text-text-2 space-y-1.5">
                  <li className="flex items-start gap-2">
                    <ArrowRight size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                    KLAVIYO_API_KEY (Private API Key от Klaviyo Settings)
                  </li>
                </ol>
              </div>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  const fmt = (n: number) =>
    n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n: number) => (n * 100).toFixed(1) + "%";

  return (
    <>
      <PageHeader title="Имейл Маркетинг">
        <DateRangePicker />
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MiniKpi
          icon={TrendingUp}
          label={`Email Revenue (${label})`}
          value={`${fmt(data?.totalRevenue || 0)} EUR`}
          sub={`Кампании: ${fmt(data?.campaignRevenue || 0)} | Flows: ${fmt(data?.flowRevenue || 0)}`}
        />
        <MiniKpi icon={Eye} label="Open Rate" value={pct(data?.avgOpenRate || 0)} />
        <MiniKpi icon={MousePointerClick} label="Click Rate" value={pct(data?.avgClickRate || 0)} />
        <MiniKpi
          icon={Zap}
          label="Активни Flows"
          value={`${data?.activeFlows || 0} / ${data?.totalFlows || 0}`}
          sub={`${(data?.totalEmails || 0).toLocaleString("bg-BG")} имейла изпратени`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Campaigns */}
        <Card className="lg:col-span-2">
          <CardHeader
            action={<span className="text-[12px] text-text-3">{totalCampaigns} кампании</span>}
          >
            Кампании
          </CardHeader>
          <CardBody>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-1 mb-4">
              {(
                [
                  { id: "all", label: "Всички" },
                  { id: "Sent", label: "Sent" },
                  { id: "Draft", label: "Draft" },
                  { id: "Scheduled", label: "Planned" },
                ] as { id: CampaignFilter; label: string }[]
              ).map((f) => (
                <FilterPill
                  key={f.id}
                  label={f.label}
                  value={f.id}
                  currentValue={campaignFilter}
                  onChange={(v) => { setCampaignFilter(v); setShowAllCampaigns(false); }}
                />
              ))}
            </div>

            {/* Table */}
            <div className="overflow-x-auto -mx-5 px-5">
              <div className="min-w-[500px]">
                {/* Header with sort buttons */}
                <div className="grid grid-cols-12 gap-2 pb-2 mb-1 border-b border-border">
                  <div className="col-span-5 text-[11px] font-medium uppercase tracking-wider text-text-3 flex items-center">
                    Кампания
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <SortButton label="Revenue" sortKey="revenue" currentKey={campaignSort} dir={campaignSortDir} onToggle={toggleCampaignSort} />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <SortButton label="Open" sortKey="openRate" currentKey={campaignSort} dir={campaignSortDir} onToggle={toggleCampaignSort} />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <SortButton label="Click" sortKey="clickRate" currentKey={campaignSort} dir={campaignSortDir} onToggle={toggleCampaignSort} />
                  </div>
                  <div className="col-span-1 text-[11px] font-medium uppercase tracking-wider text-text-3 text-right flex items-center justify-end">
                    Статус
                  </div>
                </div>

                {visibleCampaigns.map((c, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors"
                  >
                    <div className="col-span-5 min-w-0">
                      <div className="text-[13px] font-medium text-text truncate">{c.name}</div>
                      {c.sendTime && (
                        <div className="text-[11px] text-text-3">
                          {new Date(c.sendTime).toLocaleDateString("bg-BG", { day: "numeric", month: "short" })}
                          {" | "}
                          {c.recipients.toLocaleString("bg-BG")} получатели
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 text-right text-[13px] font-semibold text-text">
                      {c.revenue > 0 ? fmt(c.revenue) : "—"}
                    </div>
                    <div className="col-span-2 text-right text-[13px] text-text-2">
                      {c.recipients > 0 ? pct(c.openRate) : "—"}
                    </div>
                    <div className="col-span-2 text-right text-[13px] text-text-2">
                      {c.recipients > 0 ? pct(c.clickRate) : "—"}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Badge variant={statusVariant[c.status] || "neutral"}>{c.status}</Badge>
                    </div>
                  </div>
                ))}

                {visibleCampaigns.length === 0 && (
                  <div className="text-center py-8 text-text-3 text-[13px]">Няма кампании</div>
                )}
              </div>
            </div>

            {!showAllCampaigns && totalCampaigns > 10 && (
              <button
                onClick={() => setShowAllCampaigns(true)}
                className="w-full mt-3 py-2.5 rounded-lg bg-surface-2 text-text-2 text-[13px] font-medium hover:bg-border transition-colors cursor-pointer"
              >
                Покажи всички {totalCampaigns} кампании
              </button>
            )}
            {showAllCampaigns && totalCampaigns > 10 && (
              <button
                onClick={() => setShowAllCampaigns(false)}
                className="w-full mt-3 py-2.5 rounded-lg bg-surface-2 text-text-2 text-[13px] font-medium hover:bg-border transition-colors cursor-pointer"
              >
                Покажи по-малко
              </button>
            )}
          </CardBody>
        </Card>

        {/* Flows */}
        <Card>
          <CardHeader
            action={
              <div className="flex items-center gap-1">
                <FilterPill label="Active" value="active" currentValue={flowFilter} onChange={setFlowFilter} />
                <FilterPill label="Всички" value="all" currentValue={flowFilter} onChange={setFlowFilter} />
              </div>
            }
          >
            Flows по Revenue
          </CardHeader>
          <CardBody>
            <div className="space-y-1">
              {filteredFlows.map((f, i) => (
                <Link key={f.id} href={`/email/flows/${f.id}`} className="block py-3 px-2 rounded-lg hover:bg-surface-2 transition-colors cursor-pointer">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex items-center justify-center w-5 h-5 rounded-md bg-accent-soft text-accent text-[10px] font-bold flex-shrink-0">
                        {i + 1}
                      </div>
                      <span className="text-[13px] font-medium text-text truncate">{f.name}</span>
                    </div>
                    <span className="text-[13px] font-semibold text-text flex-shrink-0">
                      {fmt(f.revenue)} EUR
                    </span>
                  </div>
                  <div className="flex gap-3 ml-7 text-[11px] text-text-3">
                    <span>Open {pct(f.openRate)}</span>
                    <span>Click {pct(f.clickRate)}</span>
                    <span>{f.recipients.toLocaleString("bg-BG")} emails</span>
                  </div>
                </Link>
              ))}
              {filteredFlows.length === 0 && (
                <div className="text-center py-8 text-text-3 text-[13px]">Няма flow данни</div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function MiniKpi({
  icon: Icon, label, value, sub,
}: {
  icon: React.ElementType; label: string; value: string; sub?: string;
}) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-text-3" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-3">{label}</span>
      </div>
      <div className="text-[22px] font-bold tracking-tight text-text">{value}</div>
      {sub && <div className="text-[11px] text-text-3 mt-1">{sub}</div>}
    </div>
  );
}
