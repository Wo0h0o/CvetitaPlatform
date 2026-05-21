"use client";

import { useAnalyticsSWR } from "@/hooks/useAnalyticsSWR";
import { useMemo, useState } from "react";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import { fmtEur, fmtInt } from "@/lib/format";
import type { KpiMetric, TopProduct } from "@/lib/sales-queries";

// ============================================================
// TopProductsAggregate — best-selling products across all selected stores.
//
// What changed vs the prior version:
//
//   * Each row now carries a **share-of-revenue chip** ("14%") computed
//     against the period's TOTAL revenue (from /api/sales/kpis), not
//     against the top-10 sum. So "top 3 = 40% of business" is the real
//     concentration number, not a top-bucket artefact.
//
//   * Header shows the concentration headline ("Топ 3 = 40% от приходи"),
//     turning the card from "list of names" into "answer to a question".
//
//   * Default surface is 6 rows + "виж всички 10" expander, instead of
//     dumping a long list. KISS — most operators want to see who's hot,
//     not scroll through everyone.
//
//   * No "Package" icon in the header (design-contract §3).
//
// Mobile: same vertical list — bars stay readable at 375px because we
// reserve `flex-1` for the bar track and let the title truncate.
// ============================================================


interface TopProductsResponse {
  products: TopProduct[];
  error?: string;
}

interface KpisResponse {
  revenue: KpiMetric;
  error?: string;
}

const DEFAULT_VISIBLE = 6;
const MAX_VISIBLE = 10;


export function TopProductsAggregate() {
  const { queryString } = useDateRange();
  const { storeParam } = useStoreSelection();
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, error, mutate } = useAnalyticsSWR<TopProductsResponse>(
    `/api/sales/top-products?${queryString}&${storeParam}&limit=${MAX_VISIBLE}`
  );

  const { data: kpis } = useAnalyticsSWR<KpisResponse>(
    `/api/sales/kpis?${queryString}&${storeParam}`
  );

  const products = useMemo(() => data?.products ?? [], [data?.products]);
  const totalRevenue = kpis?.revenue.value ?? 0;
  const maxRevenue = products[0]?.revenue ?? 0;

  // Headline concentration: top 3 share of TOTAL revenue.
  const top3Pct = useMemo(() => {
    if (totalRevenue <= 0 || products.length === 0) return null;
    const top3 = products.slice(0, 3).reduce((s, p) => s + p.revenue, 0);
    return Math.round((top3 / totalRevenue) * 100);
  }, [products, totalRevenue]);

  if (error) {
    return (
      <Card>
        <CardHeader>Топ продукти</CardHeader>
        <CardBody>
          <ErrorState error={error} onRetry={() => mutate()} />
        </CardBody>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>Топ продукти</CardHeader>
        <CardBody>
          <Skeleton className="h-48 w-full" />
        </CardBody>
      </Card>
    );
  }

  const visible = expanded ? products.slice(0, MAX_VISIBLE) : products.slice(0, DEFAULT_VISIBLE);
  const remaining = products.length - visible.length;

  return (
    <Card>
      <CardHeader
        action={
          top3Pct !== null ? (
            <span className="text-[11px] text-text-3 tabular-nums">
              Топ 3 = <span className="text-text font-semibold">{top3Pct}%</span> от приходи
            </span>
          ) : (
            <span className="text-[11px] text-text-3">Топ {MAX_VISIBLE}</span>
          )
        }
      >
        Топ продукти
      </CardHeader>
      <CardBody className="space-y-3">
        {products.length === 0 ? (
          <div className="text-center py-8 text-text-2 text-[13px]">
            Няма данни за продукти
          </div>
        ) : (
          <>
            {visible.map((p, i) => {
              const share = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0;
              const barPct = maxRevenue > 0 ? (p.revenue / maxRevenue) * 100 : 0;
              return (
                <div key={p.title} className="flex items-start gap-3">
                  <span className="text-[11px] text-text-3 tabular-nums w-5 text-right flex-shrink-0 pt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-[13px] text-text truncate">{p.title}</span>
                      <span className="text-[13px] font-semibold text-text tabular-nums flex-shrink-0">
                        {fmtEur(p.revenue)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full transition-all duration-300"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-text-3 tabular-nums flex-shrink-0 min-w-[44px] text-right">
                        {share >= 1 ? `${share.toFixed(0)}%` : "<1%"}
                      </span>
                      <span className="text-[11px] text-text-3 tabular-nums flex-shrink-0 min-w-[40px] text-right hidden sm:block">
                        {fmtInt(p.quantity)} бр.
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {remaining > 0 && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="text-[12px] text-text-2 hover:text-text transition-colors pt-1"
              >
                Виж всички {products.length} →
              </button>
            )}
            {expanded && products.length > DEFAULT_VISIBLE && (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-[12px] text-text-2 hover:text-text transition-colors pt-1"
              >
                Скрий
              </button>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
