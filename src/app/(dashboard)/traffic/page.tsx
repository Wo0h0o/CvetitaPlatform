"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import { DonutChart, FunnelChart, type FunnelStep } from "@/components/charts";
import { MiniKpi } from "@/components/shared/MiniKpi";
import { calcDeltaPct, calcDeltaPp, Delta } from "@/components/shared/Delta";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface OverviewMetrics {
  sessions: number;
  users: number;
  engagementRate: number;
  conversions: number;
  purchases: number;
}

interface TrafficData {
  period: string;
  compare?: { from: string; to: string; label: string };
  overview: OverviewMetrics;
  previousOverview?: OverviewMetrics;
  channels: { channel: string; sessions: number; users: number; engagementRate: number }[];
  topPages: { page: string; sessions: number; engagementRate: number; conversions: number }[];
  devices: { device: string; sessions: number; users: number }[];
  funnel?: Record<string, number>;
  previousFunnel?: Record<string, number>;
  topEvents?: { name: string; count: number; users: number }[];
  previousTopEvents?: Record<string, number>;
  error?: string;
}

// Display order + БГ labels for the standard GA4 e-commerce funnel.
// Keeping these here (not in the API response) means the UI controls
// presentation and the API stays a clean data layer.
const FUNNEL_DISPLAY: { name: string; label: string }[] = [
  { name: "view_item", label: "Преглед на продукт" },
  { name: "add_to_cart", label: "Добавяне в количка" },
  { name: "begin_checkout", label: "Започнат checkout" },
  { name: "purchase", label: "Покупка" },
];

type PageSortKey = "sessions" | "engagementRate" | "conversions";

// Single accent for the dominant slice, neutral greys for the rest —
// design contract §1: categories never get their own accent color.
const DEVICE_PALETTE = ["#22c55e", "#aeaeb2", "#d1d1d6"];

export default function TrafficPage() {
  const { queryString } = useDateRange();
  const [pageSortKey, setPageSortKey] = useState<PageSortKey>("sessions");
  const [pageSortDir, setPageSortDir] = useState<"desc" | "asc">("desc");

  const { data, isLoading, error: swrError } = useSWR<TrafficData>(
    `/api/dashboard/traffic?${queryString}`,
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
        <PageHeader title="Трафик & SEO">
          <DateRangePicker />
        </PageHeader>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {[1, 2, 3, 4, 5].map((i) => <KpiSkeleton key={i} />)}
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
  const prev = data?.previousOverview;
  const totalSessions = data?.channels?.reduce((s, c) => s + c.sessions, 0) || 1;

  // Deltas live in the page, not the API — keeps the response a flat shape
  // that agent-context.ts can still treat as plain numbers (see contract §8).
  const deltas = prev
    ? {
        sessions: calcDeltaPct(ov?.sessions ?? 0, prev.sessions),
        users: calcDeltaPct(ov?.users ?? 0, prev.users),
        engagementRate: calcDeltaPp(ov?.engagementRate ?? 0, prev.engagementRate),
        purchases: calcDeltaPct(ov?.purchases ?? 0, prev.purchases),
        conversions: calcDeltaPct(ov?.conversions ?? 0, prev.conversions),
      }
    : null;

  // Funnel steps: keep display order fixed even if GA4 returns events in
  // a different sequence. Missing events show 0 (FunnelChart handles
  // the all-zero empty state with a setup hint).
  const funnelMap = data?.funnel || {};
  const prevFunnelMap = data?.previousFunnel || {};
  const funnelSteps: FunnelStep[] = FUNNEL_DISPLAY.map((f) => ({
    name: f.name,
    label: f.label,
    count: funnelMap[f.name] ?? 0,
    deltaPct: data?.previousFunnel ? calcDeltaPct(funnelMap[f.name] ?? 0, prevFunnelMap[f.name] ?? 0) : null,
  }));
  const firstStep = funnelSteps[0]?.count ?? 0;
  const lastStep = funnelSteps[funnelSteps.length - 1]?.count ?? 0;
  const overallConv = firstStep > 0 ? (lastStep / firstStep) * 100 : 0;
  const prevFirst = prevFunnelMap[FUNNEL_DISPLAY[0].name] ?? 0;
  const prevLast = prevFunnelMap[FUNNEL_DISPLAY[FUNNEL_DISPLAY.length - 1].name] ?? 0;
  const prevConv = prevFirst > 0 ? (prevLast / prevFirst) * 100 : 0;
  const overallConvDelta = data?.previousFunnel && prevFirst > 0
    ? overallConv - prevConv
    : null;

  return (
    <>
      <PageHeader title="Трафик & SEO">
        <DateRangePicker />
      </PageHeader>

      {/* Overview KPIs — hero layout, no icons, with delta (contract §3, §4) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <MiniKpi
          hero
          label="Сесии"
          value={ov?.sessions?.toLocaleString("bg-BG") || "0"}
          delta={deltas ? { pct: deltas.sessions } : undefined}
        />
        <MiniKpi
          hero
          label="Потребители"
          value={ov?.users?.toLocaleString("bg-BG") || "0"}
          delta={deltas ? { pct: deltas.users } : undefined}
        />
        <MiniKpi
          hero
          label="Engagement"
          value={`${((ov?.engagementRate || 0) * 100).toFixed(1)}%`}
          delta={deltas ? { pct: deltas.engagementRate, unit: "pp" } : undefined}
        />
        <MiniKpi
          hero
          label="Покупки"
          value={String(ov?.purchases || 0)}
          delta={deltas ? { pct: deltas.purchases } : undefined}
        />
        <MiniKpi
          hero
          label="Конверсии"
          value={String(ov?.conversions || 0)}
          delta={deltas ? { pct: deltas.conversions } : undefined}
        />
      </div>

      {/* Funnel + Events — е-commerce поведение преди channel split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>Покупка фуния</CardHeader>
          <CardBody>
            <FunnelChart
              steps={funnelSteps}
              overallConversionPct={overallConv}
              overallConversionDelta={overallConvDelta}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Топ събития</CardHeader>
          <CardBody>
            {data?.topEvents && data.topEvents.length > 0 ? (
              <div className="space-y-2.5">
                {data.topEvents.slice(0, 8).map((ev) => {
                  const prev = data.previousTopEvents?.[ev.name];
                  const deltaPct = data.previousTopEvents !== undefined && prev !== undefined
                    ? calcDeltaPct(ev.count, prev)
                    : null;
                  return (
                    <div key={ev.name} className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-text truncate font-mono">{ev.name}</div>
                        {deltaPct !== null && (
                          <Delta pct={deltaPct} label="" className="mt-0.5" />
                        )}
                      </div>
                      <div className="text-[13px] text-text-2 tabular-nums whitespace-nowrap">
                        {ev.count.toLocaleString("bg-BG")}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-8 text-[13px] text-text-2">Няма данни за събития</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Channels — neutral bars (share, not growth) per contract §1 */}
        <Card className="lg:col-span-2">
          <CardHeader>Канали</CardHeader>
          <CardBody>
            <div className="space-y-3">
              {data?.channels && data.channels.length > 0 ? data.channels.map((ch, idx) => {
                const pct = (ch.sessions / totalSessions) * 100;
                const isTop = idx === 0;
                return (
                  <div key={ch.channel}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[13px] font-medium text-text">{ch.channel}</span>
                      <span className="text-[13px] text-text-2 tabular-nums">
                        {ch.sessions.toLocaleString("bg-BG")}
                        <span className="text-text-3 ml-2">{pct.toFixed(1)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isTop ? "bg-accent" : "bg-text-3"}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              }) : (
                <p className="text-center py-8 text-[13px] text-text-2">Няма данни за избрания период</p>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Devices — single-accent donut per contract §1 */}
        <DonutChart
          data={(data?.devices || []).map((d) => ({ device: d.device.charAt(0).toUpperCase() + d.device.slice(1), sessions: d.sessions }))}
          nameKey="device"
          valueKey="sessions"
          title="Устройства"
          height={220}
          colors={DEVICE_PALETTE}
          formatValue={(v) => `${v.toLocaleString("bg-BG")} сесии`}
        />
      </div>

      {/* Top Pages — drill-down density per contract §5 */}
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
              {sortedPages.length > 0 ? sortedPages.map((p, i) => (
                <div
                  key={p.page}
                  className="grid grid-cols-12 gap-2 py-2 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors"
                >
                  <div className="col-span-1 text-[12px] font-bold text-text-3 tabular-nums">{i + 1}</div>
                  <div className="col-span-6 text-[13px] text-text truncate font-mono">{p.page}</div>
                  <div className="col-span-2 text-right text-[13px] text-text-2 tabular-nums">{p.sessions.toLocaleString("bg-BG")}</div>
                  <div className="col-span-2 text-right text-[13px] text-text-2 tabular-nums">{(p.engagementRate * 100).toFixed(1)}%</div>
                  <div className="col-span-1 text-right text-[13px] font-semibold text-text tabular-nums">{p.conversions}</div>
                </div>
              )) : (
                <p className="text-center py-8 text-[13px] text-text-2">Няма данни за страници</p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
