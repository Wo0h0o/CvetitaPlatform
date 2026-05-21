"use client";

import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { MarketFlag } from "@/components/shared/MarketFlag";
import { ChangeBadge } from "@/components/shared/Badge";
import { useDateRange } from "@/hooks/useDateRange";
import type { StorePerformance } from "@/lib/sales-queries";

// ============================================================
// StorePerformanceTable — multi-store breakdown.
//
// Adaptive surface that doesn't assume a specific account shape:
//
//   * 0–1 active stores → render nothing. The page-level hero already
//     answers everything for a single-store account.
//
//   * 2+ active stores → a stacked-bar "concentration ribbon" on top
//     ("BG holds X%") + a clean row list. Visually answers "is the
//     business one market or balanced?" in one glance.
//
//   * Inactive stores (revenue = 0 for the period) collapse into a
//     single footer chip — keeps the surface focused on the stores that
//     are actually moving.
//
// Colour discipline (design-contract §1): the stacked bar uses a single
// accent-hue ladder (full → 70% → 40% → 20% opacity) — never categorical
// colours per store, since that creates colour-meaning ambiguity.
// ============================================================

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface StoresResponse {
  stores: StorePerformance[];
  error?: string;
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString("bg-BG")} EUR`;
}

function fmtEurFull(n: number): string {
  return `${n.toLocaleString("bg-BG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG");
}

// Top store gets full accent; subsequent fade. Capped at 4 distinct
// shades because past that the visual difference is too small to read.
function shadeForRank(rank: number): { background: string } {
  const opacities = [1, 0.7, 0.45, 0.25];
  const op = opacities[Math.min(rank, opacities.length - 1)];
  return { background: `color-mix(in srgb, var(--accent) ${op * 100}%, transparent)` };
}

function StorePerformanceTableSkeleton() {
  return (
    <Card>
      <CardHeader>Магазини</CardHeader>
      <CardBody className="space-y-3">
        <Skeleton className="h-3 w-full" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardBody>
    </Card>
  );
}

export function StorePerformanceTable() {
  const { queryString } = useDateRange();
  const router = useRouter();

  const { data, isLoading } = useSWR<StoresResponse>(
    `/api/sales/store-performance?${queryString}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  const { active, inactive, totalRevenue } = useMemo(() => {
    const all = data?.stores ?? [];
    const active = all.filter((s) => s.revenue > 0);
    const inactive = all.filter((s) => s.revenue <= 0);
    const totalRevenue = active.reduce((s, x) => s + x.revenue, 0);
    return { active, inactive, totalRevenue };
  }, [data?.stores]);

  if (isLoading) return <StorePerformanceTableSkeleton />;

  // No multi-store story to tell.
  if (active.length <= 1 && inactive.length === 0) return null;
  // Single active store + no inactive → hero already covers it.
  if (active.length <= 1 && active.length + inactive.length <= 1) return null;

  return (
    <Card>
      <CardHeader
        action={
          <div className="flex items-center gap-3">
            {totalRevenue > 0 ? (
              <span className="text-[11px] text-text-3 tabular-nums">
                {active.length} {active.length === 1 ? "активен" : "активни"}
                {inactive.length > 0 && (
                  <span className="text-text-3"> • {inactive.length} без продажби</span>
                )}
              </span>
            ) : (
              <span className="text-[11px] text-text-3">Няма продажби за периода</span>
            )}
            <Link
              href="/sales/geography"
              className="inline-flex items-center gap-1 text-[11px] text-text-2 hover:text-text transition-colors"
            >
              На карта
              <ArrowRight size={12} />
            </Link>
          </div>
        }
      >
        Магазини
      </CardHeader>
      <CardBody>
        {active.length === 0 ? (
          <div className="text-center py-6 text-text-2 text-[13px]">
            Няма активни магазини за този период
          </div>
        ) : (
          <>
            {/* Concentration ribbon — only meaningful with 2+ active stores. */}
            {active.length >= 2 && (
              <div className="mb-5">
                <div
                  className="flex h-3 rounded-full overflow-hidden bg-surface-2"
                  role="img"
                  aria-label={`Концентрация на приходи по магазин`}
                >
                  {active.map((s, i) => {
                    const pct = (s.revenue / totalRevenue) * 100;
                    return (
                      <div
                        key={s.storeId}
                        className="transition-all"
                        style={{
                          width: `${pct}%`,
                          ...shadeForRank(i),
                        }}
                        title={`${s.storeName}: ${pct.toFixed(1)}%`}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-2 text-[11px] text-text-3 tabular-nums">
                  <span>
                    Топ: <span className="text-text font-semibold">{active[0].storeName}</span>{" "}
                    {((active[0].revenue / totalRevenue) * 100).toFixed(0)}%
                  </span>
                  <span>
                    Общо: <span className="text-text font-semibold">{fmtEur(totalRevenue)}</span>
                  </span>
                </div>
              </div>
            )}

            {/* Row list — clickable, keyboard-accessible, mobile-friendly. */}
            <div className="space-y-1.5">
              {active.map((s) => {
                const pct = totalRevenue > 0 ? (s.revenue / totalRevenue) * 100 : 0;
                return (
                  <button
                    key={s.storeId}
                    type="button"
                    onClick={() => router.push(`/sales/store/${s.storeId}`)}
                    className="
                      w-full text-left
                      flex items-center gap-3
                      px-3 py-2.5 -mx-3
                      rounded-lg
                      hover:bg-surface-2 transition-colors
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
                    "
                  >
                    <MarketFlag market={s.marketCode} size={16} labelled />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-medium text-text truncate">
                          {s.storeName}
                        </span>
                        <span className="text-[13px] font-semibold text-text tabular-nums flex-shrink-0">
                          {fmtEurFull(s.revenue)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-[11px] text-text-3 tabular-nums">
                          {fmtInt(s.orders)} поръчки
                          {active.length >= 2 && (
                            <>
                              {" "}
                              <span className="text-text-3">•</span>{" "}
                              {pct >= 1 ? `${pct.toFixed(0)}%` : "<1%"}
                            </>
                          )}
                        </span>
                        <ChangeBadge value={s.revenueChange} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Inactive markets — one compact chip, NOT a list of empty rows. */}
            {inactive.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="text-[11px] text-text-3 flex items-center gap-2 flex-wrap">
                  <span>Без продажби за периода:</span>
                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                    {inactive.map((s) => (
                      <button
                        key={s.storeId}
                        type="button"
                        onClick={() => router.push(`/sales/store/${s.storeId}`)}
                        className="
                          inline-flex items-center gap-1
                          px-2 py-0.5 rounded-md
                          hover:bg-surface-2 transition-colors
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
                        "
                        title={s.storeName}
                      >
                        <MarketFlag market={s.marketCode} size={12} />
                        <span className="text-[11px] text-text-2">{s.storeName}</span>
                      </button>
                    ))}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
