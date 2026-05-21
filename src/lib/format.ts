/**
 * Shared number / date formatters for the analytics surface.
 *
 * Single source of truth — DO NOT inline format helpers in pages.
 * Adding a new helper that already lives here ("just for this one chart")
 * is how a codebase ends up with 12 slightly-different `fmtEur`
 * definitions. If your number doesn't fit any helper below, add a new
 * named export here rather than rolling a one-off.
 *
 * Currency convention: every monetary number on the platform is in EUR
 * (memory rule "EUR / никога BGN/лв"). The suffix is the literal string
 * "EUR" — not the "€" symbol — because the operator reads side-by-side
 * with Shopify exports that print "EUR", and the consistency is worth
 * the four characters.
 *
 * Percent convention: `fmtPct` accepts a FRACTION (0..1). Pass 0.54,
 * not 54. The math stays honest; if you computed a percent value
 * already, divide by 100 before formatting (then the call site reads
 * "this is a fraction" not "this is mystery units").
 */

const BG = "bg-BG";

// ============================================================
// Currency
// ============================================================

/**
 * "1 234 EUR" rounded to `dp` decimal places (default 0).
 * Use for hero KPIs, chart axes, table cells where precision under the
 * decimal point would be noise. Pass `dp=2` when the figure already has
 * cents that matter (e.g. AOV, individual order totals).
 */
export function fmtEur(n: number, dp = 0): string {
  return (
    n.toLocaleString(BG, {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }) + " EUR"
  );
}

/** "1 234,56 EUR" — full 2-decimal precision. Shortcut for `fmtEur(n, 2)`. */
export function fmtEurFull(n: number): string {
  return fmtEur(n, 2);
}

/**
 * Compact k-notation for chart cells that have to fit in 36-44px.
 * "847" / "1.5k" / "12k" / "1.2M". No currency suffix — the chart's
 * axis already declares EUR; tacking it on every cell would saturate.
 */
export function fmtCompactEur(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

// ============================================================
// Integers / counts
// ============================================================

/**
 * "1 234" — locale-grouped integer. Does NOT round, so fractional
 * inputs render with a comma decimal. Use `Math.round(n)` at the call
 * site if you specifically want rounding; the helper stays honest
 * about what you passed it.
 */
export function fmtInt(n: number): string {
  return n.toLocaleString(BG);
}

/** Compact k-notation for integer counts ("12.3k orders"). */
export function fmtCompactInt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ============================================================
// Percent / ratio
// ============================================================

/**
 * "54,2%" — fraction (0..1) rendered as percent. Pass `0.54`, not `54`.
 * `digits` controls decimal places (default 1).
 *
 * If you have a percent-already value (e.g. CTR = 2.5 meaning 2.5%),
 * either divide by 100 first or use `fmtPctValue` directly — naming
 * matters because the call site should read like the math it's doing.
 */
export function fmtPct(n: number, digits = 1): string {
  return (n * 100).toFixed(digits) + "%";
}

/**
 * "54,2%" — percent-already input (0..100). Use when the value is
 * already a percentage (e.g. computed as `(part/whole)*100` upstream).
 * Adds a single multiplication-free path so call sites that have a
 * percent in hand don't have to divide just to multiply.
 */
export function fmtPctValue(n: number, digits = 1): string {
  return n.toFixed(digits) + "%";
}

/** "3.70x" — ROAS-style ratio. */
export function fmtRoas(n: number): string {
  return n.toFixed(2) + "x";
}

// ============================================================
// Dates
// ============================================================

/**
 * GA4's `date` dimension returns "YYYYMMDD" strings. Renders compact
 * "DD.MM" so a 30-day window reads cleanly at narrow widths. Returns
 * the input unchanged if it doesn't match the expected length.
 */
export function fmtGA4Date(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(6, 8)}.${yyyymmdd.slice(4, 6)}`;
}

/** ISO "YYYY-MM-DD" → "20 май" (short Bulgarian month). */
export function fmtBgDate(iso: string): string {
  return new Date(iso).toLocaleDateString(BG, {
    day: "numeric",
    month: "short",
  });
}

/** ISO "YYYY-MM-DD" → "Пон, 20 май" — adds short weekday for tooltip
 *  headers where the operator wants "Friday or off-rhythm Tuesday?"
 *  context without counting back on the calendar. */
export function fmtBgDateWithWeekday(iso: string): string {
  const wd = new Intl.DateTimeFormat(BG, { weekday: "short" })
    .format(new Date(iso))
    .replace(".", "");
  const cap = wd.charAt(0).toUpperCase() + wd.slice(1);
  return `${cap}, ${fmtBgDate(iso)}`;
}

/**
 * Synthetic ISO "YYYY-MM-DDTHH:MM:SS" → "HH:MM". The hourly trend
 * endpoint emits timestamps without timezone suffix; parsing via
 * `new Date(iso)` would shift them to the browser's local zone, so
 * we slice instead. Caller should append " ч." in BG context.
 */
export function fmtHourFromIso(iso: string): string {
  return iso.slice(11, 16);
}

// ============================================================
// Legacy aliases — kept while non-/sales callers migrate.
//
// `fmtMoney`/`fmtMoneyShort` used "€" symbol; the canonical now is
// "EUR" suffix. Callers (`KpiStrip`, `google-ads/page.tsx`) see the
// label flip on next deploy; visual change is consistent across the
// platform but trivially cosmetic. Remove these aliases once all
// consumers have migrated to `fmtEur*`.
// ============================================================

/** @deprecated Use `fmtEurFull(n)` instead. Will be removed once
 *  KpiStrip and google-ads/page.tsx migrate. */
export const fmtMoney = fmtEurFull;

/** @deprecated Use `fmtEur(n)` instead. Will be removed once
 *  KpiStrip and google-ads/page.tsx migrate. */
export const fmtMoneyShort = fmtEur;
