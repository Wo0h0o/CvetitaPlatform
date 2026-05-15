/**
 * Bulgarian national holiday calendar (Кодекс на труда, чл. 154).
 *
 * Fixed dates + Orthodox Easter cluster (Велики петък, Велика събота,
 * Великден неделя, Втори ден на Великден понеделник). When an official
 * holiday lands on Sat/Sun we add a compensation day on the next working
 * day that isn't itself a holiday — same rule the labour code uses.
 *
 * Pure function, no I/O. Used by the /api/hr/holidays/seed endpoint and
 * also exposed so the UI can preview the seed before committing.
 */

export interface HolidayEntry {
  date: string;          // YYYY-MM-DD
  label: string;
  isCompensation: boolean;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Orthodox (Julian) Easter Sunday for `year`, converted to the Gregorian
 * calendar. Uses the classical Meeus algorithm. Valid 1900–2099 with the
 * fixed +13d Julian→Gregorian shift.
 */
export function orthodoxEaster(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31); // 3 = March, 4 = April
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(year, month - 1, day);
  // Julian → Gregorian conversion: +13 days for 1900-2099.
  julian.setDate(julian.getDate() + 13);
  return julian;
}

/**
 * Full BG holiday list for `year`, sorted ascending. Includes
 * compensation days for any official holiday that lands on Sat/Sun.
 */
export function bulgarianHolidays(year: number): HolidayEntry[] {
  const fixed: HolidayEntry[] = [
    { date: `${year}-01-01`, label: "Нова година", isCompensation: false },
    { date: `${year}-03-03`, label: "Ден на Освобождението на България", isCompensation: false },
    { date: `${year}-05-01`, label: "Ден на труда", isCompensation: false },
    { date: `${year}-05-06`, label: "Гергьовден, Ден на храбростта и Българската армия", isCompensation: false },
    { date: `${year}-05-24`, label: "Ден на българската просвета и култура и на славянската писменост", isCompensation: false },
    { date: `${year}-09-06`, label: "Ден на Съединението", isCompensation: false },
    { date: `${year}-09-22`, label: "Ден на Независимостта на България", isCompensation: false },
    { date: `${year}-12-24`, label: "Бъдни вечер", isCompensation: false },
    { date: `${year}-12-25`, label: "Рождество Христово", isCompensation: false },
    { date: `${year}-12-26`, label: "Втори ден на Коледа", isCompensation: false },
  ];

  // Easter cluster — Велики петък, Велика събота, Великден, Втори ден.
  const easter = orthodoxEaster(year);
  const dayMs = 86400000;
  const easterTs = easter.getTime();
  fixed.push(
    { date: toIso(new Date(easterTs - 2 * dayMs)), label: "Велики петък", isCompensation: false },
    { date: toIso(new Date(easterTs - 1 * dayMs)), label: "Велика събота", isCompensation: false },
    { date: toIso(easter), label: "Великден", isCompensation: false },
    { date: toIso(new Date(easterTs + 1 * dayMs)), label: "Втори ден на Великден", isCompensation: false }
  );

  fixed.sort((a, b) => a.date.localeCompare(b.date));

  // Compensation rule (чл. 154 ал. 2): a holiday on Sat/Sun rolls forward
  // to the next workday that isn't already a holiday or comp day.
  const taken = new Set(fixed.map((h) => h.date));
  const compensations: HolidayEntry[] = [];

  for (const h of fixed) {
    const d = new Date(h.date + "T00:00:00");
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) continue;
    // The Easter weekend itself (Велика събота Sat + Великден Sun) already
    // carries a comp day on Втори ден на Великден (Mon). No extra comp.
    if (h.label === "Велика събота" || h.label === "Великден") continue;

    const cursor = new Date(d);
    let safety = 14; // hard cap; in practice we move 1–2 days max
    while (safety-- > 0) {
      cursor.setDate(cursor.getDate() + 1);
      const wd = cursor.getDay();
      if (wd === 0 || wd === 6) continue;
      const iso = toIso(cursor);
      if (taken.has(iso)) continue;
      compensations.push({
        date: iso,
        label: `Почивен ден за ${h.label.split(",")[0]}`,
        isCompensation: true,
      });
      taken.add(iso);
      break;
    }
  }

  // Merge duplicates: when two holidays land on the same calendar date
  // (e.g. 2027 — Ден на труда + Велика събота both on 1 May) we keep one
  // row with the labels joined by " / ". isCompensation is true only if
  // BOTH source rows were comp days, which never happens in practice.
  const byDate = new Map<string, HolidayEntry>();
  for (const h of [...fixed, ...compensations]) {
    const existing = byDate.get(h.date);
    if (existing) {
      existing.label = `${existing.label} / ${h.label}`;
      existing.isCompensation = existing.isCompensation && h.isCompensation;
    } else {
      byDate.set(h.date, { ...h });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
