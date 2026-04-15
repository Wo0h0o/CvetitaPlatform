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
