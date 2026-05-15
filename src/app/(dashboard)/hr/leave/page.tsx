"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/shared/Skeleton";
import { useToast } from "@/providers/ToastProvider";
import { Download, Plus, X, AlertCircle, FileText } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface LeaveRequestRow {
  id: number;
  user_id: string;
  leave_type: "paid" | "unpaid";
  start_date: string;
  working_days: number;
  reason: string | null;
  status: "submitted" | "cancelled";
  snapshot_full_name: string;
  snapshot_job_title: string;
  submitted_at: string;
  cancelled_at: string | null;
}

interface HrProfile {
  full_name: string | null;
  egn: string | null;
  city: string | null;
  address: string | null;
  job_title: string | null;
}

function formatDate(iso: string): string {
  const d = iso.length > 10 ? new Date(iso) : new Date(iso + "T00:00:00");
  return d.toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function LeavePage() {
  const { toast } = useToast();

  const { data: me } = useSWR<{ role: string; userId: string }>("/api/me", fetcher);
  const isManager = me?.role === "admin" || me?.role === "manager";

  const { data: profileData } = useSWR<{ profile: HrProfile }>("/api/hr/profile", fetcher);
  const profile = profileData?.profile;
  const profileMissing =
    !profile?.full_name || !profile?.egn || !profile?.city ||
    !profile?.address || !profile?.job_title;

  const listUrl = isManager ? "/api/hr/leave-requests?userId=all" : "/api/hr/leave-requests";
  const { data: listData, mutate, isLoading } = useSWR<{ requests: LeaveRequestRow[] }>(
    listUrl,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [showForm, setShowForm] = useState(false);
  const [leaveType, setLeaveType] = useState<"paid" | "unpaid">("paid");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [workingDays, setWorkingDays] = useState(1);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leave_type: leaveType,
          start_date: startDate,
          working_days: workingDays,
          reason: reason.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? json.message ?? "Грешка");
      await mutate();
      toast("Заявката е подадена", "success");
      // Auto-download the PDF for convenience
      window.open(`/api/hr/leave-requests/${json.request.id}/pdf`, "_blank");
      setShowForm(false);
      setReason("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Грешка", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: number) => {
    if (!confirm("Сигурен ли си, че искаш да отмениш заявката?")) return;
    try {
      const res = await fetch(`/api/hr/leave-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Грешка");
      }
      await mutate();
      toast("Заявката е отменена", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Грешка", "error");
    }
  };

  return (
    <>
      <PageHeader title="Заявки за отпуск">
        <Button onClick={() => setShowForm((s) => !s)} disabled={profileMissing}>
          {showForm ? (<><X size={16} /> Затвори</>) : (<><Plus size={16} /> Нова заявка</>)}
        </Button>
      </PageHeader>

      {profileMissing && (
        <Card className="mb-4 border-l-4 border-orange">
          <CardBody className="flex items-start gap-3">
            <AlertCircle size={20} className="text-orange flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-[14px] font-semibold text-text mb-1">
                Попълни първо личния си HR профил
              </div>
              <div className="text-[13px] text-text-2 mb-3">
                Без трите имена, ЕГН, град, адрес и длъжност, молбата не може да се генерира.
              </div>
              <Link href="/settings">
                <Button size="sm">Към настройки</Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      {showForm && !profileMissing && (
        <Card className="mb-6">
          <CardHeader>Нова заявка за отпуск</CardHeader>
          <CardBody className="space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-text mb-1.5">Тип отпуск</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={leaveType === "paid"}
                    onChange={() => setLeaveType("paid")}
                  />
                  <span className="text-[13px]">Платен</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={leaveType === "unpaid"}
                    onChange={() => setLeaveType("unpaid")}
                  />
                  <span className="text-[13px]">Неплатен</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1.5">Считано от</label>
                <input
                  type="date"
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[14px]"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1.5">Работни дни</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[14px]"
                  value={workingDays}
                  onChange={(e) => setWorkingDays(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-text mb-1.5">
                Причина <span className="text-text-3 font-normal">(не се вписва в молбата)</span>
              </label>
              <input
                type="text"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[14px]"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Семеен ангажимент"
              />
            </div>

            <div className="bg-surface-2 rounded-lg p-3 text-[12px] text-text-2">
              <div className="font-semibold text-text mb-1">След „Подай&quot;:</div>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Заявката се записва в историята.</li>
                <li>Молбата се генерира като PDF и веднага се сваля.</li>
                <li>Графикът се маркира автоматично за избраните дни.</li>
              </ul>
            </div>

            <Button onClick={handleSubmit} disabled={submitting} className="w-full">
              {submitting ? "Подаване..." : "Подай и свали PDF"}
            </Button>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader action={<FileText size={16} className="text-text-3" />}>
          {isManager ? "Заявки на екипа" : "Моите заявки"}
        </CardHeader>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="p-5"><Skeleton className="h-24 w-full" /></div>
          ) : (listData?.requests ?? []).length === 0 ? (
            <div className="p-5 text-[13px] text-text-3">Няма подадени заявки.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2">
                  <tr>
                    {isManager && (
                      <th className="text-left px-4 py-2 font-semibold text-text-2">Работник</th>
                    )}
                    <th className="text-left px-4 py-2 font-semibold text-text-2">Тип</th>
                    <th className="text-left px-4 py-2 font-semibold text-text-2">От</th>
                    <th className="text-left px-4 py-2 font-semibold text-text-2">Дни</th>
                    <th className="text-left px-4 py-2 font-semibold text-text-2">Подадена</th>
                    <th className="text-left px-4 py-2 font-semibold text-text-2">Статус</th>
                    <th className="text-right px-4 py-2 font-semibold text-text-2">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {(listData?.requests ?? []).map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      {isManager && (
                        <td className="px-4 py-3">
                          <div className="font-medium text-text">{r.snapshot_full_name}</div>
                          <div className="text-[11px] text-text-3">{r.snapshot_job_title}</div>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        {r.leave_type === "paid" ? "Платен" : "Неплатен"}
                      </td>
                      <td className="px-4 py-3">{formatDate(r.start_date)}</td>
                      <td className="px-4 py-3">{r.working_days}</td>
                      <td className="px-4 py-3 text-text-3">{formatDate(r.submitted_at)}</td>
                      <td className="px-4 py-3">
                        {r.status === "submitted" ? (
                          <span className="inline-block px-2 py-0.5 text-[11px] bg-accent-soft text-accent rounded">
                            Активна
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 text-[11px] bg-surface-2 text-text-3 rounded">
                            Отменена
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <a
                          href={`/api/hr/leave-requests/${r.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline mr-3"
                        >
                          <Download size={14} /> PDF
                        </a>
                        {r.status === "submitted" && (!isManager ? r.user_id === me?.userId : true) && (
                          <button
                            className="text-[12px] text-text-3 hover:text-red cursor-pointer"
                            onClick={() => handleCancel(r.id)}
                          >
                            Отмени
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
