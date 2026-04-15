"use client";

import { use } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import { MiniKpi } from "@/components/shared/MiniKpi";
import {
  ArrowLeft,
  TrendingUp,
  Eye,
  MousePointerClick,
  Mail,
  Zap,
  Clock,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FlowMessage {
  id: string;
  name: string;
  recipients: number;
  openRate: number;
  clickRate: number;
  revenue: number;
  revenuePerRecipient: number;
  unsubscribeRate: number;
  bounceRate: number;
}

interface FlowDetailData {
  flow: {
    id: string;
    name: string;
    status: string;
    triggerType: string;
    created: string;
    updated: string;
    emailCount: number;
    delayCount: number;
  };
  totals: {
    revenue: number;
    recipients: number;
    avgOpenRate: number;
    avgClickRate: number;
  };
  messages: FlowMessage[];
  error?: string;
}

const statusVariant: Record<string, "green" | "blue" | "orange" | "neutral"> = {
  live: "green",
  draft: "neutral",
  manual: "blue",
};

export default function FlowDetailPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = use(params);
  const { queryString, label } = useDateRange();
  const { data, isLoading } = useSWR<FlowDetailData>(
    `/api/dashboard/flows/${flowId}?${queryString}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const fmt = (n: number) =>
    n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n: number) => (n * 100).toFixed(1) + "%";

  if (isLoading) {
    return (
      <>
        <PageHeader title="">
          <DateRangePicker />
        </PageHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <Card><CardBody><Skeleton className="h-48 w-full" /></CardBody></Card>
      </>
    );
  }

  if (data?.error || !data?.flow) {
    return (
      <>
        <div className="mb-6">
          <Link href="/email" className="flex items-center gap-2 text-[13px] text-text-3 hover:text-text transition-colors">
            <ArrowLeft size={16} /> Назад към Имейли
          </Link>
        </div>
        <Card>
          <CardBody>
            <div className="text-center py-16 text-text-3">Flow не е намерен</div>
          </CardBody>
        </Card>
      </>
    );
  }

  const { flow, totals, messages } = data;

  // Find best performing message
  const bestMessage = messages.length > 0
    ? messages.reduce((best, m) => m.revenue > best.revenue ? m : best, messages[0])
    : null;

  return (
    <>
      {/* Back link */}
      <div className="mb-2">
        <Link href="/email" className="flex items-center gap-2 text-[13px] text-text-3 hover:text-text transition-colors">
          <ArrowLeft size={16} /> Имейли
        </Link>
      </div>
      <PageHeader title={flow.name}>
        <DateRangePicker />
      </PageHeader>

      {/* Flow Info Bar */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex flex-wrap items-center gap-4">
            <Badge variant={statusVariant[flow.status] || "neutral"}>
              {flow.status === "live" ? "Active" : flow.status}
            </Badge>
            <div className="flex items-center gap-1.5 text-[13px] text-text-2">
              <Zap size={14} />
              <span>Trigger: {flow.triggerType}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[13px] text-text-2">
              <Mail size={14} />
              <span>{flow.emailCount} имейла</span>
            </div>
            <div className="flex items-center gap-1.5 text-[13px] text-text-2">
              <Clock size={14} />
              <span>{flow.delayCount} закъснения</span>
            </div>
            <div className="ml-auto text-[12px] text-text-2">
              Обновен: {new Date(flow.updated).toLocaleDateString("bg-BG", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MiniKpi
          icon={TrendingUp}
          label={`Revenue (${label})`}
          value={`${fmt(totals.revenue)} EUR`}
        />
        <MiniKpi
          icon={Mail}
          label="Изпратени"
          value={totals.recipients.toLocaleString("bg-BG")}
        />
        <MiniKpi
          icon={Eye}
          label="Open Rate"
          value={pct(totals.avgOpenRate)}
        />
        <MiniKpi
          icon={MousePointerClick}
          label="Click Rate"
          value={pct(totals.avgClickRate)}
        />
      </div>

      {/* Messages Performance */}
      <Card className="mb-6">
        <CardHeader
          action={<span className="text-[12px] text-text-2">{messages.length} съобщения</span>}
        >
          Имейли във Flow-a
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto -mx-5 px-5">
            <div className="min-w-[600px]">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 pb-2 mb-1 border-b border-border text-[13px] font-semibold text-text">
                <div className="col-span-1">#</div>
                <div className="col-span-3">Имейл</div>
                <div className="col-span-2 text-right">Получатели</div>
                <div className="col-span-2 text-right">Open Rate</div>
                <div className="col-span-2 text-right">Click Rate</div>
                <div className="col-span-2 text-right">Revenue</div>
              </div>

              {messages.map((m, i) => {
                const isBest = bestMessage && m.id === bestMessage.id && m.revenue > 0;
                return (
                  <div
                    key={m.id}
                    className={`grid grid-cols-12 gap-2 py-3 items-center rounded-lg px-1 transition-colors ${
                      isBest ? "bg-accent-soft" : "hover:bg-surface-2"
                    }`}
                  >
                    <div className="col-span-1 text-[12px] font-bold text-text-3">{i + 1}</div>
                    <div className="col-span-3 min-w-0">
                      <div className="text-[13px] font-medium text-text truncate">{m.name}</div>
                      <div className="flex gap-2 text-[12px] text-text-2 mt-0.5">
                        <span>Unsub: {pct(m.unsubscribeRate)}</span>
                        <span>Bounce: {pct(m.bounceRate)}</span>
                      </div>
                    </div>
                    <div className="col-span-2 text-right text-[13px] text-text-2">
                      {m.recipients.toLocaleString("bg-BG")}
                    </div>
                    <div className="col-span-2 text-right text-[13px] text-text-2">
                      {pct(m.openRate)}
                    </div>
                    <div className="col-span-2 text-right text-[13px] text-text-2">
                      {pct(m.clickRate)}
                    </div>
                    <div className="col-span-2 text-right">
                      <div className="text-[14px] font-semibold text-text">
                        {m.revenue > 0 ? `${fmt(m.revenue)} EUR` : "—"}
                      </div>
                      {m.revenue > 0 && (
                        <div className="text-[11px] text-text-2">
                          {fmt(m.revenuePerRecipient)} / получател
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {messages.length === 0 && (
                <div className="text-center py-8 text-text-3 text-[13px]">
                  Няма данни за периода
                </div>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

