"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Button } from "@/components/shared/Button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Modal } from "@/components/shared/Modal";
import { Skeleton } from "@/components/shared/Skeleton";
import { useToast } from "@/providers/ToastProvider";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type EventType = "absence" | "overtime" | "sick" | "paid_leave" | "unpaid_leave";

interface DayEvent {
  id: number;
  user_id: string;
  event_date: string;
  event_type: EventType;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

interface TeamWorker {
  user_id: string;
  full_name: string | null;
  email: string | null;
  job_title: string | null;
}

const TYPE_LABEL: Record<EventType, string> = {
  absence: "Отсъствие",
  overtime: "Допълнителни часове",
  sick: "Болничен",
  paid_leave: "Платен отпуск",
  unpaid_leave: "Неплатен отпуск",
};

const TYPE_COLOR: Record<EventType, string> = {
  absence: "bg-orange-soft text-orange",
  overtime: "bg-accent-soft text-accent",
  sick: "bg-blue-50 text-blue-700",
  paid_leave: "bg-purple-50 text-purple-700",
  unpaid_leave: "bg-gray-100 text-gray-700",
};

// Same family as TYPE_COLOR but only the background, used to tint the whole
// schedule cell when the entire day is off. Kept separate so the badge
// styling can keep stronger contrast without exploding the whole cell.
const FULL_DAY_BG: Record<EventType, string> = {
  absence: "",
  overtime: "",
  sick: "bg-blue-50",
  paid_leave: "bg-purple-50",
  unpaid_leave: "bg-gray-100",
};

// Status-dot colour per event type, used for the soft pill list inside a
// partial-event day. Solid dots read faster than text-only labels in a
// dense grid.
const TYPE_DOT: Record<EventType, string> = {
  absence: "bg-orange",
  overtime: "bg-accent",
  sick: "bg-blue-500",
  paid_leave: "bg-purple-500",
  unpaid_leave: "bg-gray-500",
};

const WEEKDAY_NAMES = ["Пон", "Вт", "Ср", "Чет", "Пет", "Съб", "Нед"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isWeekday(d: Date) {
  const x = d.getDay();
  return x >= 1 && x <= 5;
}
function isWeekend(d: Date) {
  const x = d.getDay();
  return x === 0 || x === 6;
}
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Build the list of week rows for the month: each week is a row of Mon–Sun
 * Date objects. Days outside the current month appear as nulls so the grid
 * keeps clean columns when the month starts mid-week or ends mid-week. */
function buildMonthWeeks(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  // Walk back to the Monday on or before the 1st.
  const cursor = new Date(first);
  while (cursor.getDay() !== 1) cursor.setDate(cursor.getDate() - 1);

  const weeks: (Date | null)[][] = [];
  while (cursor <= last) {
    const week: (Date | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() + i);
      week.push(d.getMonth() === month ? d : null);
    }
    weeks.push(week);
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

export default function SchedulePage() {
  const { toast } = useToast();
  const [refMonth, setRefMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const { data: me } = useSWR<{ role: string; userId: string }>("/api/me", fetcher);
  const isManager = me?.role === "admin" || me?.role === "manager";

  const searchParams = useSearchParams();
  const urlUserId = searchParams.get("userId");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(urlUserId);
  // Initialise to self once /api/me lands, unless a ?userId= was provided.
  // We only seed once — after that the user-driven dropdown controls the value.
  useEffect(() => {
    if (selectedUserId === null && me?.userId) setSelectedUserId(urlUserId ?? me.userId);
  }, [me?.userId, urlUserId, selectedUserId]);

  // Manager loads the team list for the dropdown. We reuse /api/hr/team which
  // also computes monthly totals — they're cheap to include and we'll show
  // them in the dropdown labels for context.
  const monthParam = `${refMonth.year}-${pad(refMonth.month + 1)}`;
  const { data: teamData } = useSWR<{ workers: (TeamWorker & { totals: { workedHours: number; expectedHours: number } })[] }>(
    isManager ? `/api/hr/team?month=${monthParam}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  // Day events for the visible month, scoped to the selected worker.
  // Memoised so downstream useMemo deps stay referentially stable across renders.
  const monthStart = useMemo(() => new Date(refMonth.year, refMonth.month, 1), [refMonth]);
  const monthEnd = useMemo(() => new Date(refMonth.year, refMonth.month + 1, 0), [refMonth]);
  const fromIso = isoDate(monthStart);
  const toIso = isoDate(monthEnd);

  const eventsKey = selectedUserId
    ? `/api/hr/day-events?from=${fromIso}&to=${toIso}&userId=${selectedUserId}`
    : null;
  const { data: eventsData, mutate: refreshEvents } = useSWR<{ events: DayEvent[] }>(
    eventsKey,
    fetcher,
    { revalidateOnFocus: false }
  );

  const eventsByDate = useMemo(() => {
    const m = new Map<string, DayEvent[]>();
    for (const e of eventsData?.events ?? []) {
      const arr = m.get(e.event_date) ?? [];
      arr.push(e);
      m.set(e.event_date, arr);
    }
    return m;
  }, [eventsData]);

  const weeks = useMemo(
    () => buildMonthWeeks(refMonth.year, refMonth.month),
    [refMonth]
  );

  const monthLabel = new Date(refMonth.year, refMonth.month, 1).toLocaleDateString("bg-BG", {
    month: "long",
    year: "numeric",
  });

  // Modal state for adding/editing day events.
  const [modalDate, setModalDate] = useState<string | null>(null);

  const handleCloseModal = () => setModalDate(null);

  const handleCreate = async (payload: {
    event_type: EventType;
    start_time: string | null;
    end_time: string | null;
    reason: string | null;
  }) => {
    if (!modalDate || !selectedUserId) return;
    try {
      const res = await fetch("/api/hr/day-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          event_date: modalDate,
          ...payload,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      await refreshEvents();
      handleCloseModal();
      toast("Записано", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Грешка", "error");
    }
  };

  const handleDelete = async (eventId: number) => {
    try {
      const res = await fetch(`/api/hr/day-events/${eventId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed");
      }
      await refreshEvents();
      toast("Изтрито", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Грешка", "error");
    }
  };

  const dayEventsForModal = modalDate ? eventsByDate.get(modalDate) ?? [] : [];

  // KPI strip: monthly worked/expected for the currently viewed user.
  // Computed inline rather than via /api/hr/team so it stays accurate for
  // workers viewing themselves (team endpoint is manager-gated).
  const kpi = useMemo(() => {
    if (!eventsData) return null;
    return computeMonthlyTotalsInline(monthStart, monthEnd, eventsData.events);
  }, [eventsData, monthStart, monthEnd]);

  const today = new Date();

  return (
    <>
      <PageHeader title="График" />

      {/* Toolbar: month nav + (manager only) worker select + KPI summary.
          Single rounded card so the controls float together as one Apple-like
          "navigation pill" above the calendar. */}
      <div className="bg-surface rounded-2xl shadow-sm px-3 py-2.5 mb-4 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="w-9 h-9 rounded-full flex items-center justify-center text-text-2 hover:bg-surface-2 cursor-pointer transition-colors"
            aria-label="Предишен месец"
            onClick={() =>
              setRefMonth(({ year, month }) => {
                const d = new Date(year, month - 1, 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })
            }
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-[15px] font-semibold text-text min-w-[140px] text-center capitalize">
            {monthLabel}
          </span>
          <button
            type="button"
            className="w-9 h-9 rounded-full flex items-center justify-center text-text-2 hover:bg-surface-2 cursor-pointer transition-colors"
            aria-label="Следващ месец"
            onClick={() =>
              setRefMonth(({ year, month }) => {
                const d = new Date(year, month + 1, 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })
            }
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setRefMonth({ year: today.getFullYear(), month: today.getMonth() })}
          className="px-3 h-8 rounded-full text-[12px] font-medium bg-surface-2 hover:bg-border text-text-2 cursor-pointer transition-colors"
        >
          Днес
        </button>

        {isManager && (
          <div className="flex items-center gap-2 ml-2">
            <span className="text-[12px] text-text-3">Виж:</span>
            <select
              className="bg-surface-2 border-0 rounded-full pl-3 pr-8 h-8 text-[13px] cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={selectedUserId ?? ""}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value={me?.userId ?? ""}>Аз</option>
              {(teamData?.workers ?? []).map((w) => (
                <option key={w.user_id} value={w.user_id}>
                  {w.full_name ?? w.email ?? w.user_id}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* KPI strip pushed to the right on wide screens, wraps naturally below. */}
        {kpi && (
          <div className="ml-auto flex items-center gap-3 text-[12px] tabular-nums">
            <span className="text-text-3">
              <span className="font-semibold text-text">{kpi.workedHours.toFixed(1)}</span>
              <span className="text-text-3"> / {kpi.expectedHours}ч</span>
            </span>
            {kpi.overtimeHours > 0 && (
              <span className="text-accent font-medium">+{kpi.overtimeHours.toFixed(1)}ч OT</span>
            )}
            {kpi.paidLeaveDays > 0 && (
              <span className="text-purple-700">{kpi.paidLeaveDays}д отпуск</span>
            )}
            {kpi.sickDays > 0 && (
              <span className="text-blue-700">{kpi.sickDays}д болн.</span>
            )}
          </div>
        )}
      </div>

      {/* Calendar tile grid. The container has a slightly tinted background
          so the gap between tiles reads as a hair-line separator without
          needing actual borders. */}
      {!eventsData ? (
        <Skeleton className="h-[560px] w-full rounded-2xl" />
      ) : (
        <div className="bg-surface-2/60 rounded-2xl p-2 sm:p-3 overflow-x-auto">
          {/* Weekday header row */}
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-2 min-w-[640px]">
            {WEEKDAY_NAMES.map((n, i) => {
              const isWknd = i >= 5;
              return (
                <div
                  key={n}
                  className={`text-[11px] font-medium uppercase tracking-wider px-2 ${
                    isWknd ? "text-text-3" : "text-text-2"
                  }`}
                >
                  {n}
                </div>
              );
            })}
          </div>

          {/* Day tiles flattened across 5–6 rows */}
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2 min-w-[640px]">
            {weeks.flatMap((week, wi) =>
              week.map((d, di) => {
                if (!d) {
                  return <div key={`${wi}-${di}`} className="rounded-xl bg-transparent" />;
                }
                const iso = isoDate(d);
                return (
                  <DayTile
                    key={iso}
                    date={d}
                    isToday={isSameDay(d, today)}
                    events={eventsByDate.get(iso) ?? []}
                    onClick={() => setModalDate(iso)}
                  />
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-text-3">
        {(Object.keys(TYPE_LABEL) as EventType[]).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${TYPE_DOT[t]}`} />
            {TYPE_LABEL[t]}
          </span>
        ))}
      </div>

      <Modal
        open={!!modalDate}
        onClose={handleCloseModal}
        title={
          modalDate
            ? new Date(modalDate + "T00:00:00").toLocaleDateString("bg-BG", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })
            : ""
        }
      >
        <DayModalContent
          existing={dayEventsForModal}
          onDelete={handleDelete}
          onCreate={handleCreate}
        />
      </Modal>
    </>
  );
}

/**
 * Apple-like day tile. Renders one of three layouts:
 *   1. Full-day off: tile tinted with the type's pastel, label centred.
 *   2. Working day with partial events: 8h baseline + soft pills for
 *      absence/overtime, max 2 visible, rest collapsed into a "+N още" chip.
 *   3. Plain day (incl. weekend with no events): just the date and an hours
 *      hint ("8ч" for weekdays, "—" for weekends to signal "няма очакване").
 */
function DayTile({
  date,
  isToday,
  events,
  onClick,
}: {
  date: Date;
  isToday: boolean;
  events: DayEvent[];
  onClick: () => void;
}) {
  const weekend = isWeekend(date);
  const fullDayOff = events.find((e) =>
    ["sick", "paid_leave", "unpaid_leave"].includes(e.event_type)
  );

  // Effective hours (mirrors lib/hr.computeDayHours).
  let worked = isWeekday(date) ? 8 : 0;
  if (fullDayOff) {
    worked = 0;
  } else {
    const parseMin = (t: string) => {
      const [h, m] = t.split(":");
      return Number(h) * 60 + Number(m);
    };
    const absences = events
      .filter((e) => e.event_type === "absence" && e.start_time && e.end_time)
      .map((e) => ({ start: parseMin(e.start_time!), end: parseMin(e.end_time!) }))
      .sort((a, b) => a.start - b.start);
    let absMin = 0;
    let cursor = -1;
    for (const a of absences) {
      const s = Math.max(a.start, cursor);
      if (a.end > s) absMin += a.end - s;
      cursor = Math.max(cursor, a.end);
    }
    const otMin = events
      .filter((e) => e.event_type === "overtime" && e.start_time && e.end_time)
      .reduce((s, e) => s + (parseMin(e.end_time!) - parseMin(e.start_time!)), 0);
    worked = Math.max(0, worked - absMin / 60) + otMin / 60;
  }

  const tileBase =
    "group rounded-xl shadow-sm hover:shadow-md transition-all duration-150 cursor-pointer min-h-[92px] sm:min-h-[112px] flex flex-col text-left";
  const tileTone = fullDayOff
    ? FULL_DAY_BG[fullDayOff.event_type]
    : weekend
      ? "bg-surface/70 hover:bg-surface"
      : "bg-surface hover:bg-surface-2";

  // Today indicator: small accent circle wrapping the date number.
  const dateNumber = isToday ? (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent text-white text-[13px] font-semibold leading-none">
      {date.getDate()}
    </span>
  ) : (
    <span
      className={`text-[15px] leading-none font-semibold ${
        weekend ? "text-text-3" : "text-text"
      }`}
    >
      {date.getDate()}
    </span>
  );

  // Right-side hours hint.
  let hoursHint: React.ReactNode;
  if (fullDayOff) {
    hoursHint = null; // The big centred label already tells the story.
  } else if (weekend && events.length === 0) {
    hoursHint = <span className="text-[11px] text-text-3">—</span>;
  } else {
    hoursHint = (
      <span className="text-[11px] tabular-nums text-text-3">{worked.toFixed(1)}ч</span>
    );
  }

  // Full-day off layout: centred label, dimmed date in corner.
  if (fullDayOff) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${tileBase} ${tileTone} p-2.5 items-stretch`}
      >
        <div className="flex items-center justify-between">{dateNumber}</div>
        <div className="flex-1 flex items-center justify-center px-1">
          <span
            className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLOR[fullDayOff.event_type]}`}
            title={fullDayOff.reason ?? ""}
          >
            {TYPE_LABEL[fullDayOff.event_type]}
          </span>
        </div>
      </button>
    );
  }

  // Working / weekend day: show partial events as soft pills with dot prefix.
  const VISIBLE = 2;
  const visible = events.slice(0, VISIBLE);
  const remaining = events.length - visible.length;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${tileBase} ${tileTone} p-2.5 items-stretch`}
    >
      <div className="flex items-center justify-between gap-1">
        {dateNumber}
        {hoursHint}
      </div>
      <div className="flex-1 mt-1.5 space-y-1 overflow-hidden">
        {visible.map((e) => (
          <div
            key={e.id}
            className="flex items-center gap-1.5 text-[11px] text-text-2 truncate"
            title={e.reason ?? ""}
          >
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${TYPE_DOT[e.event_type]}`}
            />
            {e.start_time && e.end_time && (
              <span className="tabular-nums text-text-3">
                {e.start_time.slice(0, 5)}
              </span>
            )}
            <span className="truncate">{TYPE_LABEL[e.event_type]}</span>
          </div>
        ))}
        {remaining > 0 && (
          <div className="text-[10px] text-text-3 pl-3">+{remaining} още</div>
        )}
      </div>
    </button>
  );
}

/**
 * Client-side mirror of lib/hr.computeMonthlyTotals — kept inline so the
 * schedule page doesn't pull a server-only module. Logic must stay in sync.
 */
function computeMonthlyTotalsInline(
  start: Date,
  end: Date,
  events: DayEvent[]
): {
  workedHours: number;
  expectedHours: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  sickDays: number;
  overtimeHours: number;
} {
  const parseMin = (t: string) => {
    const [h, m] = t.split(":");
    return Number(h) * 60 + Number(m);
  };
  const byDate = new Map<string, DayEvent[]>();
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

  const cur = new Date(start);
  while (cur <= end) {
    const iso = isoDate(cur);
    const day = byDate.get(iso) ?? [];
    const wd = isWeekday(cur);
    if (wd) expectedHours += 8;

    const off = day.find((e) =>
      ["sick", "paid_leave", "unpaid_leave"].includes(e.event_type)
    );
    if (off) {
      if (off.event_type === "paid_leave") paidLeaveDays += 1;
      else if (off.event_type === "unpaid_leave") unpaidLeaveDays += 1;
      else if (off.event_type === "sick") sickDays += 1;
    } else {
      const absences = day
        .filter((e) => e.event_type === "absence" && e.start_time && e.end_time)
        .map((e) => ({ start: parseMin(e.start_time!), end: parseMin(e.end_time!) }))
        .sort((a, b) => a.start - b.start);
      let absMin = 0;
      let cursor = -1;
      for (const a of absences) {
        const s = Math.max(a.start, cursor);
        if (a.end > s) absMin += a.end - s;
        cursor = Math.max(cursor, a.end);
      }
      const base = wd ? 8 : 0;
      const otMin = day
        .filter((e) => e.event_type === "overtime" && e.start_time && e.end_time)
        .reduce((s, e) => s + (parseMin(e.end_time!) - parseMin(e.start_time!)), 0);
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
  };
}

function DayModalContent({
  existing,
  onCreate,
  onDelete,
}: {
  existing: DayEvent[];
  onCreate: (payload: {
    event_type: EventType;
    start_time: string | null;
    end_time: string | null;
    reason: string | null;
  }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [type, setType] = useState<EventType>("absence");
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("14:00");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isFullDay = type === "sick" || type === "paid_leave" || type === "unpaid_leave";

  const submit = async () => {
    setSubmitting(true);
    try {
      await onCreate({
        event_type: type,
        start_time: isFullDay ? null : startTime,
        end_time: isFullDay ? null : endTime,
        reason: reason.trim() || null,
      });
      setReason("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {existing.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-3 mb-2">
            Записани събития
          </div>
          <ul className="space-y-1">
            {existing.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2"
              >
                <div className="text-[13px]">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] mr-2 ${TYPE_COLOR[e.event_type]}`}>
                    {TYPE_LABEL[e.event_type]}
                  </span>
                  {e.start_time && e.end_time && (
                    <span className="text-text-2">
                      {e.start_time.slice(0, 5)}–{e.end_time.slice(0, 5)}
                    </span>
                  )}
                  {e.reason && <span className="text-text-3 ml-2">— {e.reason}</span>}
                </div>
                <button
                  className="p-1 rounded text-text-3 hover:text-red hover:bg-red/10 cursor-pointer"
                  onClick={() => onDelete(e.id)}
                  aria-label="Изтрий"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-[11px] uppercase tracking-wider text-text-3 mb-2">
          Добави ново
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[13px] font-semibold text-text mb-1.5">Тип</label>
            <select
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[14px] cursor-pointer"
              value={type}
              onChange={(e) => setType(e.target.value as EventType)}
            >
              {(Object.keys(TYPE_LABEL) as EventType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          {!isFullDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1.5">От</label>
                <input
                  type="time"
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[14px]"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1.5">До</label>
                <input
                  type="time"
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[14px]"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[13px] font-semibold text-text mb-1.5">Причина</label>
            <input
              type="text"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[14px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Излязох по работа"
            />
          </div>

          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting ? "Записване..." : (<><Plus size={16} /> Добави</>)}
          </Button>
        </div>
      </div>
    </div>
  );
}
