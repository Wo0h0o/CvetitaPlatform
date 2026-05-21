"use client";

// ============================================================
// MetricChips — the segmented metric toggle used across analytics
// surfaces (Приходи / Поръчки / Клиенти and friends).
//
// The exact same markup — a rounded surface-2 panel with p-0.5 and a
// shadow-xs on the active chip — was hand-rolled three times on /sales
// alone (the География section header, SalesRhythm, SalesHourHeatmap).
// /ads will want Spend / Impressions / Clicks; /email will want
// Sends / Opens / Clicks; /traffic its own set. Three copies today is
// six tomorrow. One generic component closes that.
//
// Generic over the value type so each caller keeps its own string
// union ("revenue" | "orders" | "customers", etc.) — no stringly-typed
// soup, the compiler still checks the switch.
//
// NOTE (tap targets): the chips are intentionally compact and at the
// `sm` size sit under the 44px touch minimum. The tap-target pass is
// a separate sprint item — when it lands, the fix goes HERE once and
// every caller inherits it. That is the whole point of the extraction.
// ============================================================

export interface MetricChipOption<T extends string> {
  value: T;
  label: string;
}

export interface MetricChipsProps<T extends string> {
  /** Currently-selected metric. */
  value: T;
  /** Available metrics, in display order. */
  options: ReadonlyArray<MetricChipOption<T>>;
  /** Fired with the newly-picked metric. */
  onChange: (value: T) => void;
  /**
   * `md` (default) — page-level section headers (px-2.5 / 12px).
   * `sm` — inside a card header where vertical space is tight
   *        (px-2 / 11px). Matches the prior SalesRhythm / heatmap look.
   */
  size?: "sm" | "md";
  className?: string;
}

export function MetricChips<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
}: MetricChipsProps<T>) {
  const chipPad =
    size === "sm"
      ? "px-2 py-0.5 text-[11px]"
      : "px-2.5 py-1 text-[12px]";

  return (
    <div
      className={`inline-flex rounded-md bg-surface-2 p-0.5 ${className ?? ""}`}
      role="group"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`
              ${chipPad} rounded font-medium transition-colors cursor-pointer
              ${
                active
                  ? "bg-surface text-text shadow-xs"
                  : "text-text-3 hover:text-text-2"
              }
            `}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
