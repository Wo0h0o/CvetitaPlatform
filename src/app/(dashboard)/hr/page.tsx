"use client";

import useSWR from "swr";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/shared/Skeleton";
import {
  CalendarDays,
  FileText,
  Clock,
  Plane,
  ThermometerSun,
  AlertCircle,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface MonthlyTotals {
  workedHours: number;
  expectedHours: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  sickDays: number;
  overtimeHours: number;
}

interface HrProfile {
  user_id: string;
  full_name: string | null;
  egn: string | null;
  city: string | null;
  address: string | null;
  job_title: string | null;
}

interface LeaveRequestRow {
  id: number;
  leave_type: "paid" | "unpaid";
  start_date: string;
  working_days: number;
  status: "submitted" | "cancelled";
  submitted_at: string;
}

function thisMonthRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  return { from, to };
}

export default function HrHomePage() {
  const { data: profileData, isLoading: profLoading } = useSWR<{ profile: HrProfile }>(
    "/api/hr/profile",
    fetcher,
    { revalidateOnFocus: false }
  );

  const { data: leaveData } = useSWR<{ requests: LeaveRequestRow[] }>(
    "/api/hr/leave-requests",
    fetcher,
    { revalidateOnFocus: false }
  );

  // We re-derive monthly totals client-side from day-events for the current
  // worker. The team endpoint already does this server-side but is gated
  // to manager+admin. Doing it here keeps the worker home cheap and avoids
  // a dedicated /api/hr/me/totals endpoint.
  const { from, to } = thisMonthRange();
  const { data: eventsData } = useSWR<{ events: Array<{ event_date: string; event_type: string; start_time: string | null; end_time: string | null }> }>(
    `/api/hr/day-events?from=${from}&to=${to}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const totals = computeTotalsClient(from, to, eventsData?.events ?? []);

  const profile = profileData?.profile;
  const profileMissing =
    !profile?.full_name || !profile?.egn || !profile?.city ||
    !profile?.address || !profile?.job_title;

  const recentRequests = (leaveData?.requests ?? []).slice(0, 5);

  return (
    <>
      <PageHeader title="HR" />

      {profileMissing && !profLoading && (
        <Card className="mb-6 border-l-4 border-orange">
          <CardBody className="flex items-start gap-3">
            <AlertCircle size={20} className="text-orange flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-[14px] font-semibold text-text mb-1">
                Профилът ти не е попълнен
              </div>
              <div className="text-[13px] text-text-2 mb-3">
                Преди да подадеш заявка за отпуск, попълни трите имена, ЕГН,
                адрес и длъжност. Те се ползват за молбата.
              </div>
              <Link href="/settings">
                <Button size="sm">Към настройки</Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiTile
          icon={<Clock size={18} />}
          label="Часове този месец"
          value={
            totals
              ? `${totals.workedHours.toFixed(1)} / ${totals.expectedHours.toFixed(0)}`
              : "—"
          }
          hint="Изработени / Очаквани"
        />
        <KpiTile
          icon={<Plane size={18} />}
          label="Платен отпуск"
          value={totals ? `${totals.paidLeaveDays} дни` : "—"}
        />
        <KpiTile
          icon={<ThermometerSun size={18} />}
          label="Болнични"
          value={totals ? `${totals.sickDays} дни` : "—"}
        />
        <KpiTile
          icon={<Clock size={18} />}
          label="Overtime"
          value={totals ? `${totals.overtimeHours.toFixed(1)} ч` : "—"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader action={<CalendarDays size={16} className="text-text-3" />}>
            Графикът ми
          </CardHeader>
          <CardBody>
            <p className="text-[13px] text-text-2 mb-4">
              Виж графика за този месец, маркирай отсъствия или допълнителни часове.
            </p>
            <Link href="/hr/schedule">
              <Button>Виж график</Button>
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader action={<FileText size={16} className="text-text-3" />}>
            Заявки за отпуск
          </CardHeader>
          <CardBody>
            {recentRequests.length === 0 ? (
              <p className="text-[13px] text-text-3 mb-4">Нямаш подадени заявки.</p>
            ) : (
              <ul className="space-y-2 mb-4">
                {recentRequests.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between text-[13px] py-1.5 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">
                        {r.leave_type === "paid" ? "Платен" : "Неплатен"}
                      </span>
                      <span className="text-text-3">
                        {r.start_date} · {r.working_days} дни
                      </span>
                    </div>
                    {r.status === "cancelled" && (
                      <span className="text-[11px] text-text-3 uppercase">Отменена</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/hr/leave">
              <Button disabled={profileMissing}>Нова заявка</Button>
            </Link>
          </CardBody>
        </Card>
      </div>

      {profLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}
    </>
  );
}

function KpiTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2 text-text-3 mb-2">
          {icon}
          <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
        </div>
        <div className="text-[22px] font-bold text-text leading-tight">{value}</div>
        {hint && <div className="text-[11px] text-text-3 mt-0.5">{hint}</div>}
      </CardBody>
    </Card>
  );
}

// ---------- client-side replica of lib/hr.computeMonthlyTotals ----------
// Kept inline to avoid a Next.js client/server type re-export dance.
// Logic must stay in sync with src/lib/hr.ts.
function computeTotalsClient(
  fromIso: string,
  toIso: string,
  events: Array<{ event_date: string; event_type: string; start_time: string | null; end_time: string | null }>
): MonthlyTotals {
  const start = new Date(fromIso + "T00:00:00");
  const end = new Date(toIso + "T00:00:00");

  function parseMin(t: string): number {
    const [h, m] = t.split(":");
    return Number(h) * 60 + Number(m);
  }

  function isWd(d: Date): boolean {
    const day = d.getDay();
    return day >= 1 && day <= 5;
  }

  const byDate = new Map<string, typeof events>();
  for (const e of events) {
    const arr = byDate.get(e.event_date) ?? [];
    arr.push(e);
    byDate.set(e.event_date, arr);
  }

  const BASE = 8;
  let workedHours = 0;
  let expectedHours = 0;
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  let sickDays = 0;
  let overtimeHours = 0;

  const cur = new Date(start);
  while (cur <= end) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    const day = byDate.get(iso) ?? [];
    const wd = isWd(cur);
    if (wd) expectedHours += BASE;

    const fullDayOff = day.find((e) =>
      ["sick", "paid_leave", "unpaid_leave"].includes(e.event_type)
    );
    if (fullDayOff) {
      if (fullDayOff.event_type === "paid_leave") paidLeaveDays += 1;
      else if (fullDayOff.event_type === "unpaid_leave") unpaidLeaveDays += 1;
      else if (fullDayOff.event_type === "sick") sickDays += 1;
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
      const base = wd ? BASE : 0;
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
