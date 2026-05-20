"use client";

import { Delta } from "@/components/shared/Delta";

/**
 * E-commerce purchase funnel — pure render component.
 *
 * Design contract decisions (docs/analytics-design-contract.md):
 *   §1 Color: bars stay neutral (text-2). Funnel shows composition, not
 *      growth — accent would mis-signal "this is good/bad". The final
 *      step (purchase) gets an accent fill to mark the goal, nothing else.
 *   §6 One question per card: this card answers "where do users drop off?"
 *      — not "how many overall purchases" (that's the hero strip).
 *   §8 Comparison: each step shows delta vs same step previous period
 *      (consistent format), plus overall conversion delta in the footer.
 *
 * Drop-off % between rows is displayed neutrally — funnels always lose
 * users between stages; coloring drop-off would falsely imply "bad" when
 * it's just how funnels work. Accent/red only appear on the period-over-
 * period delta, where direction actually matters.
 */
export interface FunnelStep {
  /** Raw GA4 event name (view_item, add_to_cart, ...) — used as key */
  name: string;
  /** Human-readable label in БГ ("Преглед продукт", "В количка", ...) */
  label: string;
  /** Current period count */
  count: number;
  /** Delta vs previous period — null when previous had no data */
  deltaPct: number | null;
}

interface FunnelChartProps {
  steps: FunnelStep[];
  /** Overall conversion = last step / first step, as percentage */
  overallConversionPct: number;
  overallConversionDelta: number | null;
}

export function FunnelChart({ steps, overallConversionPct, overallConversionDelta }: FunnelChartProps) {
  if (steps.length === 0 || steps[0].count === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-text-2">
        Няма e-commerce събития за избрания период.
        <div className="text-[12px] text-text-3 mt-1">
          GA4 dataLayer трябва да изпраща <code className="font-mono">view_item</code>, <code className="font-mono">add_to_cart</code>, <code className="font-mono">begin_checkout</code>, <code className="font-mono">purchase</code>.
        </div>
      </div>
    );
  }

  const max = steps[0].count;

  return (
    <div>
      <div className="space-y-4">
        {steps.map((step, idx) => {
          const widthPct = max > 0 ? (step.count / max) * 100 : 0;
          const isLast = idx === steps.length - 1;
          const nextStep = steps[idx + 1];
          // Drop-off from this step to the next, as a percentage.
          const dropOffPct = nextStep && step.count > 0
            ? Math.round(((step.count - nextStep.count) / step.count) * 100)
            : null;

          return (
            <div key={step.name}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] font-medium text-text">{step.label}</span>
                <span className="text-[13px] text-text-2 tabular-nums">
                  {step.count.toLocaleString("bg-BG")}
                </span>
              </div>
              <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${isLast ? "bg-accent" : "bg-text-3"}`}
                  style={{ width: `${Math.max(widthPct, 0.5)}%` }}
                />
              </div>
              {step.deltaPct !== null && (
                <Delta pct={step.deltaPct} label="спрямо пр. период" className="mt-1.5" />
              )}
              {dropOffPct !== null && (
                <div className="text-[11px] text-text-3 mt-2 ml-3 tabular-nums">
                  ↘ {dropOffPct}% drop към {steps[idx + 1].label.toLowerCase()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-2">Обща конверсия</span>
          <span className="text-[15px] font-semibold text-text tabular-nums">
            {overallConversionPct.toFixed(2)}%
          </span>
        </div>
        {overallConversionDelta !== null && (
          <Delta pct={overallConversionDelta} unit="pp" label="спрямо пр. период" className="mt-1" />
        )}
      </div>
    </div>
  );
}
