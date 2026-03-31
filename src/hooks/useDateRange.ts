"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useMemo, useCallback } from "react";
import { getDateRange, type DatePreset, type DateRange } from "@/lib/dates";

export function useDateRange(): DateRange & {
  setPreset: (preset: DatePreset) => void;
  setCustomRange: (from: string, to: string) => void;
  queryString: string;
} {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const preset = (searchParams.get("preset") as DatePreset) || "30d";
  const customFrom = searchParams.get("from") || undefined;
  const customTo = searchParams.get("to") || undefined;

  const range = useMemo(
    () => getDateRange(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("preset", range.preset);
    if (range.preset === "custom") {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    return params.toString();
  }, [range]);

  const setPreset = useCallback(
    (newPreset: DatePreset) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("preset", newPreset);
      params.delete("from");
      params.delete("to");
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("preset", "custom");
      params.set("from", from);
      params.set("to", to);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { ...range, setPreset, setCustomRange, queryString };
}
