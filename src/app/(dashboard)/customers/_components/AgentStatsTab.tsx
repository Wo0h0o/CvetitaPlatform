"use client";

import useSWR from "swr";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { MiniKpi } from "@/components/shared/MiniKpi";
import { PhoneCall, AlertCircle, Clock, StickyNote, Users, type LucideIcon } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Agent {
  user_id: string;
  email: string | null;
  name: string;
  calls_today: number;
  calls_7d: number;
  calls_30d: number;
  notes_30d: number;
  outcomes: Record<string, number>;
  total_duration_seconds: number;
  calls_with_duration_30d: number;
  active_followups: number;
}

interface StatsResponse {
  agents: Agent[];
  totals: {
    calls_today: number;
    calls_30d: number;
    active_followups: number;
  };
  window_days: number;
}

const OUTCOME_LABEL: Record<string, string> = {
  satisfied:    "Доволен",
  unsatisfied:  "Недоволен",
  no_answer:    "Не вдига",
  declined:     "Отказва",
  wants_repeat: "Иска повторна",
  has_question: "Има въпрос",
  other:        "Друго",
};

const OUTCOME_COLOR: Record<string, string> = {
  satisfied:    "#22c55e",
  unsatisfied:  "#ef4444",
  no_answer:    "#94a3b8",
  declined:     "#f97316",
  wants_repeat: "#3b82f6",
  has_question: "#eab308",
  other:        "#a855f7",
};

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  if (seconds < 60) return `${seconds}с`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}м ${s}с` : `${m}м`;
}

function avgCallDuration(a: Agent): string {
  if (a.calls_with_duration_30d === 0) return "—";
  return formatDuration(Math.round(a.total_duration_seconds / a.calls_with_duration_30d));
}

function OutcomeBar({ outcomes, total }: { outcomes: Record<string, number>; total: number }) {
  if (total === 0) {
    return <p className="text-[12px] text-text-3">Няма обаждания за периода.</p>;
  }
  const entries = Object.entries(outcomes).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-2">
      <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-2">
        {entries.map(([key, count]) => (
          <div
            key={key}
            style={{
              width: `${(count / total) * 100}%`,
              backgroundColor: OUTCOME_COLOR[key] || "#94a3b8",
            }}
            title={`${OUTCOME_LABEL[key] || key}: ${count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([key, count]) => (
          <span
            key={key}
            className="inline-flex items-center gap-1.5 text-[12px] text-text-2"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: OUTCOME_COLOR[key] || "#94a3b8" }}
            />
            {OUTCOME_LABEL[key] || key} · <span className="tabular-nums font-medium text-text">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function AgentStatsTab() {
  const { data, error, isLoading } = useSWR<StatsResponse>("/api/agents/stats", fetcher, {
    revalidateOnFocus: false,
  });

  if (isLoading) {
    return (
      <>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 w-full rounded-xl mb-3" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </>
    );
  }

  if (error) {
    return (
      <Card><CardBody>
        <div className="text-center py-10">
          <AlertCircle size={28} className="text-red mx-auto mb-2" />
          <p className="text-[14px] text-text">Грешка при зареждане</p>
        </div>
      </CardBody></Card>
    );
  }

  const agents = data?.agents ?? [];
  const totals = data?.totals ?? { calls_today: 0, calls_30d: 0, active_followups: 0 };
  const windowDays = data?.window_days ?? 30;

  return (
    <>
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-4">
        <MiniKpi icon={PhoneCall} label="Обаждания днес" value={String(totals.calls_today)} />
        <MiniKpi icon={PhoneCall} label={`Обаждания ${windowDays}д`} value={String(totals.calls_30d)} />
        <MiniKpi icon={Clock} label="Активни follow-up" value={String(totals.active_followups)} />
      </div>

      {agents.length === 0 ? (
        <Card><CardBody>
          <div className="text-center py-12">
            <Users size={32} className="text-text-3 mx-auto mb-3" />
            <p className="text-[14px] text-text mb-1">Няма обаждания за последните {windowDays} дни.</p>
            <p className="text-[13px] text-text-2">Когато екипът започне да звъни, статистиката ще се появи тук.</p>
          </div>
        </CardBody></Card>
      ) : (
        <div className="space-y-3">
          {agents.map((a) => (
            <Card key={a.user_id}>
              <CardHeader
                action={
                  a.active_followups > 0 ? (
                    <Badge variant="orange"><Clock size={11} />{a.active_followups} follow-up</Badge>
                  ) : null
                }
              >
                <span className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-accent-soft text-accent text-[12px] font-semibold flex items-center justify-center">
                    {a.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex flex-col">
                    <span>{a.name}</span>
                    {a.email && a.email !== a.name && (
                      <span className="text-[12px] text-text-3 font-normal">{a.email}</span>
                    )}
                  </span>
                </span>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <Stat label="Днес" value={a.calls_today} />
                  <Stat label="7 дни" value={a.calls_7d} />
                  <Stat label={`${windowDays} дни`} value={a.calls_30d} />
                  <Stat label="Средно" value={avgCallDuration(a)} hint={`от ${a.calls_with_duration_30d} обаждания`} />
                  <Stat label="Бележки" value={a.notes_30d} icon={StickyNote} />
                </div>

                <div>
                  <div className="text-[12px] text-text-3 mb-1.5">Резултати</div>
                  <OutcomeBar outcomes={a.outcomes} total={a.calls_30d} />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Stat({
  label, value, hint, icon: Icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-3 flex items-center gap-1 mb-0.5">
        {Icon && <Icon size={11} />}{label}
      </div>
      <div className="text-[15px] font-medium text-text tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-text-3 mt-0.5">{hint}</div>}
    </div>
  );
}
