"use client";

import { useState, useRef, useEffect } from "react";
import { Calendar } from "lucide-react";
import { useDateRange } from "@/hooks/useDateRange";
import { type DatePreset, formatBgDate } from "@/lib/dates";

const presets: { id: DatePreset; label: string }[] = [
  { id: "today", label: "Днес" },
  { id: "yesterday", label: "Вчера" },
  { id: "7d", label: "7д" },
  { id: "30d", label: "30д" },
  { id: "90d", label: "90д" },
];

/**
 * `defaultPreset` must match whatever the parent page passed to its own
 * `useDateRange(...)` call — otherwise the highlighted chip drifts away
 * from the actual data window (e.g. Dashboard uses "today" while the
 * picker would default to "30d" and highlight the wrong chip).
 */
export function DateRangePicker({
  defaultPreset,
}: {
  defaultPreset?: DatePreset;
} = {}) {
  const { preset, from, to, setPreset, setCustomRange } = useDateRange(defaultPreset);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowCustom(false);
      }
    }
    if (showCustom) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showCustom]);

  return (
    // Mobile: compact chips, smaller gap, no shrinking past content
    // width. The PageHeader's flex-wrap takes over if this row plus
    // the StoreSelector still doesn't fit; otherwise the picker stays
    // on the same line as the store dropdown.
    <div className="flex items-center gap-0.5 sm:gap-1 relative">
      {presets.map((p) => (
        <button
          key={p.id}
          onClick={() => {
            setPreset(p.id);
            setShowCustom(false);
          }}
          className={`
            px-2 py-1 sm:px-3 sm:py-1.5 rounded-full
            text-[11px] sm:text-[12px] font-medium
            transition-all duration-150 cursor-pointer
            ${
              preset === p.id && preset !== "custom"
                ? "bg-accent text-white shadow-sm"
                : "text-text-3 hover:text-text-2 hover:bg-surface-2"
            }
          `}
        >
          {p.label}
        </button>
      ))}

      {/* Custom range button — icon-only on mobile when idle, label
          shows only once a custom window is active or from sm+. Keeps
          the row inside the mobile viewport width. */}
      <div className="relative" ref={popoverRef}>
        <button
          onClick={() => setShowCustom(!showCustom)}
          aria-label="Персонализиран период"
          className={`
            flex items-center gap-1 sm:gap-1.5
            px-2 py-1 sm:px-3 sm:py-1.5 rounded-full
            text-[11px] sm:text-[12px] font-medium
            transition-all duration-150 cursor-pointer
            ${
              preset === "custom"
                ? "bg-accent text-white shadow-sm"
                : "text-text-3 hover:text-text-2 hover:bg-surface-2"
            }
          `}
        >
          <Calendar size={12} />
          <span
            className={
              preset === "custom" ? "inline" : "hidden sm:inline"
            }
          >
            {preset === "custom"
              ? `${formatBgDate(from)} — ${formatBgDate(to)}`
              : "Период"}
          </span>
        </button>

        {showCustom && (
          <div className="absolute top-full right-0 mt-2 bg-surface rounded-xl shadow-lg border border-border p-4 z-50 min-w-[260px]">
            <div className="space-y-3">
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1">
                  От
                </label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1">
                  До
                </label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
                />
              </div>
              <button
                onClick={() => {
                  setCustomRange(customFrom, customTo);
                  setShowCustom(false);
                }}
                className="w-full py-2 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent-hover transition-colors cursor-pointer"
              >
                Приложи
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
