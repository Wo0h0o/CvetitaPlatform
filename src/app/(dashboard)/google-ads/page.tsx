"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import {
  ComposedChart, BarChart, LineChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import {
  ArrowUpDown, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import { MiniKpi } from "@/components/shared/MiniKpi";
import { Delta, calcDeltaPct, calcDeltaPp } from "@/components/shared/Delta";
import { fetcher } from "@/lib/swr";
import { fmtMoneyShort, fmtInt, fmtPct, fmtRoas, fmtGA4Date } from "@/lib/format";
import { GlassTooltip, buildRechartsTooltip } from "@/components/charts/GlassTooltip";
import { useChartScrubber } from "@/components/charts/useChartScrubber";
import { MobileScrubber, MobileScrubberRow } from "@/components/charts/MobileScrubber";

// One build function, two consumers (§11): the Recharts hover tooltip on
// desktop, the mobile scrubber popup. Identical glass vocabulary.
function buildGaTrendPopup(row: TrendPoint) {
  return {
    header: String(row.date),
    rows: [
      { label: "Spend", value: `${Math.round(row.spend)} €` },
      { label: "ROAS", value: `${row.roas.toFixed(2)}x` },
    ],
  };
}
const trendTooltip = buildRechartsTooltip<TrendPoint>(buildGaTrendPopup);

interface TrendPoint {
  date: string;
  spend: number;
  roas: number;
}

/**
 * Daily Spend × ROAS. Desktop: combo (spend bars + ROAS line, dual axis,
 * §9.4). Mobile: collapses to a one-metric tab toggle (§9.6) — dual axes
 * are unreadable at 375px.
 */
function GoogleAdsTrend({ data }: { data: TrendPoint[] }) {
  const [metric, setMetric] = useState<"spend" | "roas">("spend");
  const axisTick = { fill: "var(--text-3)", fontSize: 11 };
  const { activeIdx, setActiveIdx, wrapperRef, pointerHandlers } = useChartScrubber({
    count: data.length,
  });
  const activeRow = activeIdx !== null ? data[activeIdx] ?? null : null;

  return (
    <Card className="mb-6">
      <CardHeader
        action={
          <div className="md:hidden flex items-center gap-0.5 bg-surface-2 rounded-lg p-0.5">
            {(["spend", "roas"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`min-h-[44px] px-3 inline-flex items-center rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  metric === m ? "bg-surface text-text shadow-sm" : "text-text-3"
                }`}
              >
                {m === "spend" ? "Spend" : "ROAS"}
              </button>
            ))}
          </div>
        }
      >
        Дневен spend и ROAS
      </CardHeader>
      <CardBody>
        {/* Desktop — full combo */}
        <div className="hidden md:block h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={20} />
              <YAxis yAxisId="spend" tick={axisTick} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `${Math.round(v)}€`} />
              <YAxis yAxisId="roas" orientation="right" tick={axisTick} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => `${v.toFixed(1)}x`} />
              <Tooltip content={trendTooltip} />
              <Bar yAxisId="spend" dataKey="spend" name="Spend" fill="var(--text-3)" radius={[2, 2, 0, 0]} />
              <Line yAxisId="roas" type="monotone" dataKey="roas" name="ROAS" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* Mobile — one metric, scrubber-driven inspection (§13) */}
        <div className="md:hidden">
          <div ref={wrapperRef} {...pointerHandlers} className="h-[220px] touch-pan-y">
            <ResponsiveContainer width="100%" height="100%">
              {metric === "spend" ? (
                <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `${Math.round(v)}€`} />
                  {activeRow && <ReferenceLine x={activeRow.date} stroke="var(--text-3)" strokeDasharray="3 3" />}
                  <Bar dataKey="spend" fill="var(--text-3)" radius={[2, 2, 0, 0]} />
                </BarChart>
              ) : (
                <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v.toFixed(1)}x`} />
                  {activeRow && <ReferenceLine x={activeRow.date} stroke="var(--text-3)" strokeDasharray="3 3" />}
                  <Line type="monotone" dataKey="roas" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
          <MobileScrubberRow
            visible={activeRow !== null}
            popup={activeRow ? <GlassTooltip {...buildGaTrendPopup(activeRow)} /> : null}
          >
            <MobileScrubber count={data.length} value={activeIdx} onChange={setActiveIdx} />
          </MobileScrubberRow>
        </div>
      </CardBody>
    </Card>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-text-3">{label}</div>
      <div className="text-[13px] text-text tabular-nums">{value}</div>
    </div>
  );
}

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

interface OverviewMetrics {
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  clicks: number;
  impressions: number;
  ctr: number;
  cpa: number;
  cpc: number;
}

interface DailyRow {
  date: string;
  spend: number;
  clicks: number;
  impressions: number;
  purchases: number;
  revenue: number;
}

interface GoogleAdsData {
  period: string;
  compare?: { from: string; to: string; label: string };
  overview: OverviewMetrics;
  previousOverview?: OverviewMetrics;
  brandSplit: { brand: Bucket; nonBrand: Bucket };
  previousBrandSplit?: { brand: Bucket; nonBrand: Bucket };
  campaigns: Campaign[];
  previousCampaigns?: Record<string, { spend: number; revenue: number; roas: number; purchases: number }>;
  dailyOverview?: DailyRow[];
  error?: string;
}

type SortKey = "spend" | "roas" | "purchases" | "ctr";
type ViewFilter = "all" | "brand" | "non-brand";

export default function GoogleAdsPage() {
  const { queryString } = useDateRange();
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

  // Sparkline data per hero KPI. Memoize so table sort/filter toggles don't
  // create fresh arrays each render and force Recharts to re-animate.
  const sparks = useMemo(() => {
    const daily = data?.dailyOverview;
    if (!daily || daily.length < 2) return null;
    return {
      spend: daily.map((d) => d.spend),
      revenue: daily.map((d) => d.revenue),
      roas: daily.map((d) => (d.spend > 0 ? d.revenue / d.spend : 0)),
      purchases: daily.map((d) => d.purchases),
      ctr: daily.map((d) => (d.impressions > 0 ? d.clicks / d.impressions : 0)),
    };
  }, [data?.dailyOverview]);

  // Daily chart data — Recharts wants typed dates (`name`) + numeric series.
  // ROAS is derived per day; we guard against div-by-zero so the line falls
  // to 0 on no-spend days rather than rendering as NaN gaps.
  const chartData = useMemo(() => {
    const daily = data?.dailyOverview;
    if (!daily) return [];
    return daily.map((d) => ({
      date: fmtGA4Date(d.date),
      spend: d.spend,
      roas: d.spend > 0 ? d.revenue / d.spend : 0,
    }));
  }, [data?.dailyOverview]);

  if (isLoading) {
    return (
      <>
        <PageHeader title="Google Ads"><DateRangePicker /></PageHeader>
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
  const prev = data?.previousOverview;
  const split = data?.brandSplit;
  const prevSplit = data?.previousBrandSplit;
  const hasVideoCampaigns = (data?.campaigns || []).some((c) => c.isVideo);

  const deltas = ov && prev
    ? {
        spend: calcDeltaPct(ov.spend, prev.spend),
        revenue: calcDeltaPct(ov.revenue, prev.revenue),
        roas: calcDeltaPct(ov.roas, prev.roas),
        purchases: calcDeltaPct(ov.purchases, prev.purchases),
        ctr: calcDeltaPp(ov.ctr, prev.ctr),
      }
    : null;

  return (
    <>
      <PageHeader title="Google Ads"><DateRangePicker /></PageHeader>

      <p className="text-[12px] text-text-2 mb-6 max-w-3xl">
        Данни от GA4 (last-click attribution). Brand vs Non-brand сплит изключва (not set) bucket-а
        — реален ROAS, не GA4 default-ният inflated.
      </p>

      {/* Hero KPI strip — design contract §3 (no icons), §4 (delta below), §7 (sparkline) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <MiniKpi
          hero
          label="Spend"
          value={fmtMoneyShort(ov?.spend || 0)}
          delta={deltas ? { pct: deltas.spend } : undefined}
          sparkData={sparks?.spend}
        />
        <MiniKpi
          hero
          label="Приход"
          value={fmtMoneyShort(ov?.revenue || 0)}
          delta={deltas ? { pct: deltas.revenue } : undefined}
          sparkData={sparks?.revenue}
        />
        <MiniKpi
          hero
          label="ROAS"
          value={fmtRoas(ov?.roas || 0)}
          delta={deltas ? { pct: deltas.roas } : undefined}
          sparkData={sparks?.roas}
        />
        <MiniKpi
          hero
          label="Покупки"
          value={fmtInt(ov?.purchases || 0)}
          delta={deltas ? { pct: deltas.purchases } : undefined}
          sparkData={sparks?.purchases}
        />
        <MiniKpi
          hero
          label="CTR"
          value={fmtPct(ov?.ctr || 0, 2)}
          delta={deltas ? { pct: deltas.ctr, unit: "pp" } : undefined}
          sparkData={sparks?.ctr}
        />
      </div>

      {/* Brand vs Non-Brand split — neutral values, delta carries the only direction signal */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {[
          { key: "brand" as const, data: split?.brand, prev: prevSplit?.brand, label: "Brand", hint: "Хора, които вече знаят Cvetita и търсят името. Високите ROAS числа са естествени — не са знак, че кампаниите 'работят'." },
          { key: "non-brand" as const, data: split?.nonBrand, prev: prevSplit?.nonBrand, label: "Non-Brand", hint: "Prospecting + retargeting от non-brand search. Тук е реалният growth signal — целта е ROAS ≥ 2x минимум." },
        ].map(({ key, data: b, prev: p, label: lab, hint }) => {
          if (!b) return null;
          const spendDelta = p ? calcDeltaPct(b.spend, p.spend) : null;
          const revenueDelta = p ? calcDeltaPct(b.revenue, p.revenue) : null;
          const roasDelta = p ? calcDeltaPct(b.roas, p.roas) : null;
          const purchasesDelta = p ? calcDeltaPct(b.purchases, p.purchases) : null;
          return (
            <Card key={key}>
              <CardHeader action={
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium text-text-2 ring-1 ring-inset ring-border tabular-nums">
                  {b.sharePct.toFixed(1)}% от spend-а
                </span>
              }>{lab}</CardHeader>
              <CardBody>
                <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                  <div>
                    <div className="text-[13px] font-semibold text-text-2 mb-1.5">Spend</div>
                    <div className="text-[22px] font-bold tracking-tight tabular-nums text-text">{fmtMoneyShort(b.spend)}</div>
                    {spendDelta !== null && <Delta pct={spendDelta} className="mt-1.5" />}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-text-2 mb-1.5">Приход</div>
                    <div className="text-[22px] font-bold tracking-tight tabular-nums text-text">{fmtMoneyShort(b.revenue)}</div>
                    {revenueDelta !== null && <Delta pct={revenueDelta} className="mt-1.5" />}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-text-2 mb-1.5">ROAS</div>
                    <div className="text-[22px] font-bold tracking-tight tabular-nums text-text">{fmtRoas(b.roas)}</div>
                    {roasDelta !== null && <Delta pct={roasDelta} className="mt-1.5" />}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-text-2 mb-1.5">Покупки</div>
                    <div className="text-[22px] font-bold tracking-tight tabular-nums text-text">{fmtInt(b.purchases)}</div>
                    {purchasesDelta !== null && <Delta pct={purchasesDelta} className="mt-1.5" />}
                  </div>
                </div>
                <p className="text-[12px] text-text-3 leading-snug mt-5 pt-4 border-t border-border">{hint}</p>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Daily Spend × ROAS — combo on desktop, one-metric toggle on mobile (§9.6) */}
      {chartData.length > 1 && <GoogleAdsTrend data={chartData} />}

      {/* Demand Gen / Video — thin status banner, not a full card. Status-state
          is the §1 exception that lets us use an off-palette ring. */}
      {hasVideoCampaigns && (
        <div className="flex items-start gap-3 px-5 py-3 mb-6 rounded-xl bg-surface ring-1 ring-inset ring-border">
          <Info size={15} className="text-text-2 flex-shrink-0 mt-0.5" />
          <div className="text-[12px] text-text-2 leading-relaxed">
            <span className="font-semibold text-text">Demand Gen / Video кампании:</span>{" "}
            измерват се с last-click attribution тук. Реалната им стойност идва от engaged-view conversions
            (различна метрика, не достъпна през GA4 Data API). Не вземай ROAS 0x за тях буквално.
          </div>
        </div>
      )}

      {/* Campaign table — neutral text, delta vs previous period carries direction */}
      <Card>
        <CardHeader action={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex items-center gap-0.5 bg-surface-2 rounded-lg p-0.5">
              {([
                ["all", "Всички"],
                ["brand", "Brand"],
                ["non-brand", "Non-Brand"],
              ] as [ViewFilter, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setView(v)}
                  className={`min-h-[44px] inline-flex items-center justify-center px-2.5 rounded-md text-[11px] font-medium transition-colors ${
                    view === v ? "bg-surface text-text shadow-sm" : "text-text-3 hover:text-text-2"
                  }`}
                >{l}</button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {([
                ["spend", "Spend"],
                ["roas", "ROAS"],
                ["purchases", "Покупки"],
                ["ctr", "CTR"],
              ] as [SortKey, string][]).map(([k, l]) => (
                <button key={k} onClick={() => toggleSort(k)}
                  className={`min-h-[44px] flex items-center gap-1 px-2 rounded-lg text-[11px] font-medium transition-colors ${
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
            <>
            <div className="hidden md:block overflow-x-auto -mx-5 px-5">
              <div className="min-w-[900px]">
                <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-border text-[12px] font-semibold text-text-2">
                  <div className="col-span-5">Кампания</div>
                  <div className="col-span-1 text-right">Spend</div>
                  <div className="col-span-1 text-right">Clicks</div>
                  <div className="col-span-1 text-right">CTR</div>
                  <div className="col-span-1 text-right">Покупки</div>
                  <div className="col-span-1 text-right">Приход</div>
                  <div className="col-span-1 text-right">CPA</div>
                  <div className="col-span-1 text-right">ROAS</div>
                </div>
                {filteredCampaigns.map((c) => {
                  const prevC = data?.previousCampaigns?.[c.name];
                  const roasDelta = prevC ? calcDeltaPct(c.roas, prevC.roas) : null;
                  return (
                    <div key={c.name} className="grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors border-b border-border last:border-b-0">
                      <div className="col-span-5 flex items-center gap-2 min-w-0">
                        <span className="text-[12px] text-text truncate" title={c.name}>{c.name}</span>
                        {c.isBrand && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-text-3 ring-1 ring-inset ring-border flex-shrink-0">
                            brand
                          </span>
                        )}
                        {c.isVideo && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-text-3 ring-1 ring-inset ring-border flex-shrink-0">
                            video
                          </span>
                        )}
                      </div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{c.spend.toFixed(0)}</div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{fmtInt(c.clicks)}</div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{(c.ctr * 100).toFixed(1)}%</div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{c.purchases}</div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{c.revenue.toFixed(0)}</div>
                      <div className="col-span-1 text-right text-[12px] text-text-2 tabular-nums">{c.cpa > 0 ? c.cpa.toFixed(0) : "—"}</div>
                      <div className="col-span-1 text-right">
                        <div className="text-[13px] font-semibold text-text tabular-nums">
                          {c.isVideo && c.roas === 0 ? "view" : fmtRoas(c.roas)}
                        </div>
                        {roasDelta !== null && !(c.isVideo && c.roas === 0) && (
                          <Delta pct={roasDelta} label="" className="text-[10px]" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mobile — card per campaign instead of a 900px-wide scroll */}
            <div className="md:hidden space-y-2">
              {filteredCampaigns.map((c) => {
                const prevC = data?.previousCampaigns?.[c.name];
                const roasDelta = prevC ? calcDeltaPct(c.roas, prevC.roas) : null;
                const roasValue = c.isVideo && c.roas === 0 ? "view" : fmtRoas(c.roas);
                return (
                  <div key={c.name} className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2 mb-2.5 min-w-0">
                      <span className="text-[13px] font-medium text-text truncate" title={c.name}>{c.name}</span>
                      {c.isBrand && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-text-3 ring-1 ring-inset ring-border flex-shrink-0">brand</span>
                      )}
                      {c.isVideo && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-text-3 ring-1 ring-inset ring-border flex-shrink-0">video</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-y-2.5 gap-x-3">
                      <MetricCell label="Spend" value={c.spend.toFixed(0)} />
                      <MetricCell label="Покупки" value={String(c.purchases)} />
                      <MetricCell label="ROAS" value={roasValue} />
                      <MetricCell label="Clicks" value={fmtInt(c.clicks)} />
                      <MetricCell label="CTR" value={`${(c.ctr * 100).toFixed(1)}%`} />
                      <MetricCell label="CPA" value={c.cpa > 0 ? c.cpa.toFixed(0) : "—"} />
                    </div>
                    {roasDelta !== null && !(c.isVideo && c.roas === 0) && (
                      <div className="mt-2.5">
                        <Delta pct={roasDelta} label="ROAS спрямо пр. период" className="text-[11px]" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
