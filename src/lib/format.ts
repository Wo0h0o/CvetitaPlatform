/**
 * Shared number/date formatters used across the analytics surface.
 *
 * The platform displays БГ Cyrillic UI and EUR currency exclusively (see
 * memory: `Cvetita Shopify quick reference`). Format helpers go HERE — not
 * inline in pages — so swapping locale or currency precision is a one-file
 * change, not a 25-page hunt.
 */

const BG = "bg-BG";

/** "1 234,56 €" — full precision currency. */
export function fmtMoney(n: number): string {
  return n.toLocaleString(BG, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** "1 234 €" — rounded currency for hero KPIs and chart axes. */
export function fmtMoneyShort(n: number): string {
  return Math.round(n).toLocaleString(BG) + " €";
}

/** "1 234" — locale-aware integer. */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString(BG);
}

/** "54,2%" — fraction (0–1) rendered as percent with configurable precision. */
export function fmtPct(n: number, digits = 1): string {
  return (n * 100).toFixed(digits) + "%";
}

/** "3.70x" — ROAS-style ratio. */
export function fmtRoas(n: number): string {
  return n.toFixed(2) + "x";
}

/**
 * GA4's `date` dimension returns "YYYYMMDD" strings. For chart axes we
 * want compact "DD.MM" so a 30-day window reads cleanly at narrow widths.
 * Returns the input unchanged if it doesn't match the expected length.
 */
export function fmtGA4Date(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(6, 8)}.${yyyymmdd.slice(4, 6)}`;
}

/** ISO "YYYY-MM-DD" → "20 май" (short Bulgarian month). */
export function fmtBgDate(iso: string): string {
  return new Date(iso).toLocaleDateString(BG, { day: "numeric", month: "short" });
}
