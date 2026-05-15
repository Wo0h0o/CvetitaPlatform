"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/shared/Skeleton";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/providers/ToastProvider";
import { UserPlus, Trash2, ShieldAlert } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TeamWorker {
  user_id: string;
  email: string | null;
  full_name: string | null;
  job_title: string | null;
}

export default function TeamSettingsPage() {
  const { toast } = useToast();
  const { data: me } = useSWR<{ role: string }>("/api/me", fetcher);
  const canManage = me?.role === "admin" || me?.role === "manager";

  // We reuse /api/hr/team (which is manager+admin gated) for the listing.
  // It returns totals we don't need here, but the query is cheap.
  const { data, isLoading, mutate } = useSWR<{ workers: TeamWorker[] }>(
    canManage ? "/api/hr/team" : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!canManage) {
    return (
      <>
        <PageHeader title="Екип" />
        <Card>
          <CardBody className="flex items-center gap-3 text-text-3">
            <ShieldAlert size={20} />
            <span className="text-[13px]">Само мениджъри и админи виждат тази страница.</span>
          </CardBody>
        </Card>
      </>
    );
  }

  const handleInvite = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          full_name: fullName || undefined,
          job_title: jobTitle || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Грешка");
      await mutate();
      toast("Поканата е изпратена. Работникът ще получи имейл за вход.", "success");
      setShowForm(false);
      setEmail("");
      setFullName("");
      setJobTitle("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Грешка", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (worker: TeamWorker) => {
    const label = worker.full_name ?? worker.email ?? worker.user_id;
    if (!confirm(`Премахни ${label} от организацията? Това действие изтрива и неговите HR записи.`)) {
      return;
    }
    try {
      const res = await fetch("/api/hr/invite", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: worker.user_id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Грешка");
      }
      await mutate();
      toast("Работникът е премахнат", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Грешка", "error");
    }
  };

  return (
    <>
      <PageHeader title="Екип">
        <Button onClick={() => setShowForm(true)}>
          <UserPlus size={16} /> Покани работник
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>Работници</CardHeader>
        <CardBody className="p-0">
          {isLoading ? (
            <div className="p-5"><Skeleton className="h-24 w-full" /></div>
          ) : (data?.workers ?? []).length === 0 ? (
            <div className="p-5 text-[13px] text-text-3">
              Нямате поканени работници. Натиснете „Покани работник&quot; за да започнете.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(data?.workers ?? []).map((w) => (
                <li key={w.user_id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <div className="font-medium text-text text-[14px]">
                      {w.full_name ?? w.email ?? "(без име)"}
                    </div>
                    <div className="text-[12px] text-text-3">
                      {w.email ?? "—"}
                      {w.job_title ? ` · ${w.job_title}` : ""}
                    </div>
                  </div>
                  <button
                    className="p-2 rounded-lg text-text-3 hover:text-red hover:bg-red/10 cursor-pointer"
                    onClick={() => handleRemove(w)}
                    aria-label="Премахни"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Покани нов работник"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-[13px] font-semibold text-text mb-1.5">Имейл *</label>
            <input
              type="email"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[14px]"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="worker@cvetita.com"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-text mb-1.5">Трите имена</label>
            <input
              type="text"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[14px]"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иван Иванов Иванов"
            />
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-text mb-1.5">Длъжност</label>
            <input
              type="text"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[14px]"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Маркетинг експерт"
            />
          </div>
          <p className="text-[12px] text-text-3 bg-surface-2 p-3 rounded-lg">
            Работникът ще получи имейл с линк за първи вход. След това ще си зададе парола
            и ще попълни оставащите HR полета (ЕГН, адрес, град).
          </p>
          <Button onClick={handleInvite} disabled={submitting || !email} className="w-full">
            {submitting ? "Изпращане..." : "Изпрати покана"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
