/**
 * Shared SWR fetcher.
 *
 * Same one-liner was duplicated in 25+ page files. Centralising means:
 *   - One place to add timeout / abort behaviour later
 *   - One place to thread error handling
 *   - Less import noise on pages
 *
 * Pages that need request-specific behaviour can still define a local
 * fetcher — this is just the sensible default.
 */
export const fetcher = (url: string) => fetch(url).then((r) => r.json());
