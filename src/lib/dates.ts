export type DatePreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "custom";

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
  compFrom: string; // previous period for comparison
  compTo: string;
  preset: DatePreset;
  label: string;
}

// Sofia-anchored ISO date (YYYY-MM-DD). The business operates in
// Europe/Sofia and the server's date-window resolver is Sofia-anchored
// too, so the client must agree — otherwise the picker prefills inputs
// with a UTC date that's off by one between 22:00–23:59 UTC.
const SOFIA_TZ = "Europe/Sofia";
function formatSofiaDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SOFIA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// UTC formatter used only for the internal compFrom/compTo math below —
// those JS Dates are constructed as UTC midnight and offset by whole
// days, so we format them in UTC to get back the same ISO string.
function formatUTCDate(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function daysAgo(days: number): string {
  const today = formatSofiaDate(new Date());
  // Parse the Sofia ISO as UTC midnight and offset by whole days. We do
  // not use setUTCDate on a `new Date()` because that would subtract
  // from the *UTC* day, reintroducing the boundary bug we're fixing.
  const [y, m, d] = today.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) - days * 86_400_000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function getDateRange(preset: DatePreset, customFrom?: string, customTo?: string): DateRange {
  const today = formatSofiaDate(new Date());

  let from: string;
  let to: string;
  let label: string;

  switch (preset) {
    case "today":
      from = today;
      to = today;
      label = "Днес";
      break;
    case "yesterday":
      from = daysAgo(1);
      to = daysAgo(1);
      label = "Вчера";
      break;
    case "7d":
      from = daysAgo(6);
      to = today;
      label = "7 дни";
      break;
    case "30d":
      from = daysAgo(29);
      to = today;
      label = "30 дни";
      break;
    case "90d":
      from = daysAgo(89);
      to = today;
      label = "90 дни";
      break;
    case "custom":
      from = customFrom || daysAgo(29);
      to = customTo || today;
      label = `${from} — ${to}`;
      break;
    default:
      from = daysAgo(29);
      to = today;
      label = "30 дни";
  }

  // Comparison: previous period of equal length
  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T00:00:00Z");
  const diffMs = toDate.getTime() - fromDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const compToDate = new Date(fromDate);
  compToDate.setUTCDate(compToDate.getUTCDate() - 1);
  const compFromDate = new Date(compToDate);
  compFromDate.setUTCDate(compFromDate.getUTCDate() - diffDays);

  return {
    from,
    to,
    compFrom: formatUTCDate(compFromDate),
    compTo: formatUTCDate(compToDate),
    preset,
    label,
  };
}

// Re-export from `lib/format` for back-compat. The canonical home is
// `lib/format.ts`; this alias lets existing call sites keep importing
// from `@/lib/dates` while we migrate them.
//
// TODO: once the 4 callers (DateRangePicker, StoreTrend, SalesTrend,
// SalesHeroStrip — minus this one) have migrated their imports to
// `@/lib/format`, delete this re-export.
export { fmtBgDate as formatBgDate } from "@/lib/format";

// ============================================================
// Range arithmetic helpers
//
// Aggregations that come back as sums across the period (e.g.
// read_store_hour_weekday returns total revenue summed across every
// occurrence of weekday=W, hour=H in [from, to]) need a divisor
// before they can be presented as "typical Wednesday" or "typical
// 11am hour" — otherwise a 30-day window shows €18k for "Wednesday"
// where the operator reads it as "one Wednesday" and rightly
// concludes the numbers are off.
//
// Both helpers parse the YYYY-MM-DD strings as UTC midnight and do
// integer-day arithmetic. This is safe in any tz because each input
// already names a Sofia-anchored civil date — we never cross DST.
// ============================================================

/** Inclusive day count in [from, to]. */
export function daysInRange(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromTs = Date.UTC(fy, fm - 1, fd);
  const toTs = Date.UTC(ty, tm - 1, td);
  return Math.round((toTs - fromTs) / 86_400_000) + 1;
}

/** Count of each ISO weekday (1=Mon .. 7=Sun) within [from, to]
 *  inclusive. Returns a dense 7-key Map so callers can look up by
 *  weekday without missing-key guards. */
export function countWeekdaysInRange(
  from: string,
  to: string
): Map<number, number> {
  const counts = new Map<number, number>();
  for (let wd = 1; wd <= 7; wd++) counts.set(wd, 0);

  const [fy, fm, fd] = from.split("-").map(Number);
  const fromTs = Date.UTC(fy, fm - 1, fd);
  const total = daysInRange(from, to);

  for (let i = 0; i < total; i++) {
    const d = new Date(fromTs + i * 86_400_000);
    const jsDay = d.getUTCDay(); // 0=Sun .. 6=Sat
    const iso = jsDay === 0 ? 7 : jsDay; // 1=Mon .. 7=Sun
    counts.set(iso, (counts.get(iso) ?? 0) + 1);
  }
  return counts;
}
