/**
 * HR domain helpers.
 *
 * Single source of truth for the implicit workday model:
 *   - Working days: Monday–Friday only.
 *   - Workday window: 08:00 → 17:30 (9h 30m wall time).
 *   - Lunch (1h) and two 15m breaks are unpaid and NOT marked in the schedule.
 *   - Effective worked hours per default day = 8h.
 *
 * hr_day_events only stores DEVIATIONS from the default. A clean Mon–Fri
 * row (no events) means "worked exactly 8 hours". This keeps the data
 * sparse and the UI simple — no need to materialize a row per day.
 */

export const DEFAULT_WORKDAY_HOURS = 8;
export const WORKDAY_START_HHMM = "08:00";
export const WORKDAY_END_HHMM = "17:30";

export type HrEventType =
  | "absence"
  | "overtime"
  | "sick"
  | "paid_leave"
  | "unpaid_leave";

export interface HrDayEvent {
  id: number;
  user_id: string;
  event_date: string; // YYYY-MM-DD
  event_type: HrEventType;
  start_time: string | null; // HH:MM:SS
  end_time: string | null;   // HH:MM:SS
  reason: string | null;
}

/** True iff `date` falls on Mon–Fri. ISO-style, treats Sun=0 as weekend. */
export function isWorkday(date: Date): boolean {
  const d = date.getDay();
  return d >= 1 && d <= 5;
}

/** Returns YYYY-MM-DD for `date` interpreted as a calendar date (no TZ shift). */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Number of Mon–Fri days in `[start, end]` inclusive. */
export function countWorkdays(start: Date, end: Date): number {
  let n = 0;
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cur <= end) {
    if (isWorkday(cur)) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

/** First and last day of the month containing `date`. */
export function monthRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start, end };
}

/** "HH:MM:SS" or "HH:MM" → minutes since midnight. */
export function parseTimeToMinutes(t: string): number {
  const [hh, mm] = t.split(":");
  return Number(hh) * 60 + Number(mm);
}

/** Decimal hours between two HH:MM strings, end > start. */
export function diffHours(startHHMM: string, endHHMM: string): number {
  const mins = parseTimeToMinutes(endHHMM) - parseTimeToMinutes(startHHMM);
  return mins / 60;
}

/**
 * Compute effective worked hours for a single calendar day given the
 * list of hr_day_events on that day. Implicit rules:
 *   - Non-workday (Sat/Sun) base = 0h. Overtime still counts.
 *   - Workday base = 8h.
 *   - Full-day off types (sick / paid_leave / unpaid_leave) zero the day.
 *   - Partial absence subtracts the absence window from the 8h base.
 *     Overlapping absences are coalesced before subtraction.
 *   - Overtime adds (end - start) on top.
 */
export function computeDayHours(
  date: Date,
  events: HrDayEvent[]
): {
  worked: number;
  isFullDayOff: boolean;
  offType: HrEventType | null;
} {
  const fullDayOff = events.find((e) =>
    ["sick", "paid_leave", "unpaid_leave"].includes(e.event_type)
  );
  if (fullDayOff) {
    return { worked: 0, isFullDayOff: true, offType: fullDayOff.event_type };
  }

  const base = isWorkday(date) ? DEFAULT_WORKDAY_HOURS : 0;

  // Coalesce overlapping absences before subtracting (so two events 12–14 and
  // 13–15 count as 12–15, not 4h).
  const absences = events
    .filter((e) => e.event_type === "absence" && e.start_time && e.end_time)
    .map((e) => ({
      start: parseTimeToMinutes(e.start_time!),
      end: parseTimeToMinutes(e.end_time!),
    }))
    .sort((a, b) => a.start - b.start);

  let absenceMins = 0;
  let cursor = -1;
  for (const a of absences) {
    const s = Math.max(a.start, cursor);
    if (a.end > s) absenceMins += a.end - s;
    cursor = Math.max(cursor, a.end);
  }

  const overtimeMins = events
    .filter((e) => e.event_type === "overtime" && e.start_time && e.end_time)
    .reduce(
      (sum, e) =>
        sum + (parseTimeToMinutes(e.end_time!) - parseTimeToMinutes(e.start_time!)),
      0
    );

  return {
    worked: Math.max(0, base - absenceMins / 60) + overtimeMins / 60,
    isFullDayOff: false,
    offType: null,
  };
}

/**
 * Sum effective worked hours for a list of events across the month.
 * `holidays` is a set of YYYY-MM-DD strings for the org's national-holiday
 * calendar. A holiday landing on a Mon–Fri drops the day's expected hours
 * to zero (the worker is officially off) — overtime explicitly logged for
 * that day still counts as worked.
 */
export function computeMonthlyTotals(
  monthStart: Date,
  monthEnd: Date,
  events: HrDayEvent[],
  holidays: Set<string> = new Set()
): {
  workedHours: number;
  expectedHours: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  sickDays: number;
  overtimeHours: number;
  holidayDays: number;
} {
  const byDate = new Map<string, HrDayEvent[]>();
  for (const e of events) {
    const arr = byDate.get(e.event_date) ?? [];
    arr.push(e);
    byDate.set(e.event_date, arr);
  }

  let workedHours = 0;
  let expectedHours = 0;
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  let sickDays = 0;
  let overtimeHours = 0;
  let holidayDays = 0;

  const cur = new Date(monthStart);
  while (cur <= monthEnd) {
    const iso = toIsoDate(cur);
    const dayEvents = byDate.get(iso) ?? [];
    const wd = isWorkday(cur);
    const isHoliday = holidays.has(iso);

    if (wd && !isHoliday) expectedHours += DEFAULT_WORKDAY_HOURS;
    if (isHoliday && wd) holidayDays += 1;

    // Hours math: full-day off wins; otherwise we compute partials from
    // base. Holiday days have base=0 (no expectation), but overtime on
    // a holiday still adds to worked hours.
    const fullDayOff = dayEvents.find((e) =>
      ["sick", "paid_leave", "unpaid_leave"].includes(e.event_type)
    );
    if (fullDayOff) {
      if (fullDayOff.event_type === "paid_leave") paidLeaveDays += 1;
      if (fullDayOff.event_type === "unpaid_leave") unpaidLeaveDays += 1;
      if (fullDayOff.event_type === "sick") sickDays += 1;
    } else {
      const base = wd && !isHoliday ? DEFAULT_WORKDAY_HOURS : 0;
      const absences = dayEvents
        .filter((e) => e.event_type === "absence" && e.start_time && e.end_time)
        .map((e) => ({
          start: parseTimeToMinutes(e.start_time!),
          end: parseTimeToMinutes(e.end_time!),
        }))
        .sort((a, b) => a.start - b.start);
      let absMin = 0;
      let cursor = -1;
      for (const a of absences) {
        const s = Math.max(a.start, cursor);
        if (a.end > s) absMin += a.end - s;
        cursor = Math.max(cursor, a.end);
      }
      const otMin = dayEvents
        .filter((e) => e.event_type === "overtime" && e.start_time && e.end_time)
        .reduce(
          (s, e) =>
            s + (parseTimeToMinutes(e.end_time!) - parseTimeToMinutes(e.start_time!)),
          0
        );
      workedHours += Math.max(0, base - absMin / 60) + otMin / 60;
      overtimeHours += otMin / 60;
    }

    cur.setDate(cur.getDate() + 1);
  }

  return {
    workedHours,
    expectedHours,
    paidLeaveDays,
    unpaidLeaveDays,
    sickDays,
    overtimeHours,
    holidayDays,
  };
}

/** Basic Bulgarian EGN format check (10 digits + checksum). */
export function isValidEGN(egn: string): boolean {
  if (!/^\d{10}$/.test(egn)) return false;
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(egn[i]) * weights[i];
  const checksum = sum % 11 % 10;
  return checksum === Number(egn[9]);
}
