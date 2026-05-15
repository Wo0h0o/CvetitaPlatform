"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Card, CardBody } from "@/components/shared/Card";
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

const WEEKDAY_NAMES = ["Пон", "Вт", "Ср", "Чет", "Пет"];

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

/** Build the list of week rows for the month: each week is a row of Mon–Fri
 * Date objects. Days outside the current month appear as nulls so the grid
 * keeps clean columns even when the month starts mid-week. */
function buildMonthWeeks(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  // Walk back to the Monday on or before the 1st.
  const cursor = new Date(first);
  while (cursor.getDay() !== 1) cursor.setDate(cursor.getDate() - 1);

  const weeks: (Date | null)[][] = [];
  while (cursor <= last) {
    const week: (Date | null)[] = [];
    for (let i = 0; i < 5; i++) {
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
  const monthStart = new Date(refMonth.year, refMonth.month, 1);
  const monthEnd = new Date(refMonth.year, refMonth.month + 1, 0);
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

  return (
    <>
      <PageHeader title="График">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setRefMonth(({ year, month }) => {
                const d = new Date(year, month - 1, 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })
            }
            aria-label="Предишен месец"
          >
            <ChevronLeft size={16} />
          </Button>
          <span className="text-[14px] font-semibold text-text min-w-[140px] text-center capitalize">
            {monthLabel}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setRefMonth(({ year, month }) => {
                const d = new Date(year, month + 1, 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })
            }
            aria-label="Следващ месец"
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </PageHeader>

      {isManager && (
        <Card className="mb-4">
          <CardBody className="flex items-center gap-3 flex-wrap">
            <label className="text-[13px] font-semibold text-text">Виж график на:</label>
            <select
              className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-[13px] cursor-pointer"
              value={selectedUserId ?? ""}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value={me?.userId ?? ""}>Аз</option>
              {(teamData?.workers ?? []).map((w) => (
                <option key={w.user_id} value={w.user_id}>
                  {w.full_name ?? w.email ?? w.user_id}
                  {w.job_title ? ` — ${w.job_title}` : ""}
                </option>
              ))}
            </select>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="p-0">
          {!eventsData ? (
            <div className="p-5">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr className="bg-surface-2">
                    {WEEKDAY_NAMES.map((n) => (
                      <th
                        key={n}
                        className="text-left px-3 py-2 font-semibold text-text-2 border-b border-border w-1/5"
                      >
                        {n}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, wi) => (
                    <tr key={wi}>
                      {week.map((d, di) => (
                        <td
                          key={di}
                          className={`align-top border-b border-r border-border last:border-r-0 ${
                            d ? "cursor-pointer hover:bg-surface-2" : "bg-surface-2/40"
                          }`}
                          onClick={() => d && setModalDate(isoDate(d))}
                        >
                          {d && (
                            <DayCell
                              date={d}
                              events={eventsByDate.get(isoDate(d)) ?? []}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
        {(Object.keys(TYPE_LABEL) as EventType[]).map((t) => (
          <span key={t} className={`px-2 py-1 rounded-md ${TYPE_COLOR[t]}`}>
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

function DayCell({ date, events }: { date: Date; events: DayEvent[] }) {
  // Effective worked hours (mirrors lib/hr.computeDayHours). Inline because
  // this is a hot render path and we want it allocation-free per cell.
  const fullDayOff = events.find((e) =>
    ["sick", "paid_leave", "unpaid_leave"].includes(e.event_type)
  );
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

  // Full-day off: tint the entire cell and render a centred type label so
  // the calendar reads at a glance ("този ден е отпуск" вместо "имам badge").
  // Partial events (absence + overtime) keep the chip list because they
  // coexist with the working hours of the same day.
  if (fullDayOff) {
    return (
      <div className={`p-2 min-h-[100px] flex flex-col ${FULL_DAY_BG[fullDayOff.event_type]}`}>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-text">{date.getDate()}</span>
          <span className="text-[11px] text-text-3">0.0ч</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span
            className={`text-[12px] font-semibold px-2 py-0.5 rounded ${TYPE_COLOR[fullDayOff.event_type]}`}
            title={fullDayOff.reason ?? ""}
          >
            {TYPE_LABEL[fullDayOff.event_type]}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 min-h-[100px]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-semibold text-text">{date.getDate()}</span>
        <span className="text-[11px] text-text-3">{worked.toFixed(1)}ч</span>
      </div>
      <div className="space-y-1">
        {events.map((e) => (
          <div
            key={e.id}
            className={`text-[10px] px-1.5 py-0.5 rounded ${TYPE_COLOR[e.event_type]}`}
            title={e.reason ?? ""}
          >
            {e.start_time && e.end_time
              ? `${e.start_time.slice(0, 5)}–${e.end_time.slice(0, 5)} `
              : ""}
            {TYPE_LABEL[e.event_type]}
          </div>
        ))}
      </div>
    </div>
  );
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
