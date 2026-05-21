"use client";

import { useAnalyticsSWR } from "@/hooks/useAnalyticsSWR";
import { useMemo } from "react";
import { Card, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
import { Delta } from "@/components/shared/Delta";
import { MarketFlag } from "@/components/shared/MarketFlag";
import { useDateRange } from "@/hooks/useDateRange";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import { fmtEur, fmtInt, fmtPct } from "@/lib/format";
import type {
  KpiMetric,
  TopProduct,
  StorePerformance,
} from "@/lib/sales-queries";

// ============================================================
// SalesSignalStrip — the second-row insights below the hero.
//
// Five micro-tiles, each a one-line answer to a real operator question:
//
//   1. Уникални клиенти    — раст / спад на купуващите хора
//   2. Стойност / клиент   — revenue per customer (cheap LTV proxy)
//   3. Възстановени        — refund rate as % of revenue (0% is great)
//   4. Топ продукт         — share of the #1 SKU in total revenue
//   5. Топ пазар           — geographic concentration (только when >1 store)
//
// On desktop these flow as a 5-column grid (or 4 if no multi-store).
// On mobile the strip becomes a snap-scrolling carousel — the whole row
// stays visible, the user swipes horizontally to scan them. This is the
// pattern Apple's Health and Stripe Atlas use for "small but many" tiles.
//
// Every SWR key matches keys used in HeroStrip / TopProducts / StoresPanel,
// so the cache is shared and no extra network calls are made.
// ============================================================


interface KpisResponse {
  revenue: KpiMetric;
  orders: KpiMetric;
  aov: KpiMetric;
  refunded: KpiMetric;
  customers: KpiMetric;
  error?: string;
}

interface TopProductsResponse {
  products: TopProduct[];
  error?: string;
}

interface StoresResponse {
  stores: StorePerformance[];
  error?: string;
}


// ============================================================
// SignalTile — one dense card.
//
// Layout:
//   ┌────────────────────────┐
//   │ label (12px text-2)    │
//   │ VALUE (20-22px bold)   │
//   │ trail OR delta         │
//   └────────────────────────┘
//
// `leading` slot is for the optional flag/icon next to the value (used by
// the Топ пазар tile). Everything else stays strictly text — no decorative
// icons per design-contract §3.
// ============================================================

interface SignalTileProps {
  label: string;
  value: string;
  leading?: React.ReactNode;
  /** Tiny sub-line under the value — e.g. "от 89k Shopify". */
  trail?: string;
  /** When set, renders the unified Delta badge instead of plain trail. */
  pct?: number | null;
  unit?: "%" | "pp";
  inverse?: boolean;
}

function SignalTile({
  label,
  value,
  leading,
  trail,
  pct,
  unit = "%",
  inverse = false,
}: SignalTileProps) {
  return (
    <div
      className="
        bg-surface rounded-xl shadow-sm
        p-4
        flex flex-col
        snap-start
        min-w-[180px] md:min-w-0
        flex-shrink-0 md:flex-shrink
      "
    >
      <div className="text-[12px] font-semibold text-text-2 mb-1.5 truncate">
        {label}
      </div>
      <div className="flex items-center gap-2 mb-1">
        {leading}
        <div className="text-[20px] md:text-[22px] font-bold text-text leading-none tabular-nums truncate">
          {value}
        </div>
      </div>
      {pct !== undefined ? (
        <Delta pct={pct} unit={unit} inverse={inverse} label="" className="!text-[11px]" />
      ) : trail ? (
        <div className="text-[11px] text-text-3 truncate">{trail}</div>
      ) : null}
    </div>
  );
}

function StripShell({ children }: { children: React.ReactNode }) {
  // Mobile: horizontal scroll with snap. Desktop: regular grid.
  // Negative margins on mobile let the cards reach the screen edge so the
  // user sees the "more on the right" affordance — a faded last tile.
  return (
    <div
      className="
        -mx-4 px-4 md:mx-0 md:px-0
        overflow-x-auto md:overflow-visible
        snap-x snap-mandatory
        mb-4 md:mb-6
        scrollbar-thin
      "
    >
      <div
        className="
          flex md:grid
          md:grid-cols-4 lg:grid-cols-5
          gap-3 md:gap-4
          pb-2 md:pb-0
          w-max md:w-auto
        "
      >
        {children}
      </div>
    </div>
  );
}

function SkeletonTile() {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-4 min-w-[180px] md:min-w-0 flex-shrink-0 md:flex-shrink">
      <Skeleton className="h-3 w-20 mb-2" />
      <Skeleton className="h-6 w-24 mb-2" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

// ============================================================
// Main export
// ============================================================

export function SalesSignalStrip() {
  const { queryString } = useDateRange();
  const { storeParam, isAll } = useStoreSelection();

  const {
    data: kpis,
    isLoading: kpisLoading,
    error: kpisError,
    mutate: mutateKpis,
  } = useAnalyticsSWR<KpisResponse>(
    `/api/sales/kpis?${queryString}&${storeParam}`
  );

  const { data: topProducts } = useAnalyticsSWR<TopProductsResponse>(
    `/api/sales/top-products?${queryString}&${storeParam}&limit=10`
  );

  // Stores endpoint always returns the full org list — only relevant when
  // viewing "all stores". When the user picked a single store, the Топ
  // пазар tile is meaningless, so we suppress that fetch + tile.
  const { data: stores } = useAnalyticsSWR<StoresResponse>(
    isAll ? `/api/sales/store-performance?${queryString}` : null
  );

  // === Derive metrics from existing endpoints ===
  //
  // Concentration / rate metrics live as FRACTIONS (0..1), not as
  // percent values (0..100). The canonical `fmtPct(n)` multiplies by
  // 100 on its own, so keeping the math as ratios reads more honestly
  // at every step ("share of revenue = X / total" — no spurious *100
  // hiding the unit shift).

  const refundRate = useMemo(() => {
    if (!kpis) return null;
    if (kpis.revenue.value <= 0) return 0;
    return kpis.refunded.value / kpis.revenue.value;
  }, [kpis]);

  const revenuePerCustomer = useMemo(() => {
    if (!kpis || kpis.customers.value <= 0) return 0;
    return kpis.revenue.value / kpis.customers.value;
  }, [kpis]);

  const topProductShare = useMemo(() => {
    if (!kpis || !topProducts?.products?.length) return null;
    if (kpis.revenue.value <= 0) return null;
    return {
      product: topProducts.products[0],
      pct: topProducts.products[0].revenue / kpis.revenue.value,
    };
  }, [kpis, topProducts]);

  const topMarket = useMemo(() => {
    if (!isAll) return null;
    const active = (stores?.stores ?? []).filter((s) => s.revenue > 0);
    if (active.length <= 1) return null; // No concentration story to tell.
    const total = active.reduce((s, x) => s + x.revenue, 0);
    if (total <= 0) return null;
    const top = active[0]; // store-performance returns sorted desc by revenue
    return {
      store: top,
      pct: top.revenue / total,
    };
  }, [isAll, stores]);

  if (kpisError) {
    return (
      <div className="mb-4 md:mb-6">
        <Card>
          <CardBody>
            <ErrorState
              error={kpisError}
              onRetry={() => mutateKpis()}
              compact
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (kpisLoading || !kpis) {
    return (
      <StripShell>
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonTile key={i} />
        ))}
      </StripShell>
    );
  }

  return (
    <StripShell>
      <SignalTile
        label="Уникални клиенти"
        value={fmtInt(kpis.customers.value)}
        pct={kpis.customers.change}
      />
      <SignalTile
        label="Стойност / клиент"
        value={fmtEur(revenuePerCustomer, 0)}
        trail={
          kpis.customers.value > 0
            ? `от ${fmtInt(kpis.customers.value)} клиенти`
            : "няма клиенти"
        }
      />
      <SignalTile
        label="Възстановени"
        value={refundRate === null ? "—" : fmtPct(refundRate, 1)}
        trail={
          kpis.refunded.value > 0
            ? fmtEur(kpis.refunded.value, 0)
            : "без за периода"
        }
        // Lower is better — inverse colour logic on the (unused) delta.
        inverse
      />
      {topProductShare && (
        <SignalTile
          label="Топ продукт дял"
          value={fmtPct(topProductShare.pct, 0)}
          trail={topProductShare.product.title}
        />
      )}
      {topMarket && (
        <SignalTile
          label="Топ пазар"
          value={fmtPct(topMarket.pct, 0)}
          leading={<MarketFlag market={topMarket.store.marketCode} size={14} />}
          trail={topMarket.store.storeName}
        />
      )}
    </StripShell>
  );
}
