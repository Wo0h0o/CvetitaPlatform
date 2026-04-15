/**
 * FreshnessDot — индикатор за свежестта на данните.
 *
 * Цветове според възрастта на данните:
 *   🟢 зелено   — свежи (< 15 мин)
 *   🟡 жълто    — скорошни (< 1 час)
 *   🟠 оранжево — днешни (< 24 часа)
 *   ⚪ сиво     — от предишно обновяване (> 24 часа)
 *   🟠 оранжево — очаква първа синхронизация (ново обвързана сметка)
 *   🔴 червено  — никога не обновявано / грешка
 *
 * Usage:
 *   <FreshnessDot lastSyncedAt={row.last_synced_at} />
 *   <FreshnessDot lastSyncedAt={row.last_synced_at} showLabel />
 *   <FreshnessDot
 *     lastSyncedAt={row.last_synced_at}
 *     accountCreatedAt={row.account_created_at}
 *     showLabel
 *   />
 */

import { Tooltip } from "./Tooltip";

type Level = "fresh" | "recent" | "aging" | "stale" | "pending" | "none";

// Window during which a freshly-bound integration account is allowed to have
// no `last_synced_at` yet without being flagged red. Intraday cron runs every
// 15 min so 30 min leaves one clear retry window.
const PENDING_GRACE_MS = 30 * 60_000;

// Design-system tokens rather than raw Tailwind palette — keeps the dot in
// lockstep with brand colours and dark-mode overrides defined in globals.css.
const COLOR_BY_LEVEL: Record<Level, string> = {
  fresh:   "bg-accent",
  recent:  "bg-yellow",
  aging:   "bg-orange",
  stale:   "bg-text-3",
  pending: "bg-orange",
  none:    "bg-red",
};

const LEVEL_LABEL: Record<Level, string> = {
  fresh:   "току-що обновено",
  recent:  "наскоро обновено",
  aging:   "обновено днес",
  stale:   "от предишно обновяване",
  pending: "очаква първа синхронизация",
  none:    "никога не е обновявано",
};

function classify(
  ts: string | Date | null | undefined,
  accountCreatedAt: string | Date | null | undefined
): Level {
  if (!ts) {
    // Never synced: distinguish "freshly-bound, cron hasn't fired yet"
    // (amber, transient) from "stale binding, cron is broken" (red).
    if (accountCreatedAt) {
      const createdAt =
        typeof accountCreatedAt === "string" ? new Date(accountCreatedAt) : accountCreatedAt;
      const ageMs = Date.now() - createdAt.getTime();
      if (ageMs >= 0 && ageMs < PENDING_GRACE_MS) return "pending";
    }
    return "none";
  }
  const when = typeof ts === "string" ? new Date(ts) : ts;
  const ageMs = Date.now() - when.getTime();
  if (ageMs < 15 * 60_000) return "fresh";
  if (ageMs < 60 * 60_000) return "recent";
  if (ageMs < 24 * 3_600_000) return "aging";
  return "stale";
}

/** "преди Xм", "преди Xч", "преди X дни" */
function formatAgeBg(ts: string | Date): string {
  const when = typeof ts === "string" ? new Date(ts) : ts;
  const ageMs = Date.now() - when.getTime();
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "току-що";
  if (mins < 60) return `преди ${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `преди ${hours} ч`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "преди 1 ден" : `преди ${days} дни`;
}

interface FreshnessDotProps {
  lastSyncedAt: string | Date | null | undefined;
  /**
   * Timestamp of the most recently bound integration account for this
   * scope (market or store). When present and within PENDING_GRACE_MS,
   * a null lastSyncedAt renders amber "очаква първа синхронизация"
   * instead of red "никога не е обновявано".
   */
  accountCreatedAt?: string | Date | null;
  /** Показвай и текстова възраст до точката (напр. "преди 3 мин"). */
  showLabel?: boolean;
  /** Допълнителни класове за позициониране. */
  className?: string;
}

export function FreshnessDot({
  lastSyncedAt,
  accountCreatedAt,
  showLabel = false,
  className = "",
}: FreshnessDotProps) {
  const level = classify(lastSyncedAt, accountCreatedAt);
  const color = COLOR_BY_LEVEL[level];
  const levelLabel = LEVEL_LABEL[level];
  const ageLabel = lastSyncedAt ? formatAgeBg(lastSyncedAt) : levelLabel;
  const tooltipText = lastSyncedAt
    ? `Данни ${ageLabel} (${levelLabel})`
    : levelLabel;

  const dot = (
    <span
      aria-label={tooltipText}
      className={`inline-block h-2 w-2 rounded-full ${color}`}
    />
  );

  if (showLabel) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-[11px] text-text-3 ${className}`}>
        {dot}
        <span>{ageLabel}</span>
      </span>
    );
  }

  return (
    <Tooltip content={tooltipText}>
      <span className={`inline-flex items-center ${className}`}>{dot}</span>
    </Tooltip>
  );
}
