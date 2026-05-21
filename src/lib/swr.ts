/**
 * SWR fetcher + ApiError contract for the analytics surface.
 *
 * The original `fetcher` here was a single line —
 *   const fetcher = (url) => fetch(url).then(r => r.json());
 * — and almost nothing in /sales imported it. 17 components defined
 * their own copy and every copy quietly swallowed `!res.ok`. A 500
 * from an API route returned `{ error: "..." }` and rendered as if
 * the data were just empty. Operator could not tell "no orders today"
 * from "the server is on fire".
 *
 * This file fixes that. `jsonFetcher` enforces three contracts:
 *
 *   1. HTTP status check — non-2xx throws.
 *   2. Body shape — Next.js API routes use `{ error: "msg" }` for
 *      structured failures (per CLAUDE.md "API routes return JSON,
 *      handle errors gracefully"). We surface that string.
 *   3. Typed error — `ApiError` carries status + url + raw body so
 *      callers (and the `<ErrorState />` component) can render
 *      operator-grade messages instead of "Error: undefined".
 *
 * Companion: `useAnalyticsSWR` in `@/hooks/useAnalyticsSWR.ts` wraps
 * useSWR with this fetcher + the platform's standard cache settings
 * (5-minute refresh, no focus revalidate). 90% of /sales SWR calls
 * boil down to one line through that hook.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(opts: { status: number; url: string; body: unknown; message: string }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
  }
}

/**
 * JSON fetcher with proper error surfacing.
 *
 * Throws `ApiError` for:
 *   * HTTP !ok (status outside 2xx)
 *   * 2xx response with a body that includes `{ error: "..." }`
 *     (Next.js API-route convention for soft failures)
 *
 * Network errors / abort errors propagate as the native fetch reject
 * — SWR will treat them as failed requests and expose via the
 * hook's `error` field.
 */
export async function jsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);

  // Try to parse JSON even on non-ok — most API routes still return a
  // JSON body with a message we want to surface.
  let body: unknown = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      body = await res.json();
    } catch {
      // Malformed JSON body — fall through to status-based message.
    }
  }

  if (!res.ok) {
    const serverMessage =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${res.status} ${res.statusText}`.trim();
    throw new ApiError({
      status: res.status,
      url,
      body,
      message: serverMessage,
    });
  }

  // 2xx with `{ error: "..." }` is the Next.js soft-failure shape.
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    throw new ApiError({
      status: res.status,
      url,
      body,
      message: (body as { error: string }).error,
    });
  }

  return body as T;
}

/** @deprecated Use `jsonFetcher` instead — this swallows non-2xx
 *  responses, leaving the operator unable to distinguish "no data"
 *  from "server error". Retained only so existing call sites compile
 *  during migration. Remove once /sales has fully migrated. */
export const fetcher = (url: string) => fetch(url).then((r) => r.json());
