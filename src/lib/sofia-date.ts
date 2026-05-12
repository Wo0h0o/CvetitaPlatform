/**
 * Sofia-timezone date helpers.
 *
 * All dashboard and cron routes anchor date windows to Europe/Sofia (the
 * business operating timezone), not server UTC. Keep these helpers in one
 * place so `top-strip/route.ts`, `home/stores/route.ts`, and
 * `cron/meta-sync/route.ts` can't drift apart.
 *
 * Audit ref: docs/audits/2026-04-15-w3-audit-findings.md §2.8
 */

const SOFIA_TZ = "Europe/Sofia";

/** ISO date ('YYYY-MM-DD') in Europe/Sofia for a given JS Date (defaults to now). */
export function sofiaDate(d: Date = new Date()): string {
  // en-CA locale → 'YYYY-MM-DD'
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SOFIA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Fractional hours elapsed in the current Sofia day (0-24). */
export function sofiaHoursElapsed(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SOFIA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Intl sometimes returns "24" for midnight; normalise.
  const h = get("hour") % 24;
  const m = get("minute");
  const s = get("second");
  return h + m / 60 + s / 3600;
}

/**
 * Return a date string N days before the given ISO date.
 *
 * Safe for day-boundary math because we only do whole-day arithmetic — we
 * parse YYYY-MM-DD as UTC midnight, subtract, and re-format. No TZ
 * conversion on the offset itself (that's the point: the input and output
 * are both Sofia-anchored date strings).
 */
export function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) - days * 86_400_000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** ISO dates for the last N days ending at `todayIso` (oldest first). */
export function lastNDates(n: number, todayIso: string): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(shiftDate(todayIso, i));
  }
  return out;
}

// ============================================================
// Date-window resolver — shared between dashboard API routes that accept
// a `preset` query param (today / yesterday / 7d / 30d / 90d / custom).
//
// All relative presets anchor to the current Sofia day. Custom uses the
// from/to provided by the client verbatim. Comparison window is the
// equal-length period immediately preceding `from`.
//
// Lives in sofia-date so server routes don't reach into client-only
// `lib/dates.ts` (which formats in UTC and is incorrect near the Sofia
// day boundary).
// ============================================================

export type DateWindowPreset =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "90d"
  | "custom";

export interface DateWindow {
  /** Resolved start date (YYYY-MM-DD, Sofia-anchored for relative presets). */
  from: string;
  /** Resolved end date inclusive. */
  to: string;
  /** Comparison-period start: equal length immediately before `from`. */
  compFrom: string;
  /** Comparison-period end (the day before `from`). */
  compTo: string;
  /** Echoed preset for convenience. */
  preset: DateWindowPreset;
  /** True iff window collapses to the current Sofia day (preset=today). */
  isToday: boolean;
  /** Inclusive day count of the primary window. */
  days: number;
}

const VALID_PRESETS: DateWindowPreset[] = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "90d",
  "custom",
];

function isValidIsoDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split("-").map(Number);
  const [y2, m2, d2] = toIso.split("-").map(Number);
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Resolve a date window from URL query params. Caller passes
 * `searchParams` (URLSearchParams or a similar `get(name)` interface).
 *
 * Default preset is "today" — matches the dashboard home where the
 * pacing tiles only make sense for the current day. Pages that prefer a
 * different default should pass it explicitly.
 */
export function resolveDateWindow(
  searchParams: { get: (name: string) => string | null },
  defaultPreset: DateWindowPreset = "today"
): DateWindow {
  const raw = searchParams.get("preset");
  const preset: DateWindowPreset =
    raw && (VALID_PRESETS as string[]).includes(raw)
      ? (raw as DateWindowPreset)
      : defaultPreset;

  const today = sofiaDate();
  let from: string;
  let to: string;

  switch (preset) {
    case "today":
      from = today;
      to = today;
      break;
    case "yesterday":
      from = shiftDate(today, 1);
      to = from;
      break;
    case "7d":
      from = shiftDate(today, 6);
      to = today;
      break;
    case "30d":
      from = shiftDate(today, 29);
      to = today;
      break;
    case "90d":
      from = shiftDate(today, 89);
      to = today;
      break;
    case "custom": {
      const customFrom = searchParams.get("from");
      const customTo = searchParams.get("to");
      if (!isValidIsoDate(customFrom) || !isValidIsoDate(customTo)) {
        // Malformed custom range — fall back silently to 30d so the UI
        // never blanks out. Client is expected to enforce shape.
        from = shiftDate(today, 29);
        to = today;
      } else {
        from = customFrom;
        to = customTo > customFrom ? customTo : customFrom;
      }
      break;
    }
  }

  // Clamp future endpoints to today. Picking a future window through the
  // custom picker would otherwise return 0-everywhere with "-100% vs
  // предходен период" — technically true, practically baffling.
  if (to > today) to = today;
  if (from > today) from = today;

  // Cap window length at 366 days. Long custom ranges silently truncate
  // inside expandRange() in the routes, which means partial data with
  // no signal — better to clamp visibly here at the source.
  const MAX_DAYS = 366;
  let days = daysBetween(from, to);
  if (days > MAX_DAYS) {
    from = shiftDate(to, MAX_DAYS - 1);
    days = MAX_DAYS;
  }

  const compTo = shiftDate(from, 1);
  const compFrom = shiftDate(compTo, days - 1);

  return {
    from,
    to,
    compFrom,
    compTo,
    preset,
    isToday: preset === "today",
    days,
  };
}

/** 'YYYY-MM-DD HH:mm' in Europe/Sofia (used for human-readable note timestamps). */
export function sofiaDateTimeLabel(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SOFIA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
