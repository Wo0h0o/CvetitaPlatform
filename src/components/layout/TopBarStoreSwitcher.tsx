"use client";

import { useState, useRef, useEffect, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { ChevronDown } from "lucide-react";
import { MarketFlag } from "@/components/shared/MarketFlag";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ============================================================
// Types (mirror /api/dashboard/home/stores)
// ============================================================

type BorderLevel = "red" | "amber" | "green";

interface StoreCardData {
  storeId: string;
  marketCode: string;
  name: string;
  sparkline14d: number[];
  roasLast24h: number;
  roasMedian14d: number;
  borderLevel: BorderLevel;
  lastSyncedAt: string | null;
}

interface StoresResponse {
  stores: StoreCardData[];
}

// ============================================================
// URL-based market detection
// ============================================================

// Explicit allowlist — [a-z]{2,} would swallow legacy /ads/campaigns and
// /ads/adsets sub-routes and render "🏬 ?" in the switcher. When adding a
// new market, also extend `HOME_MARKET_CODES` in `lib/store-market-resolver.ts`
// and `FLAG_BY_MARKET` in `api/dashboard/home/stores/route.ts`.
const ADS_PATH_RE = /^\/ads\/(bg|gr|ro)(\/|$)/;
const SALES_PATH_RE = /^\/sales\/store\/([a-f0-9-]+)/i;

/**
 * Determine whether the switcher should render for this path, and if so
 * which market is "current". We deliberately hide on `/` (the home page's
 * 3 cards are already the switcher) and anywhere we don't recognize.
 */
type SwitcherContext =
  | { kind: "ads"; market: string; basePath: string }
  | { kind: "sales"; storeId: string }
  | { kind: "hidden" };

function classifyPath(pathname: string): SwitcherContext {
  // Ads drill-down: /ads/bg or /ads/gr/anything
  const adsMatch = pathname.match(ADS_PATH_RE);
  if (adsMatch) {
    return {
      kind: "ads",
      market: adsMatch[1],
      // Base path is /ads/<market>; preserved so sub-routes (future W6)
      // swap just the segment.
      basePath: pathname,
    };
  }

  // Sales drill-down: /sales/store/UUID
  const salesMatch = pathname.match(SALES_PATH_RE);
  if (salesMatch) {
    return { kind: "sales", storeId: salesMatch[1] };
  }

  return { kind: "hidden" };
}

// ============================================================
// Visual helpers
// ============================================================

const BORDER_DOT: Record<BorderLevel, string> = {
  red: "bg-red",
  amber: "bg-orange",
  green: "bg-accent",
};

// ============================================================
// TopBarStoreSwitcher
// ============================================================

export function TopBarStoreSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // One ref per rendered option so arrow-key nav can move focus without
  // rerendering. Indexing mirrors the stores array order.
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Classify the current path outside the hook so the early `null` return
  // for hidden routes doesn't short-circuit any hooks below.
  const ctx = classifyPath(pathname);

  // Reuse the same /api/dashboard/home/stores endpoint that StoreMultiples
  // fetches on the home page — SWR dedupes across routes.
  //
  // refreshInterval: without this the switcher fetches once on mount and
  // stays frozen. Users who open Home → navigate to /ads/* would see stale
  // ROAS badges next to the current live KPIs on the drill-down page.
  // 60s matches StoreMultiples' cadence and the endpoint's s-maxage.
  const { data } = useSWR<StoresResponse>(
    ctx.kind === "hidden" ? null : "/api/dashboard/home/stores",
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60_000 }
  );

  // Memoize the stores array so the dependent Maps below have stable identity
  // across renders — fixes react-hooks/exhaustive-deps warning for `?? []`.
  const stores = useMemo(() => data?.stores ?? [], [data?.stores]);

  // marketCode → store, for quick lookup when on /sales/store/UUID
  const byMarket = useMemo(
    () => new Map(stores.map((s) => [s.marketCode, s])),
    [stores]
  );
  const byStoreId = useMemo(
    () => new Map(stores.map((s) => [s.storeId, s])),
    [stores]
  );

  // Determine the currently-selected store from the URL context.
  const current: StoreCardData | undefined = (() => {
    if (ctx.kind === "ads") return byMarket.get(ctx.market);
    if (ctx.kind === "sales") return byStoreId.get(ctx.storeId);
    return undefined;
  })();

  // Click-outside + Escape to close the dropdown. Matches StoreSelector UX.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
      return () => {
        document.removeEventListener("mousedown", handleClick);
        document.removeEventListener("keydown", handleKey);
      };
    }
  }, [open]);

  // When the dropdown opens, move keyboard focus to the current option (or
  // the first one) so arrow-keys can immediately move between choices.
  // Must run before the `hidden` early-return to satisfy rules-of-hooks.
  useEffect(() => {
    if (!open || stores.length === 0) return;
    const activeIdx = Math.max(
      0,
      stores.findIndex((s) => s.marketCode === current?.marketCode)
    );
    const t = setTimeout(() => optionRefs.current[activeIdx]?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, stores, current?.marketCode]);

  if (ctx.kind === "hidden") return null;

  // Switch target URL given a destination store and the current context.
  const targetUrl = (dest: StoreCardData): string => {
    if (ctx.kind === "ads") {
      // Replace just the `/ads/<market>` segment so any future sub-routes
      // (e.g. `/ads/bg/campaigns`) get the new market too.
      return ctx.basePath.replace(ADS_PATH_RE, `/ads/${dest.marketCode}$2`);
    }
    // Sales: swap the storeId segment — MARKET_STORE_MAP avoids a round-trip.
    return `/sales/store/${dest.storeId}`;
  };

  const handleSelect = (dest: StoreCardData) => {
    if (current?.marketCode === dest.marketCode) {
      setOpen(false);
      return;
    }
    setOpen(false);
    router.replace(targetUrl(dest));
  };

  const handleOptionKey = (
    e: ReactKeyboardEvent<HTMLDivElement>,
    idx: number,
    store: StoreCardData
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect(store);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      optionRefs.current[Math.min(idx + 1, stores.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      optionRefs.current[Math.max(idx - 1, 0)]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      optionRefs.current[stores.length - 1]?.focus();
    }
  };

  // Collapsed button: shows flag + border dot + chevron. The flag itself
  // identifies the market, so the old "RO" text chip next to it was
  // redundant (and on Windows without an emoji font it was rendering as
  // an ugly fallback next to the flag — literally "RO RO").
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 border border-border hover:border-border-strong transition-colors text-[13px] text-text cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Превключи магазин"
      >
        {current ? (
          <MarketFlag market={current.marketCode} size={16} labelled />
        ) : (
          <span className="text-[16px] leading-none" aria-hidden>
            🏬
          </span>
        )}
        {current && (
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${BORDER_DOT[current.borderLevel]}`}
            aria-hidden
          />
        )}
        <ChevronDown
          size={14}
          className={`text-text-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-64 bg-surface rounded-xl shadow-lg border border-border z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-150"
          role="listbox"
        >
          {stores.length === 0 ? (
            <div className="px-4 py-3 text-[13px] text-text-3">Зареждане…</div>
          ) : (
            stores.map((store, idx) => {
              const active = current?.marketCode === store.marketCode;
              return (
                // Rendered as a div (not button) per ARIA: an element with
                // role="option" must not also have the implicit role="button".
                // Keyboard affordances (Enter/Space to select, arrows to move)
                // are provided via the shared handleOptionKey.
                <div
                  key={store.marketCode}
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  onClick={() => handleSelect(store)}
                  onKeyDown={(e) => handleOptionKey(e, idx, store)}
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                    active
                      ? "bg-accent-soft text-accent font-medium"
                      : "text-text hover:bg-surface-2"
                  }`}
                >
                  <MarketFlag market={store.marketCode} size={16} labelled />
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${BORDER_DOT[store.borderLevel]}`}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{store.name}</span>
                  {store.roasLast24h > 0 && (
                    <span className="text-[11px] font-medium text-text-2 tabular-nums">
                      ROAS {store.roasLast24h.toFixed(2)}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
