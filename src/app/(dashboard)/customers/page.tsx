"use client";

import useSWR from "swr";
import { Card, CardBody } from "@/components/shared/Card";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import {
  Users, UserPlus, Repeat, ShoppingCart, Clock, Euro,
} from "lucide-react";
import { DonutChart, BarChartCard, HeatmapGrid } from "@/components/charts";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CohortRow {
  cohortWeek: string;
  label: string;
  size: number;
  retention: { week: number; customers: number; pct: number }[];
}

interface CustomersData {
  summary: {
    totalCustomers: number; newCustomers: number; returningCustomers: number;
    repeatPurchaseRate: number; avgOrdersPerCustomer: number;
    avgTimeTo2ndPurchase: number | null; revenuePerCustomer: number;
  };
  newVsReturning: { newRevenue: number; returningRevenue: number; newPct: number; returningPct: number };
  cohorts: CohortRow[];
  secondPurchaseTiming: { bucket: string; count: number }[];
  error?: string;
}

const PRESET_MAP: Record<string, string> = {
  today: "today", yesterday: "yesterday", "7d": "7d", "30d": "30d", "90d": "90d",
};

function fmt(n: number): string {
  return n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("bg-BG");
}


export default function CustomersPage() {
  const { preset } = useDateRange();
  const customerPreset = PRESET_MAP[preset] || "90d";

  const { data, isLoading, error: swrError } = useSWR<CustomersData>(
    `/api/dashboard/customers?preset=${customerPreset}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <>
        <PageHeader title="Клиенти" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
      </>
    );
  }

  if (swrError || data?.error) {
    return (
      <>
        <PageHeader title="Клиенти" />
        <Card><CardBody>
          <div className="text-center py-12">
            <Users size={32} className="text-text-3 mx-auto mb-3" />
            <p className="text-[14px] text-text mb-1">Грешка при зареждане</p>
            <p className="text-[13px] text-text-2">Проверете Shopify API конфигурацията.</p>
          </div>
        </CardBody></Card>
      </>
    );
  }

  const s = data?.summary;
  const nvr = data?.newVsReturning;
  const cohorts = data?.cohorts || [];
  const timing = data?.secondPurchaseTiming || [];

  return (
    <>
      <PageHeader title="Клиенти">
        <DateRangePicker />
      </PageHeader>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <MiniKpi icon={Users} label="Клиенти" value={fmtInt(s?.totalCustomers || 0)} />
        <MiniKpi icon={UserPlus} label="Нови" value={fmtInt(s?.newCustomers || 0)} />
        <MiniKpi icon={Repeat} label="Repeat Rate" value={`${s?.repeatPurchaseRate || 0}%`} highlight={(s?.repeatPurchaseRate || 0) >= 20} />
        <MiniKpi icon={ShoppingCart} label="Поръчки/клиент" value={`${s?.avgOrdersPerCustomer || 0}`} />
        <MiniKpi icon={Clock} label="До 2-ра поръчка" value={s?.avgTimeTo2ndPurchase ? `${s.avgTimeTo2ndPurchase} дни` : "—"} />
        <MiniKpi icon={Euro} label="Приход/клиент" value={`€${fmt(s?.revenuePerCustomer || 0)}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* New vs Returning Revenue — Donut */}
        <DonutChart
          data={nvr ? [
            { segment: "Нови", revenue: nvr.newRevenue },
            { segment: "Връщащи се", revenue: nvr.returningRevenue },
          ] : []}
          nameKey="segment"
          valueKey="revenue"
          title="Нови vs Връщащи се"
          height={220}
          colors={["#007aff", "#22c55e"]}
          formatValue={(v) => `€${fmt(v)}`}
        />

        {/* Second Purchase Timing — Bar Chart */}
        <BarChartCard
          data={timing}
          xKey="bucket"
          yKey="count"
          title="Кога идва 2-рата поръчка?"
          height={220}
          className="lg:col-span-2"
          formatValue={(v) => `${v} клиенти`}
        />
      </div>

      {/* Cohort Retention — HeatmapGrid */}
      <HeatmapGrid
        title="Cohort Retention (по седмици)"
        columnLabels={["Бр.", ...Array.from({ length: 8 }, (_, i) => `W${i + 1}`)]}
        rows={cohorts.map((cohort) => ({
          label: cohort.label,
          cells: [
            { value: cohort.size, label: String(cohort.size) },
            ...cohort.retention.map((r) => ({ value: r.pct })),
          ],
        }))}
        formatCell={(v) => `${v.toFixed(0)}%`}
      />
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
        <span className="text-[13px] font-semibold text-text">{label}</span>
      </div>
      <div className={`text-[22px] font-bold tracking-tight ${highlight ? "text-accent" : "text-text"}`}>{value}</div>
    </div>
  );
}
