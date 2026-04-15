"use client";

import { useState } from "react";
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
  /** Which Meta ad account the target belongs to — forwarded to mutation routes. */
  integrationAccountId?: string;
  /** Market the target belongs to — used for "Прегледай" deep-link navigation. */
  marketCode?: string;
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

export const ACTION_LABEL_BG: Record<ActionKey, string> = {
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

// Scale factor presets — MUST match the server-side whitelist in
// /api/dashboard/action/scale/route.ts. If you add a preset here, add it
// there too or the server will reject the request.
const SCALE_PRESETS: Array<{ label: string; factor: number }> = [
  { label: "+25%", factor: 1.25 },
  { label: "+50%", factor: 1.5 },
  { label: "+100%", factor: 2.0 },
];

// ============================================================
// Component
// ============================================================

type ActionMode = "idle" | "confirm-pause" | "scale-picker";

interface ActionCardProps {
  data: ActionCardData;
  /**
   * Called when the user commits an action. Parent handles the HTTP call
   * and either mutates the SWR cache (success → card unmounts) or toasts
   * an error and lets the card return to idle.
   *
   * For Scale, `extra.factor` is one of the SCALE_PRESETS values.
   * For Review, the parent should navigate rather than hit a mutation route.
   */
  onAction?: (
    cardId: string,
    action: ActionKey,
    extra?: { factor?: number }
  ) => Promise<void>;
}

export function ActionCard({ data, onAction }: ActionCardProps) {
  const [mode, setMode] = useState<ActionMode>("idle");
  const [busy, setBusy] = useState(false);

  const commit = async (action: ActionKey, extra?: { factor?: number }) => {
    if (!onAction || busy) return;
    setBusy(true);
    try {
      await onAction(data.id, action, extra);
    } finally {
      // On success the card is about to unmount (parent SWR mutate drops
      // the actioned brief) and this state update is a no-op. On failure
      // the toast fires in the parent and we reset so the user can retry.
      setBusy(false);
      setMode("idle");
    }
  };

  const handleClick = (key: ActionKey) => {
    if (busy) return;
    if (key === "pause") {
      setMode("confirm-pause");
    } else if (key === "scale") {
      setMode("scale-picker");
    } else {
      // Dismiss: low-consequence DB flip, no confirm.
      // Review: navigate via parent, no confirm.
      void commit(key);
    }
  };

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

      {mode === "idle" && (
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
                disabled={busy}
                onClick={() => handleClick(key)}
              >
                {ACTION_LABEL_BG[key]}
              </Button>
            );
          })}
        </div>
      )}

      {mode === "confirm-pause" && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-text-2">Сигурен?</span>
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => commit("pause")}
          >
            Да
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setMode("idle")}
          >
            Не
          </Button>
        </div>
      )}

      {mode === "scale-picker" && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {SCALE_PRESETS.map(({ label, factor }) => (
            <Button
              key={label}
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => commit("scale", { factor })}
            >
              {label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setMode("idle")}
            aria-label="Отказ"
          >
            ✕
          </Button>
        </div>
      )}
    </div>
  );
}
