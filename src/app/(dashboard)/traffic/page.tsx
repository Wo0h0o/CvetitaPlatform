"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { Users, MousePointerClick, Eye, ShoppingCart, Monitor, Smartphone, Tablet, ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TrafficData {
  period: string;
  overview: {
    sessions: number;
    users: number;
    engagementRate: number;
    conversions: number;
    purchases: number;
  };
  channels: { channel: string; sessions: number; users: number; engagementRate: number }[];
  topPages: { page: string; sessions: number; engagementRate: number; conversions: number }[];
  devices: { device: string; sessions: number; users: number }[];
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deviceIcons: Record<string, any> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

type PageSortKey = "sessions" | "engagementRate" | "conversions";

export default function TrafficPage() {
  const [pageSortKey, setPageSortKey] = useState<PageSortKey>("sessions");
  const [pageSortDir, setPageSortDir] = useState<"desc" | "asc">("desc");

  const { data, isLoading, error: swrError } = useSWR<TrafficData>(
    "/api/dashboard/traffic",
    fetcher,
    { revalidateOnFocus: false }
  );

  const togglePageSort = (key: PageSortKey) => {
    if (pageSortKey === key) setPageSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setPageSortKey(key); setPageSortDir("desc"); }
  };

  const sortedPages = useMemo(() => {
    if (!data?.topPages) return [];
    const dir = pageSortDir === "desc" ? -1 : 1;
    return [...data.topPages].sort((a, b) => ((a[pageSortKey] ?? 0) - (b[pageSortKey] ?? 0)) * dir);
  }, [data?.topPages, pageSortKey, pageSortDir]);

  if (isLoading) {
    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
      </>
    );
  }

  if (swrError || data?.error) {
    const isNotConfigured = data?.error === "GA4 not configured";
    return (
      <>
        <PageHeader title="Трафик & SEO">
          <DateRangePicker />
        </PageHeader>
        <Card>
          <CardBody>
            <div className="text-center py-12">
              <p className="text-[15px] font-medium text-text mb-2">
                {isNotConfigured ? "GA4 не е свързан" : "Грешка при зареждане на трафик данните"}
              </p>
              <p className="text-[13px] text-text-2">
                {isNotConfigured
                  ? "Добави GA4_CLIENT_ID, GA4_CLIENT_SECRET и GA4_REFRESH_TOKEN в Vercel Environment Variables."
                  : "Опитай отново по-късно."}
              </p>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  const ov = data?.overview;
  const totalSessions = data?.channels?.reduce((s, c) => s + c.sessions, 0) || 1;

  return (
    <>
      <PageHeader title="Трафик & SEO">
        <DateRangePicker />
      </PageHeader>

      {/* Overview KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <MiniKpi icon={Eye} label="Сесии (30д)" value={ov?.sessions?.toLocaleString("bg-BG") || "0"} />
        <MiniKpi icon={Users} label="Потребители" value={ov?.users?.toLocaleString("bg-BG") || "0"} />
        <MiniKpi icon={MousePointerClick} label="Engagement" value={`${((ov?.engagementRate || 0) * 100).toFixed(1)}%`} />
        <MiniKpi icon={ShoppingCart} label="Покупки" value={String(ov?.purchases || 0)} />
        <MiniKpi icon={ShoppingCart} label="Конверсии" value={String(ov?.conversions || 0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* Channels */}
        <Card className="lg:col-span-2">
          <CardHeader>Трафик по канали</CardHeader>
          <CardBody>
            <div className="space-y-3">
              {data?.channels?.map((ch) => {
                const pct = (ch.sessions / totalSessions) * 100;
                return (
                  <div key={ch.channel}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-medium text-text">{ch.channel}</span>
                      <span className="text-[13px] text-text-2">
                        {ch.sessions.toLocaleString("bg-BG")} сесии
                        <span className="text-text-2 ml-2">({pct.toFixed(1)}%)</span>
                      </span>
                    </div>
                    <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* Devices */}
        <Card>
          <CardHeader>Устройства</CardHeader>
          <CardBody>
            <div className="space-y-4">
              {data?.devices?.map((d) => {
                const Icon = deviceIcons[d.device] || Monitor;
                const devTotal = data?.devices?.reduce((s, x) => s + x.sessions, 0) || 1;
                const pct = (d.sessions / devTotal) * 100;
                return (
                  <div key={d.device} className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center flex-shrink-0">
                      <Icon size={18} className="text-text-2" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[13px] font-medium text-text capitalize">{d.device}</span>
                        <span className="text-[13px] font-semibold text-text">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="text-[12px] text-text-2">
                        {d.sessions.toLocaleString("bg-BG")} сесии / {d.users.toLocaleString("bg-BG")} потр.
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Top Pages */}
      <Card>
        <CardHeader action={
          <div className="flex items-center gap-1">
            {([["sessions", "Сесии"], ["engagementRate", "Engagement"], ["conversions", "Конверсии"]] as [PageSortKey, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => togglePageSort(key)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  pageSortKey === key ? "bg-surface-2 text-text border border-border" : "text-text-3 hover:text-text-2"
                }`}
              >
                {label}
                {pageSortKey === key ? (pageSortDir === "desc" ? <ChevronDown size={10} /> : <ChevronUp size={10} />) : <ArrowUpDown size={9} className="opacity-40" />}
              </button>
            ))}
          </div>
        }>Топ страници</CardHeader>
        <CardBody>
          <div className="overflow-x-auto -mx-5 px-5">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-border text-[13px] font-semibold text-text">
                <div className="col-span-1">#</div>
                <div className="col-span-6">Страница</div>
                <div className="col-span-2 text-right">Сесии</div>
                <div className="col-span-2 text-right">Engagement</div>
                <div className="col-span-1 text-right">Conv.</div>
              </div>
              {sortedPages.map((p, i) => (
                <div
                  key={p.page}
                  className="grid grid-cols-12 gap-2 py-2 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors"
                >
                  <div className="col-span-1 text-[12px] font-bold text-text-3">{i + 1}</div>
                  <div className="col-span-6 text-[13px] text-text truncate font-mono">{p.page}</div>
                  <div className="col-span-2 text-right text-[13px] text-text-2">{p.sessions.toLocaleString("bg-BG")}</div>
                  <div className="col-span-2 text-right text-[13px] text-text-2">{(p.engagementRate * 100).toFixed(1)}%</div>
                  <div className="col-span-1 text-right text-[13px] font-semibold text-text">{p.conversions}</div>
                </div>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

function MiniKpi({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-text-3" />
        <span className="text-[13px] font-semibold text-text">{label}</span>
      </div>
      <div className="text-[22px] font-bold tracking-tight text-text">{value}</div>
    </div>
  );
}
