import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import ExcelJS from "exceljs";
import { getUserContext, isManagerOrAdmin } from "@/lib/user-role";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  computeMonthlyTotals,
  computeDayHours,
  isWorkday,
  monthRange,
  toIsoDate,
  WORKDAY_START_HHMM,
  WORKDAY_END_HHMM,
  type HrDayEvent,
} from "@/lib/hr";
import { logger, requestMeta } from "@/lib/logger";

function getSupabase(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

const TYPE_LABEL: Record<string, string> = {
  absence: "Отсъствие",
  overtime: "Допълнителни часове",
  sick: "Болничен",
  paid_leave: "Платен отпуск",
  unpaid_leave: "Неплатен отпуск",
};

const COLOR_BY_TYPE: Record<string, string> = {
  paid_leave: "FFE9D5FF",   // soft purple
  unpaid_leave: "FFE5E7EB", // soft gray
  sick: "FFDBEAFE",         // soft blue
  absence: "FFFFEDD5",      // soft orange
  overtime: "FFD1FAE5",     // soft green
};

/**
 * GET /api/hr/export?month=YYYY-MM → .xlsx workbook with one sheet per worker
 * plus a "Резюме" sheet that aggregates monthly totals.
 *
 * Manager/admin only. Workbook structure:
 *   - "Резюме" sheet: one row per worker with worked/expected/leave/sick/overtime.
 *   - One sheet per worker named "<full_name>" listing every day of the
 *     month, with default 08:00–17:30 window pre-filled. Cells get tinted
 *     when the day has an event (full-day off → whole row tinted; partial
 *     events listed in a "Бележки" column).
 */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const monthParam = req.nextUrl.searchParams.get("month");
  const ref = monthParam ? new Date(monthParam + "-01T00:00:00") : new Date();
  if (Number.isNaN(ref.getTime())) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const { start, end } = monthRange(ref);
  const startIso = toIsoDate(start);
  const endIso = toIsoDate(end);
  const monthLabel = ref.toLocaleDateString("bg-BG", { month: "long", year: "numeric" });

  try {
    const supabase = getSupabase(req);

    // Workers
    const { data: members } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", ctx.organizationId)
      .eq("role", "worker");
    const workerIds = (members ?? []).map((m) => m.user_id);

    if (workerIds.length === 0) {
      return NextResponse.json({ error: "Няма работници в организацията" }, { status: 404 });
    }

    // Profiles
    const { data: profiles } = await supabase
      .from("hr_profiles")
      .select("user_id, full_name, job_title")
      .in("user_id", workerIds);
    const profileByUser = new Map(
      (profiles ?? []).map((p) => [p.user_id as string, p])
    );

    // Emails (fallback display name)
    const emailByUser = new Map<string, string>();
    await Promise.all(
      workerIds.map(async (uid) => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
        if (data?.user?.email) emailByUser.set(uid, data.user.email);
      })
    );

    // All events for the month, all workers
    const { data: allEvents } = await supabase
      .from("hr_day_events")
      .select("id, user_id, event_date, event_type, start_time, end_time, reason")
      .eq("organization_id", ctx.organizationId)
      .gte("event_date", startIso)
      .lte("event_date", endIso)
      .in("user_id", workerIds);

    const eventsByUser = new Map<string, HrDayEvent[]>();
    for (const e of (allEvents ?? []) as HrDayEvent[]) {
      const arr = eventsByUser.get(e.user_id) ?? [];
      arr.push(e);
      eventsByUser.set(e.user_id, arr);
    }

    // ---------- Build workbook ----------
    const wb = new ExcelJS.Workbook();
    wb.creator = "Цветита Командния Център";
    wb.created = new Date();

    // Summary sheet
    const summary = wb.addWorksheet("Резюме");
    summary.columns = [
      { header: "Работник", key: "name", width: 30 },
      { header: "Длъжност", key: "role", width: 22 },
      { header: "Имейл", key: "email", width: 28 },
      { header: "Изработени часове", key: "worked", width: 18 },
      { header: "Очаквани часове", key: "expected", width: 18 },
      { header: "Платен отпуск (дни)", key: "paid", width: 18 },
      { header: "Неплатен отпуск (дни)", key: "unpaid", width: 20 },
      { header: "Болнични (дни)", key: "sick", width: 16 },
      { header: "Overtime (часове)", key: "overtime", width: 18 },
    ];
    summary.getRow(1).font = { bold: true };
    summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

    const sortedWorkers = [...workerIds].sort((a, b) => {
      const an = profileByUser.get(a)?.full_name ?? emailByUser.get(a) ?? a;
      const bn = profileByUser.get(b)?.full_name ?? emailByUser.get(b) ?? b;
      return an.localeCompare(bn, "bg");
    });

    for (const uid of sortedWorkers) {
      const profile = profileByUser.get(uid);
      const events = eventsByUser.get(uid) ?? [];
      const totals = computeMonthlyTotals(start, end, events);
      summary.addRow({
        name: profile?.full_name ?? emailByUser.get(uid) ?? "(без име)",
        role: profile?.job_title ?? "",
        email: emailByUser.get(uid) ?? "",
        worked: Number(totals.workedHours.toFixed(2)),
        expected: totals.expectedHours,
        paid: totals.paidLeaveDays,
        unpaid: totals.unpaidLeaveDays,
        sick: totals.sickDays,
        overtime: Number(totals.overtimeHours.toFixed(2)),
      });
    }

    // Per-worker sheets
    for (const uid of sortedWorkers) {
      const profile = profileByUser.get(uid);
      const displayName = profile?.full_name ?? emailByUser.get(uid) ?? uid.slice(0, 8);
      // Excel sheet names are limited to 31 chars and forbid: \ / ? * [ ]
      const safeName = displayName.replace(/[\\/?*[\]:]/g, " ").slice(0, 28);
      const ws = wb.addWorksheet(safeName || "Работник");

      ws.columns = [
        { header: "Дата", key: "date", width: 12 },
        { header: "Ден", key: "weekday", width: 8 },
        { header: "Тип", key: "kind", width: 22 },
        { header: "Начало", key: "start", width: 9 },
        { header: "Край", key: "end", width: 9 },
        { header: "Изработени часове", key: "hours", width: 18 },
        { header: "Бележки", key: "notes", width: 40 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

      // Group events by date for this worker
      const evByDate = new Map<string, HrDayEvent[]>();
      for (const e of eventsByUser.get(uid) ?? []) {
        const arr = evByDate.get(e.event_date) ?? [];
        arr.push(e);
        evByDate.set(e.event_date, arr);
      }

      const cur = new Date(start);
      while (cur <= end) {
        const iso = toIsoDate(cur);
        const dayEvents = evByDate.get(iso) ?? [];
        const wd = isWorkday(cur);
        const dayCalc = computeDayHours(cur, dayEvents);

        const fullDayOff = dayEvents.find((e) =>
          ["sick", "paid_leave", "unpaid_leave"].includes(e.event_type)
        );

        const weekdayName = ["Нед", "Пон", "Вт", "Ср", "Чет", "Пет", "Съб"][cur.getDay()];

        let kind = wd ? "Работен" : "Уикенд";
        const startCell = wd && !fullDayOff ? WORKDAY_START_HHMM : "";
        const endCell = wd && !fullDayOff ? WORKDAY_END_HHMM : "";
        let notes = "";

        if (fullDayOff) {
          kind = TYPE_LABEL[fullDayOff.event_type];
          notes = fullDayOff.reason ?? "";
        } else if (dayEvents.length > 0) {
          notes = dayEvents
            .map((e) => {
              const range =
                e.start_time && e.end_time
                  ? `${e.start_time.slice(0, 5)}–${e.end_time.slice(0, 5)} `
                  : "";
              const r = e.reason ? ` (${e.reason})` : "";
              return `${range}${TYPE_LABEL[e.event_type]}${r}`;
            })
            .join("; ");
        }

        const row = ws.addRow({
          date: iso,
          weekday: weekdayName,
          kind,
          start: startCell,
          end: endCell,
          hours: Number(dayCalc.worked.toFixed(2)),
          notes,
        });

        if (fullDayOff) {
          const color = COLOR_BY_TYPE[fullDayOff.event_type];
          if (color) {
            row.eachCell((cell) => {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
            });
          }
        } else if (dayEvents.length > 0) {
          // Partial day: tint the notes cell only by the strongest event type
          const overtime = dayEvents.find((e) => e.event_type === "overtime");
          const absence = dayEvents.find((e) => e.event_type === "absence");
          const pick = overtime ?? absence;
          if (pick) {
            const c = COLOR_BY_TYPE[pick.event_type];
            row.getCell("notes").fill = { type: "pattern", pattern: "solid", fgColor: { argb: c } };
          }
        } else if (!wd) {
          row.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
          });
        }

        cur.setDate(cur.getDate() + 1);
      }

      // Totals row at the bottom
      const totals = computeMonthlyTotals(start, end, eventsByUser.get(uid) ?? []);
      ws.addRow({});
      const totalsRow = ws.addRow({
        date: "Общо",
        weekday: "",
        kind: "",
        start: "",
        end: "",
        hours: Number(totals.workedHours.toFixed(2)),
        notes: `Очаквани: ${totals.expectedHours}ч · Платен: ${totals.paidLeaveDays}д · Неплатен: ${totals.unpaidLeaveDays}д · Болничен: ${totals.sickDays}д · Overtime: ${totals.overtimeHours.toFixed(2)}ч`,
      });
      totalsRow.font = { bold: true };
    }

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `Grafik-${ctx.organizationId.slice(0, 8)}-${monthParam ?? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`}.xlsx`;

    void monthLabel; // future use: header banner in workbook
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("HR export failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to export" }, { status: 500 });
  }
}
