"use client";

import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/shared/Skeleton";
import { ActionCard, type ActionCardData, type ActionKey } from "./ActionCard";
import { logger } from "@/lib/logger";
import { useToast } from "@/providers/ToastProvider";

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

const ACTION_CARDS_KEY = "/api/dashboard/home/action-cards";
const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ActionRow() {
  const router = useRouter();
  const { toast } = useToast();
  const { data, isLoading, error } = useSWR<ActionCardsResponse>(
    ACTION_CARDS_KEY,
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false }
  );

  const handleAction = async (
    cardId: string,
    action: ActionKey,
    extra?: { factor?: number }
  ) => {
    const card = data?.cards.find((c) => c.id === cardId);
    if (!card) {
      logger.error("action-row: unknown cardId", { cardId });
      return;
    }

    // Review — client-side navigation, no backend call.
    if (action === "review") {
      const market = card.target.marketCode;
      if (!market) {
        toast("Нямам информация за пазара", "error");
        return;
      }
      router.push(`/ads/${market}?focus=${encodeURIComponent(card.target.id)}`);
      return;
    }

    // Pause / Scale / Dismiss — all POST to /api/dashboard/action/*
    const body: Record<string, unknown> = { briefId: cardId };
    if (action !== "dismiss") {
      body.targetType = card.target.type;
      body.targetId = card.target.id;
      body.integrationAccountId = card.target.integrationAccountId;
    }
    if (action === "scale") {
      body.factor = extra?.factor;
    }

    let res: Response;
    try {
      res = await fetch(`/api/dashboard/action/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      logger.error("action-row: network error", {
        action,
        cardId,
        error: err instanceof Error ? err.message : String(err),
      });
      toast("Мрежова грешка — опитай отново", "error");
      throw err;
    }

    if (!res.ok) {
      logger.error("action-row: mutation rejected", {
        action,
        cardId,
        status: res.status,
      });
      toast("Грешка — опитай отново", "error");
      throw new Error(`HTTP ${res.status}`);
    }

    // Success — re-fetch so the actioned card drops from the row. SWR
    // will refetch and the card list will no longer include this brief
    // (agent_briefs.status flipped to 'actioned' or 'dismissed').
    await mutate(ACTION_CARDS_KEY);
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
