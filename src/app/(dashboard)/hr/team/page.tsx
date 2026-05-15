"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/shared/Skeleton";
import { ChevronLeft, ChevronRight, FileSpreadsheet, CalendarDays } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Totals {
  workedHours: number;
  expectedHours: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  sickDays: number;
  overtimeHours: number;
}

interface TeamWorker {
  user_id: string;
  email: string | null;
  full_name: string | null;
  job_title: string | null;
  employment_start: string | null;
  totals: Totals;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function TeamPage() {
  const [refMonth, setRefMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const monthParam = `${refMonth.year}-${pad(refMonth.month + 1)}`;
  const { data, isLoading } = useSWR<{ workers: TeamWorker[] }>(
    `/api/hr/team?month=${monthParam}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const monthLabel = new Date(refMonth.year, refMonth.month, 1).toLocaleDateString("bg-BG", {
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <PageHeader title="Екип">
        <div className="flex items-center gap-2 flex-wrap">
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
          <a
            href={`/api/hr/export?month=${monthParam}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="primary" size="sm">
              <FileSpreadsheet size={16} /> Експорт в Excel
            </Button>
          </a>
        </div>
      </PageHeader>

      <Card>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="p-5"><Skeleton className="h-32 w-full" /></div>
          ) : (data?.workers ?? []).length === 0 ? (
            <div className="p-6 text-[13px] text-text-3">
              Няма работници в организацията. Покани работник от{" "}
              <Link href="/settings/team" className="text-accent hover:underline">
                Настройки → Екип
              </Link>.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-text-2">Работник</th>
                    <th className="text-left px-4 py-2 font-semibold text-text-2">Длъжност</th>
                    <th className="text-right px-4 py-2 font-semibold text-text-2">Изработени / Очаквани</th>
                    <th className="text-right px-4 py-2 font-semibold text-text-2">Платен</th>
                    <th className="text-right px-4 py-2 font-semibold text-text-2">Неплатен</th>
                    <th className="text-right px-4 py-2 font-semibold text-text-2">Болничен</th>
                    <th className="text-right px-4 py-2 font-semibold text-text-2">Overtime</th>
                    <th className="text-right px-4 py-2 font-semibold text-text-2">График</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.workers ?? []).map((w) => {
                    const t = w.totals;
                    const ratio = t.expectedHours > 0 ? t.workedHours / t.expectedHours : 0;
                    const ratioColor =
                      ratio >= 0.95
                        ? "text-accent"
                        : ratio >= 0.8
                          ? "text-text"
                          : "text-orange";
                    return (
                      <tr key={w.user_id} className="border-t border-border">
                        <td className="px-4 py-3">
                          <div className="font-medium text-text">{w.full_name ?? w.email ?? "(без име)"}</div>
                          {w.email && <div className="text-[11px] text-text-3">{w.email}</div>}
                        </td>
                        <td className="px-4 py-3 text-text-2">{w.job_title ?? "—"}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${ratioColor}`}>
                          <span className="font-semibold">{t.workedHours.toFixed(1)}</span>
                          <span className="text-text-3"> / {t.expectedHours}</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{t.paidLeaveDays}д</td>
                        <td className="px-4 py-3 text-right tabular-nums">{t.unpaidLeaveDays}д</td>
                        <td className="px-4 py-3 text-right tabular-nums">{t.sickDays}д</td>
                        <td className="px-4 py-3 text-right tabular-nums">{t.overtimeHours.toFixed(1)}ч</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/hr/schedule?userId=${w.user_id}`}
                            className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                          >
                            <CalendarDays size={14} /> Виж
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
