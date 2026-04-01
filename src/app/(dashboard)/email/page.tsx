"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { Users, Zap, Mail, ArrowRight, Send } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface EmailData {
  totalSubscribers: number;
  activeFlows: number;
  totalFlows: number;
  recentCampaigns: { name: string; status: string; sendTime: string }[];
  error?: string;
}

const statusVariant: Record<string, "green" | "blue" | "orange" | "neutral"> = {
  sent: "green",
  draft: "neutral",
  scheduled: "blue",
  sending: "orange",
  cancelled: "red" as "neutral",
};

const statusLabel: Record<string, string> = {
  sent: "Изпратена",
  draft: "Чернова",
  scheduled: "Планирана",
  sending: "Изпраща се",
  cancelled: "Отменена",
};

export default function EmailPage() {
  const { data, isLoading } = useSWR<EmailData>(
    "/api/dashboard/email",
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <Card><CardBody><Skeleton className="h-48 w-full" /></CardBody></Card>
      </>
    );
  }

  if (data?.error === "Klaviyo not configured") {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-blue-soft flex items-center justify-center mx-auto mb-4">
              <Mail size={24} className="text-blue" />
            </div>
            <h2 className="text-[18px] font-semibold text-text mb-2">Klaviyo не е свързан</h2>
            <p className="text-[14px] text-text-2 max-w-md mx-auto mb-6">
              Добави Klaviyo credentials в Vercel Environment Variables.
            </p>
            <div className="bg-surface-2 rounded-xl p-4 max-w-sm mx-auto text-left">
              <ol className="text-[12px] text-text-2 space-y-1.5">
                <li className="flex items-start gap-2">
                  <ArrowRight size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                  KLAVIYO_CLIENT_ID
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                  KLAVIYO_CLIENT_SECRET
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                  KLAVIYO_REFRESH_TOKEN
                </li>
              </ol>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Имейл Маркетинг">
        <DateRangePicker />
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <MiniKpi icon={Users} label="Абонати" value={data?.totalSubscribers?.toLocaleString("bg-BG") || "0"} />
        <MiniKpi icon={Zap} label="Активни Flows" value={`${data?.activeFlows || 0} / ${data?.totalFlows || 0}`} />
        <MiniKpi icon={Send} label="Последни кампании" value={String(data?.recentCampaigns?.length || 0)} />
      </div>

      {/* Recent Campaigns */}
      <Card>
        <CardHeader>Последни кампании</CardHeader>
        <CardBody>
          {data?.recentCampaigns && data.recentCampaigns.length > 0 ? (
            <div className="space-y-1">
              {data.recentCampaigns.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-surface-2 transition-colors"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-soft flex-shrink-0">
                    <Mail size={16} className="text-blue" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-text truncate">
                      {c.name}
                    </div>
                    {c.sendTime && (
                      <div className="text-[11px] text-text-3">
                        {new Date(c.sendTime).toLocaleDateString("bg-BG", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    )}
                  </div>
                  <Badge variant={statusVariant[c.status] || "neutral"}>
                    {statusLabel[c.status] || c.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-text-3 text-[13px]">
              Няма скорошни кампании
            </div>
          )}
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
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-3">{label}</span>
      </div>
      <div className="text-[22px] font-bold tracking-tight text-text">{value}</div>
    </div>
  );
}
