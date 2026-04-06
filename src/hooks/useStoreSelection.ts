"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useMemo, useCallback } from "react";

export function useStoreSelection() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const selectedStore = useMemo(() => {
    const param = searchParams.get("store");
    if (param) return param;

    // Fallback to localStorage
    if (typeof window !== "undefined") {
      return localStorage.getItem("selectedStore") || "all";
    }
    return "all";
  }, [searchParams]);

  const isAll = selectedStore === "all";

  const storeParam = useMemo(() => {
    return `stores=${encodeURIComponent(selectedStore)}`;
  }, [selectedStore]);

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
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { selectedStore, setStore, isAll, storeParam };
}
