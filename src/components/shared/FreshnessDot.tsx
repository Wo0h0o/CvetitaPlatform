/**
 * FreshnessDot — индикатор за свежестта на данните.
 *
 * Цветове според възрастта на данните:
 *   🟢 зелено  — свежи (< 15 мин)
 *   🟡 жълто   — скорошни (< 1 час)
 *   🟠 оранжево — днешни (< 24 часа)
 *   ⚪ сиво    — от предишно обновяване (> 24 часа)
 *   🔴 червено — никога не обновявано / грешка
 *
 * Usage:
 *   <FreshnessDot lastSyncedAt={row.last_synced_at} />
 *   <FreshnessDot lastSyncedAt={row.last_synced_at} showLabel />
 */

import { Tooltip } from "./Tooltip";

type Level = "fresh" | "recent" | "aging" | "stale" | "none";

const COLOR_BY_LEVEL: Record<Level, string> = {
  fresh:  "bg-emerald-500",
  recent: "bg-yellow-400",
  aging:  "bg-orange-400",
  stale:  "bg-zinc-400 dark:bg-zinc-500",
  none:   "bg-red-500",
};

const LEVEL_LABEL: Record<Level, string> = {
  fresh:  "току-що обновено",
  recent: "наскоро обновено",
  aging:  "обновено днес",
  stale:  "от предишно обновяване",
  none:   "никога не е обновявано",
};

function classify(ts: string | Date | null | undefined): Level {
  if (!ts) return "none";
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
  /** Показвай и текстова възраст до точката (напр. "преди 3 мин"). */
  showLabel?: boolean;
  /** Допълнителни класове за позициониране. */
  className?: string;
}

export function FreshnessDot({
  lastSyncedAt,
  showLabel = false,
  className = "",
}: FreshnessDotProps) {
  const level = classify(lastSyncedAt);
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
