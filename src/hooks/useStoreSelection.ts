"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Store selection state — URL param is canonical, localStorage is the
 * "remember my last store" fallback.
 *
 * Hydration note: the previous version read localStorage inside a
 * useMemo. That returns "all" on the server (no window) and the stored
 * value on the very first client render — a hydration mismatch React
 * warns about, and a correctness hazard.
 *
 * Fix: the localStorage fallback resolves AFTER mount via useEffect.
 * Server render and first client render both compute the same value
 * (URL param, or "all"), so hydration is clean. The effect then adopts
 * the stored value on the next render if the URL didn't pin one.
 *
 * Trade-off (accepted, see audit action plan): when the operator has a
 * non-default store remembered and lands on a URL without `?store=`,
 * the page fetches once with "all" then re-fetches with the stored
 * store after the mount effect. One extra fetch on initial load only;
 * SWR dedups everything after. The alternative — reading localStorage
 * during render — brings the hydration bug back. Correctness wins.
 */
export function useStoreSelection() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const urlStore = searchParams.get("store");

  // null until the post-mount effect resolves it. Server + first client
  // render both see null → no hydration drift.
  const [storedStore, setStoredStore] = useState<string | null>(null);
  useEffect(() => {
    setStoredStore(localStorage.getItem("selectedStore"));
  }, []);

  // URL param wins; localStorage is the fallback; "all" is the floor.
  const selectedStore = urlStore || storedStore || "all";
  const isAll = selectedStore === "all";

  const storeParam = useMemo(
    () => `stores=${encodeURIComponent(selectedStore)}`,
    [selectedStore]
  );

  const setStore = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id === "all") {
        params.delete("store");
      } else {
        params.set("store", id);
      }
      if (typeof window !== "undefined") {
        localStorage.setItem("selectedStore", id);
      }
      // Keep the in-memory fallback in sync so a later URL change that
      // drops `?store=` doesn't snap back to a stale stored value.
      setStoredStore(id);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { selectedStore, setStore, isAll, storeParam };
}
