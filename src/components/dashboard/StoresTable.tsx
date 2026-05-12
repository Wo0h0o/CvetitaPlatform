"use client";

import useSWR from "swr";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Skeleton } from "@/components/shared/Skeleton";
import { MarketFlag } from "@/components/shared/MarketFlag";
import { sofiaHoursElapsed } from "@/lib/sofia-date";
import {
  deriveDisplayState,
  STATE_LABEL,
  EARLY_DAY_THRESHOLD_HOURS,
  type DisplayState,
  type StoreCardData,
} from "./store-state";
import { ArrowRight } from "lucide-react";
import type { DatePreset } from "@/lib/dates";

// ============================================================
// Types — payload shape mirrors /api/dashboard/home/stores response.
// ============================================================

interface StoresResponse {
  window?: {
    from: string;
    to: string;
    preset: DatePreset;
    days: number;
  };
  stores: StoreCardData[];
  error?: string;
}

// ============================================================
// Per-state visual treatment.
//
// Each cell answers a different question so colour is more useful as a
// status pill than as a row-wide border. Pill background + text colour
// are paired (soft bg, dark text) so it reads as a chip not a banner.
// ============================================================

const STATE_PILL_CLASS: Record<DisplayState, string> = {
  green: "bg-accent-soft text-accent",
  amber: "bg-orange-soft text-orange",
  red: "bg-red-soft text-red",
  measuring: "bg-orange-soft text-orange",
  paused: "bg-surface-2 text-text-3",
  early: "bg-surface-2 text-text-3",
};

const STATE_ICON: Record<DisplayState, string> = {
  green: "✓",
  amber: "•",
  red: "⚠",
  measuring: "…",
  paused: "⏸",
  early: "—",
};

// ============================================================
// Formatting
// ============================================================

function fmtEur(n: number): string {
  return `${n.toLocaleString("bg-BG", { maximumFractionDigits: 0 })} EUR`;
}

function fmtRoas(n: number): string {
  return n > 0 ? n.toFixed(2) : "—";
}

// Attribution % can briefly exceed 100 when Meta credits a purchase
// before the matching Shopify webhook lands. Match the top-strip's
// rendering convention: cap the display at "100%+" so the operator
// reads a coherent number across both surfaces.
function fmtPct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const pct = Math.round((part / whole) * 100);
  return pct > 100 ? "100%+" : `${pct}%`;
}

// ============================================================
// Loading + error states
// ============================================================

function TableSkeleton() {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-4 space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

// ============================================================
// Status pill
// ============================================================

function StatusPill({ state }: { state: DisplayState }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${STATE_PILL_CLASS[state]}`}
    >
      <span aria-hidden>{STATE_ICON[state]}</span>
      {STATE_LABEL[state]}
    </span>
  );
}

// ============================================================
// Row data — combines server payload + frontend-derived state.
// ============================================================

interface RowData {
  store: StoreCardData;
  state: DisplayState;
}

function buildRowData(
  stores: StoreCardData[],
  preset: DatePreset
): RowData[] {
  // "early" only applies to intraday pacing for the current day. For any
  // range that isn't "today", a red ratio is real signal — don't demote it.
  const isEarly =
    preset === "today" && sofiaHoursElapsed() < EARLY_DAY_THRESHOLD_HOURS;
  return stores.map((store) => ({
    store,
    state: deriveDisplayState(store, isEarly),
  }));
}

// ============================================================
// Component
// ============================================================

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface StoresTableProps {
  /** Query string from useDateRange. */
  queryString: string;
  /** Echoed preset — gates the early-day demotion. */
  preset: DatePreset;
  /** Human label for the active range — appears in the section sub-text. */
  rangeLabel: string;
}

export function StoresTable({ queryString, preset, rangeLabel }: StoresTableProps) {
  const router = useRouter();
  const { data, isLoading, error } = useSWR<StoresResponse>(
    `/api/dashboard/home/stores?${queryString}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false }
  );

  const description =
    preset === "today"
      ? "Приходи (Shopify) и attribution срещу Meta-разход — за всеки магазин (днес)."
      : `Приходи (Shopify) и attribution срещу Meta-разход — за всеки магазин (${rangeLabel}).`;

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[15px] font-semibold text-text">Магазини</h2>
      </div>
      <p className="text-[12px] text-text-3 mb-3">{description}</p>

      {isLoading || !data ? (
        <TableSkeleton />
      ) : error || data.error ? (
        <div className="bg-surface rounded-xl shadow-sm p-5 text-center text-[13px] text-text-2">
          Грешка при зареждане на магазините
        </div>
      ) : (
        <StoresTableBody
          rows={buildRowData(data.stores, preset)}
          onRowClick={(id) => router.push(`/sales/store/${id}`)}
        />
      )}
    </section>
  );
}

interface StoresTableBodyProps {
  rows: RowData[];
  onRowClick: (storeId: string) => void;
}

function StoresTableBody({ rows, onRowClick }: StoresTableBodyProps) {
  return (
    <>
      {/* Desktop: real table — composable columns. */}
      <div className="hidden md:block bg-surface rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2 text-text-2 text-[12px]">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Магазин</th>
              <th className="text-right px-4 py-2.5 font-medium">
                Shopify приходи
              </th>
              <th className="text-right px-4 py-2.5 font-medium">
                Meta attribution
              </th>
              <th className="text-right px-4 py-2.5 font-medium">Meta разход</th>
              <th className="text-right px-4 py-2.5 font-medium">ROAS</th>
              <th className="text-left px-4 py-2.5 font-medium">Статус</th>
              <th className="text-right px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ store, state }) => (
              <tr
                key={store.storeId}
                role="button"
                tabIndex={0}
                aria-label={`Отвори продажби за ${store.name}`}
                onClick={() => onRowClick(store.storeId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(store.storeId);
                  }
                }}
                className="border-t border-border hover:bg-surface-2 cursor-pointer transition-colors focus:outline-none focus:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <MarketFlag market={store.marketCode} size={18} labelled />
                    <span className="font-medium text-text">{store.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-text">
                  {fmtEur(store.shopifyTodayRevenue)}
                  <div className="text-[11px] text-text-3 font-normal">
                    {store.shopifyTodayOrders} поръчки
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-2">
                  {fmtEur(store.todayRevenue)}
                  <div className="text-[11px] text-text-3">
                    {fmtPct(store.todayRevenue, store.shopifyTodayRevenue)} от
                    Shopify
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-2">
                  {fmtEur(store.todaySpend)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-2">
                  {fmtRoas(store.roasLast24h)}
                  <div className="text-[11px] text-text-3">
                    медиана 14д: {fmtRoas(store.roasMedian14d)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusPill state={state} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/ads/${store.marketCode}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-[12px] text-text-2 hover:text-text"
                  >
                    Реклами
                    <ArrowRight size={12} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards — same columns, vertical layout. */}
      <div className="md:hidden space-y-2">
        {rows.map(({ store, state }) => (
          <div
            key={store.storeId}
            role="button"
            tabIndex={0}
            onClick={() => onRowClick(store.storeId)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick(store.storeId);
              }
            }}
            className="bg-surface rounded-xl shadow-sm p-4 cursor-pointer hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MarketFlag market={store.marketCode} size={18} labelled />
                <span className="font-medium text-text">{store.name}</span>
              </div>
              <StatusPill state={state} />
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
              <div>
                <div className="text-[11px] text-text-3">Shopify приходи</div>
                <div className="font-medium text-text tabular-nums">
                  {fmtEur(store.shopifyTodayRevenue)}
                </div>
                <div className="text-[11px] text-text-3">
                  {store.shopifyTodayOrders} поръчки
                </div>
              </div>
              <div>
                <div className="text-[11px] text-text-3">Meta attribution</div>
                <div className="font-medium text-text tabular-nums">
                  {fmtEur(store.todayRevenue)}
                </div>
                <div className="text-[11px] text-text-3">
                  {fmtPct(store.todayRevenue, store.shopifyTodayRevenue)} от
                  Shopify
                </div>
              </div>
              <div>
                <div className="text-[11px] text-text-3">Meta разход</div>
                <div className="font-medium text-text tabular-nums">
                  {fmtEur(store.todaySpend)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-text-3">ROAS</div>
                <div className="font-medium text-text tabular-nums">
                  {fmtRoas(store.roasLast24h)}
                </div>
                <div className="text-[11px] text-text-3">
                  медиана: {fmtRoas(store.roasMedian14d)}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-border">
              <Link
                href={`/ads/${store.marketCode}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[12px] text-text-2 hover:text-text"
              >
                Виж реклами
                <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
