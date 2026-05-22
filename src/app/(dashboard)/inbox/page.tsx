"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { CheckCircle2, X, Clock, Inbox as InboxIcon, TrendingDown, TrendingUp, Minus, AlertTriangle, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { MarketFlag } from "@/components/shared/MarketFlag";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ============================================================
// Types — mirror /api/inbox response shape
// ============================================================

type Severity = "red" | "amber" | "green" | "info";
type Status = "pending" | "actioned" | "dismissed" | "acknowledged";
type OutcomeStatus =
  | "pending"
  | "measuring"
  | "succeeded"
  | "failed"
  | "inconclusive"
  | "na";

interface InboxCard {
  id: string;
  source_agent: string | null;
  for_date: string;
  severity: Severity;
  title: string;
  why: string;
  target_type: string;
  target_id: string;
  target_name: string | null;
  actions: string[];
  status: Status;
  snoozed_until: string | null;
  outcome_status: OutcomeStatus | null;
  outcome_metric: string | null;
  outcome_baseline_value: number | string | null;
  outcome_current_value: number | string | null;
  outcome_revisit_at: string | null;
  outcome_summary: string | null;
  outcome_evaluated_at: string | null;
  actioned_at: string | null;
  created_at: string;
  stores: { market_code: string; name: string } | null;
}

interface InboxResponse {
  cards: InboxCard[];
  total: number;
}

// ============================================================
// Visuals
// ============================================================

const SEVERITY_ORDER: Record<Severity, number> = {
  red: 0,
  amber: 1,
  green: 2,
  info: 3,
};

const SEVERITY_STYLE: Record<Severity, { border: string; pill: string; label: string }> = {
  red: { border: "border-l-red-500", pill: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", label: "Спешно" },
  amber: { border: "border-l-amber-500", pill: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", label: "Внимание" },
  green: { border: "border-l-emerald-500", pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", label: "Възможност" },
  info: { border: "border-l-slate-400", pill: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", label: "Инфо" },
};

const SOURCE_LABEL: Record<string, string> = {
  "watcher-roas-drop": "Сигнал · ROAS",
  "ads-intel": "AI Стратег",
  "morning-report": "Сутрешен доклад",
};

// ============================================================
// Helpers
// ============================================================

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "току що";
  if (min < 60) return `преди ${min} мин`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `преди ${hr} ч`;
  const d = Math.round(hr / 24);
  return `преди ${d} д`;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Maps an inbox card's target to the page where the operator can act on it.
 * `target_type` values written into agent_briefs today:
 *   market | product | ad | adset | campaign.
 * Returns null when no route can be resolved — the card then stays
 * inspect-only rather than offering a dead link.
 */
function targetHref(card: InboxCard): string | null {
  const market = card.stores?.market_code ?? null;
  switch (card.target_type) {
    case "market": {
      // watcher-roas-drop writes target_id = market_code
      const m = card.target_id || market;
      return m ? `/ads/${m}` : null;
    }
    case "product":
      // agent-briefs cron writes target_id = product handle
      return card.target_id ? `/products/${card.target_id}` : "/products";
    case "ad":
      // /ads/[market] auto-opens the ad modal on ?focus=<adId>
      return market ? `/ads/${market}?focus=${card.target_id}` : null;
    case "adset":
    case "campaign":
      // No focus handler for these yet — land on the market's ads overview
      return market ? `/ads/${market}` : null;
    default:
      return null;
  }
}

// ============================================================
// Outcome badge
// ============================================================

function OutcomeBadge({ card }: { card: InboxCard }) {
  if (!card.outcome_status || card.outcome_status === "na") return null;

  // Pre-revisit: tracking countdown
  if (card.outcome_status === "pending" || card.outcome_status === "measuring") {
    const days = daysUntil(card.outcome_revisit_at);
    if (days === null) return null;
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 text-text-2 text-[11px]">
        <Clock size={11} />
        {card.outcome_status === "measuring" ? "Проследяване" : "Изчаква"}
        {days > 0 ? ` · ${days}д` : ""}
      </span>
    );
  }

  if (card.outcome_status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">
        <TrendingUp size={11} /> Сработи
      </span>
    );
  }
  if (card.outcome_status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-[11px] font-medium">
        <TrendingDown size={11} /> Без ефект
      </span>
    );
  }
  if (card.outcome_status === "inconclusive") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px]">
        <Minus size={11} /> Неясно
      </span>
    );
  }
  return null;
}

// ============================================================
// Card row
// ============================================================

function CardRow({ card, onAction }: { card: InboxCard; onAction: (id: string, action: string) => void }) {
  const router = useRouter();
  const sev = SEVERITY_STYLE[card.severity];
  const market = card.stores?.market_code ?? null;
  const sourceLabel = card.source_agent ? SOURCE_LABEL[card.source_agent] ?? card.source_agent : "Система";
  const showActions = card.status === "pending";
  const href = targetHref(card);

  return (
    <div
      className={`bg-surface border border-border rounded-xl border-l-4 ${sev.border} p-4 md:p-5 flex flex-col gap-3 transition-shadow hover:shadow-sm`}
    >
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {market && <MarketFlag market={market} size={18} labelled />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${sev.pill}`}>
                {sev.label}
              </span>
              <span className="text-[11px] text-text-3">{sourceLabel}</span>
              <span className="text-[11px] text-text-3">·</span>
              <span className="text-[11px] text-text-3">{relativeTime(card.created_at)}</span>
              <OutcomeBadge card={card} />
            </div>
            <h3 className="text-[15px] font-semibold text-text leading-snug">{card.title}</h3>
          </div>
        </div>
      </div>

      <p className="text-[13px] text-text-2 leading-relaxed">{card.why}</p>

      {card.outcome_summary && (
        <div className="bg-surface-2 rounded-lg px-3 py-2 text-[12px] text-text-2 leading-relaxed">
          <span className="font-medium text-text">Резултат:</span> {card.outcome_summary}
        </div>
      )}

      {showActions && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {href && (
            <Button size="sm" variant="secondary" onClick={() => router.push(href)}>
              <ArrowRight size={14} /> Прегледай
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => onAction(card.id, "approve")}>
            <CheckCircle2 size={14} /> Действам
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAction(card.id, "snooze")}>
            <Clock size={14} /> Отложи 24ч
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAction(card.id, "dismiss")}>
            <X size={14} /> Отхвърли
          </Button>
        </div>
      )}

      {!showActions && (
        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
          <span className="text-[11px] text-text-3">
            {card.status === "actioned" && `✓ Действано ${relativeTime(card.actioned_at)}`}
            {card.status === "dismissed" && `Отхвърлено ${relativeTime(card.actioned_at)}`}
            {card.status === "acknowledged" && `Прегледано ${relativeTime(card.actioned_at)}`}
          </span>
          {href && (
            <button
              onClick={() => router.push(href)}
              className="inline-flex items-center gap-1 text-[12px] text-text-2 hover:text-accent transition-colors cursor-pointer"
            >
              Прегледай <ArrowRight size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Page
// ============================================================

export default function InboxPage() {
  const [statusFilter, setStatusFilter] = useState<"active" | "archive">("active");

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter === "archive") params.set("status", "actioned,dismissed");
    params.set("limit", "200");
    return `/api/inbox?${params.toString()}`;
  }, [statusFilter]);

  const { data, error, isLoading } = useSWR<InboxResponse>(url, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
  });

  const cards = useMemo(() => {
    const list = data?.cards ?? [];
    return [...list].sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [data]);

  async function handleAction(id: string, action: string) {
    try {
      const res = await fetch(`/api/inbox/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, snoozeHours: action === "snooze" ? 24 : undefined }),
      });
      if (!res.ok) {
        // Best-effort error surface; full toast system is later work.
        const body = await res.json().catch(() => ({}));
        // eslint-disable-next-line no-console
        console.error("inbox action failed", body);
        return;
      }
      // Revalidate both the active feed and the badge count.
      mutate(url);
      mutate("/api/inbox?countOnly=1");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("inbox action threw", e);
    }
  }

  return (
    <div className="max-w-[900px] mx-auto">
      <PageHeader title="Входящи">
        <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-1">
          <button
            onClick={() => setStatusFilter("active")}
            className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer ${
              statusFilter === "active" ? "bg-surface text-text shadow-sm" : "text-text-2 hover:text-text"
            }`}
          >
            Активни
          </button>
          <button
            onClick={() => setStatusFilter("archive")}
            className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer ${
              statusFilter === "archive" ? "bg-surface text-text shadow-sm" : "text-text-2 hover:text-text"
            }`}
          >
            Архив
          </button>
        </div>
      </PageHeader>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5">
              <Skeleton className="h-4 w-1/3 mb-3" />
              <Skeleton className="h-5 w-2/3 mb-3" />
              <Skeleton className="h-3 w-full mb-1" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <EmptyState
          icon={AlertTriangle}
          iconColor="text-red"
          title="Грешка при зареждане"
          description="Не успяхме да заредим входящите. Опитай отново след малко."
        />
      )}

      {!isLoading && !error && cards.length === 0 && (
        <EmptyState
          icon={InboxIcon}
          iconColor="text-accent"
          title={statusFilter === "active" ? "Всичко е чисто" : "Архивът е празен"}
          description={
            statusFilter === "active"
              ? "Няма активни сигнали. Системата следи денонощно — ще те уведомим когато нещо излезе извън нормата."
              : "След като приключиш или отхвърлиш карти, ще се появят тук."
          }
        />
      )}

      {!isLoading && !error && cards.length > 0 && (
        <div className="space-y-3">
          {cards.map((card) => (
            <CardRow key={card.id} card={card} onAction={handleAction} />
          ))}
        </div>
      )}
    </div>
  );
}

