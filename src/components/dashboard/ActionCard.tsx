"use client";

import { Button } from "@/components/shared/Button";

// ============================================================
// Types (align with /api/dashboard/home/action-cards response)
// ============================================================

export type Severity = "red" | "amber" | "green";
export type ActionKey = "pause" | "scale" | "review" | "dismiss";

export interface ActionTarget {
  type: "ad" | "adset" | "campaign" | "product" | "segment";
  id: string;
  name: string;
}

export interface ActionCardData {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  target: ActionTarget;
  actions: ActionKey[];
}

// ============================================================
// Label + style maps
// ============================================================

const ACTION_LABEL_BG: Record<ActionKey, string> = {
  pause: "Пауза",
  scale: "Скалирай",
  review: "Прегледай",
  dismiss: "Затвори",
};

const BORDER_CLASS: Record<Severity, string> = {
  red: "border-l-4 border-l-red",
  amber: "border-l-4 border-l-orange",
  green: "border-l-4 border-l-accent",
};

// ============================================================
// Component
// ============================================================

interface ActionCardProps {
  data: ActionCardData;
  /**
   * Fired when the user taps an action button. W3 ships without a backend:
   * parent can console.log for now. W4 wires this into the mutation route
   * that updates agent_briefs.status.
   */
  onAction?: (cardId: string, action: ActionKey) => void;
}

export function ActionCard({ data, onAction }: ActionCardProps) {
  // Mobile carousel keeps min-width to match slide; desktop fills the grid cell.
  return (
    <div
      className={`
        bg-surface rounded-xl shadow-sm p-4
        flex flex-col gap-3 min-h-[140px]
        ${BORDER_CLASS[data.severity]}
      `}
    >
      <div className="flex flex-col gap-1.5 flex-1">
        <h3 className="text-[14px] font-semibold text-text leading-snug">
          {data.title}
        </h3>
        <p className="text-[12px] text-text-2 leading-snug">{data.why}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {data.actions.map((key) => {
          // First non-dismiss action gets primary visual weight; dismiss
          // stays ghost so the "do nothing" path isn't the most attractive one.
          const isDismiss = key === "dismiss";
          const variant = isDismiss ? "ghost" : "secondary";
          return (
            <Button
              key={key}
              size="sm"
              variant={variant}
              onClick={() => onAction?.(data.id, key)}
            >
              {ACTION_LABEL_BG[key]}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
