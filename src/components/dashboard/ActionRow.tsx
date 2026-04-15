"use client";

import useSWR from "swr";
import { Skeleton } from "@/components/shared/Skeleton";
import { ActionCard, type ActionCardData, type ActionKey } from "./ActionCard";
import { logger } from "@/lib/logger";

// ============================================================
// Types
// ============================================================

interface ActionCardsResponse {
  cards: ActionCardData[];
  error?: string;
}

// ============================================================
// Loading skeleton
// ============================================================

function ActionCardSkeleton() {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-4 min-h-[140px] border-l-4 border-l-transparent">
      <Skeleton className="h-4 w-40 mb-2" />
      <Skeleton className="h-3 w-48 mb-4" />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-16" />
      </div>
    </div>
  );
}

// ============================================================
// ActionRow
// ============================================================

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ActionRow() {
  const { data, isLoading, error } = useSWR<ActionCardsResponse>(
    "/api/dashboard/home/action-cards",
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false }
  );

  // W3 stub handler. W4: wire to a mutation endpoint that updates
  // agent_briefs.status (acknowledged | actioned | dismissed).
  const handleAction = (cardId: string, action: ActionKey) => {
    logger.info("home action-card clicked", { cardId, action });
  };

  // Mobile carousel: horizontal snap scroll. Desktop: 3-up grid.
  const containerClass = `
    flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4
    md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:mx-0 md:px-0 md:pb-0
  `;
  const itemClass = "w-[85%] shrink-0 snap-start md:w-auto md:shrink";

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-text">Действия</h2>
      </div>

      <div className={containerClass}>
        {isLoading || !data ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={itemClass}>
              <ActionCardSkeleton />
            </div>
          ))
        ) : error || data.error ? (
          <div className="col-span-full w-full bg-surface rounded-xl shadow-sm p-5 text-center text-[13px] text-text-2">
            Грешка при зареждане на действията
          </div>
        ) : data.cards.length === 0 ? (
          <div className="col-span-full w-full bg-surface rounded-xl shadow-sm p-5 text-center text-[13px] text-text-2">
            Няма активни действия. Всичко е под контрол.
          </div>
        ) : (
          data.cards.map((card) => (
            <div key={card.id} className={itemClass}>
              <ActionCard data={card} onAction={handleAction} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
