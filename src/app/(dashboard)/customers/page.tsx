"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import {
  Users, UserPlus, Repeat, ShoppingCart, Clock, Euro,
} from "lucide-react";

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
  today: "7d", yesterday: "7d", "7d": "7d", "30d": "30d", "90d": "90d",
};

function fmt(n: number): string {
  return n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("bg-BG");
}

function retentionColor(pct: number): string {
  if (pct >= 15) return "bg-accent text-white";
  if (pct >= 10) return "bg-accent/70 text-white";
  if (pct >= 5) return "bg-accent/40 text-white";
  if (pct > 0) return "bg-accent/20 text-text";
  return "bg-surface-2 text-text-3";
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
            <p className="text-[13px] text-text-3">Проверете Shopify API конфигурацията.</p>
          </div>
        </CardBody></Card>
      </>
    );
  }

  const s = data?.summary;
  const nvr = data?.newVsReturning;
  const cohorts = data?.cohorts || [];
  const timing = data?.secondPurchaseTiming || [];
  const maxTimingCount = Math.max(...timing.map((t) => t.count), 1);

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
        {/* New vs Returning Revenue */}
        <Card>
          <CardHeader>Нови vs Връщащи се</CardHeader>
          <CardBody>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] text-text-2">Нови клиенти</span>
                  <span className="text-[13px] font-semibold text-text">{nvr?.newPct || 0}%</span>
                </div>
                <div className="h-3 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full bg-blue rounded-full transition-all" style={{ width: `${nvr?.newPct || 0}%` }} />
                </div>
                <div className="text-[11px] text-text-3 mt-0.5">€{fmt(nvr?.newRevenue || 0)}</div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] text-text-2">Връщащи се</span>
                  <span className="text-[13px] font-semibold text-accent">{nvr?.returningPct || 0}%</span>
                </div>
                <div className="h-3 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${nvr?.returningPct || 0}%` }} />
                </div>
                <div className="text-[11px] text-text-3 mt-0.5">€{fmt(nvr?.returningRevenue || 0)}</div>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Second Purchase Timing */}
        <Card className="lg:col-span-2">
          <CardHeader>Кога идва 2-рата поръчка?</CardHeader>
          <CardBody>
            {timing.length > 0 ? (
              <div className="space-y-2">
                {timing.map((t) => (
                  <div key={t.bucket} className="flex items-center gap-3">
                    <span className="text-[12px] text-text-3 w-24 flex-shrink-0">{t.bucket}</span>
                    <div className="flex-1 h-6 bg-surface-2 rounded overflow-hidden">
                      <div
                        className="h-full bg-accent rounded transition-all flex items-center px-2"
                        style={{ width: `${(t.count / maxTimingCount) * 100}%` }}
                      >
                        <span className="text-[11px] font-medium text-white">{t.count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-[13px] text-text-3">
                Все още няма достатъчно данни за втори поръчки
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Cohort Retention Table */}
      <Card>
        <CardHeader>Cohort Retention (по седмици)</CardHeader>
        <CardBody>
          {cohorts.length > 0 ? (
            <div className="overflow-x-auto -mx-5 px-5">
              <div className="min-w-[700px]">
                {/* Header */}
                <div className="flex gap-1 mb-2">
                  <div className="w-24 flex-shrink-0 text-[11px] font-medium text-text-3 uppercase">Cohort</div>
                  <div className="w-14 flex-shrink-0 text-[11px] font-medium text-text-3 uppercase text-center">Бр.</div>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((w) => (
                    <div key={w} className="w-14 flex-shrink-0 text-[11px] font-medium text-text-3 uppercase text-center">
                      W{w}
                    </div>
                  ))}
                </div>

                {/* Rows */}
                {cohorts.map((cohort) => (
                  <div key={cohort.cohortWeek} className="flex gap-1 mb-1">
                    <div className="w-24 flex-shrink-0 text-[12px] font-medium text-text truncate" title={cohort.cohortWeek}>
                      {cohort.label}
                    </div>
                    <div className="w-14 flex-shrink-0 text-[12px] text-text-2 text-center">
                      {cohort.size}
                    </div>
                    {cohort.retention.map((r) => (
                      <div
                        key={r.week}
                        className={`w-14 flex-shrink-0 rounded text-center py-1 text-[11px] font-medium ${retentionColor(r.pct)}`}
                        title={`${r.customers} от ${cohort.size} (${r.pct}%)`}
                      >
                        {r.pct > 0 ? `${r.pct}%` : "—"}
                      </div>
                    ))}
                  </div>
                ))}

                <div className="mt-3 flex items-center gap-4 text-[11px] text-text-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-accent" />
                    <span>15%+</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-accent/70" />
                    <span>10-15%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-accent/40" />
                    <span>5-10%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-accent/20" />
                    <span>1-5%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-surface-2" />
                    <span>0%</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-[13px] text-text-3">
              Все още няма достатъчно данни за cohort анализ
            </div>
          )}
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
