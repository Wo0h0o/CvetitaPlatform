import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";
import { jsonFetcher, type ApiError } from "@/lib/swr";

/**
 * Standard SWR wrapper for analytics-surface fetches.
 *
 * Every chart, KPI, signal tile and list on /sales (and soon /traffic,
 * /products, /ads, /email, /customers) wants:
 *
 *   - The same JSON fetcher with proper `r.ok` and `body.error`
 *     handling (see `lib/swr.ts` jsonFetcher / ApiError).
 *   - A 5-minute background refresh so a tab left open doesn't get
 *     stale, but doesn't hammer the API either.
 *   - `revalidateOnFocus: false` so flicking between tabs doesn't
 *     re-fetch the same 30 keys six times.
 *
 * Before this hook 17 /sales components inlined those three settings
 * AND each defined their own local `const fetcher`. This is the
 * one-import replacement.
 *
 * Caller can still override any SWR option via the second argument
 * (e.g. `revalidateIfStale: false` for a card that should never
 * re-fetch in this session).
 *
 * Usage:
 *
 *   const { data, error, isLoading } =
 *     useAnalyticsSWR<TrendResponse>(`/api/sales/trend?${qs}`);
 *
 *   if (error) return <ErrorState error={error} />;
 *   if (isLoading) return <Skeleton />;
 *   // ...render data
 *
 * Null key (conditional fetch) works exactly like useSWR — pass null
 * to skip the fetch (e.g. when a dependency isn't ready yet).
 */
export function useAnalyticsSWR<T = unknown>(
  key: string | null,
  options?: SWRConfiguration<T, ApiError>
): SWRResponse<T, ApiError> {
  return useSWR<T, ApiError>(key, jsonFetcher<T>, {
    refreshInterval: 300_000,
    revalidateOnFocus: false,
    ...options,
  });
}
