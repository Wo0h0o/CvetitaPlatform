"use client";

import { useState } from "react";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { Target, X, Check } from "lucide-react";

interface Props {
  phone: string;
  pendingAgentId: string | null;
  pendingAt: string | null;
  pendingExpiresAt: string | null;
  agentName: string | null;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "изтекло";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days} ${days === 1 ? "ден" : "дни"} ${hours}ч`;
  if (hours > 0) return `${hours} ч`;
  const mins = Math.max(1, Math.floor((ms % 3_600_000) / 60_000));
  return `${mins} мин`;
}

export function UpsellWidget({
  phone, pendingAgentId, pendingAt, pendingExpiresAt, agentName,
  onSuccess, onError,
}: Props) {
  const [busy, setBusy] = useState<"mark" | "clear" | null>(null);

  const isPending = !!pendingAgentId && !!pendingExpiresAt && new Date(pendingExpiresAt) > new Date();

  const mark = async () => {
    setBusy("mark");
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(phone)}/upsell`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) onError(json.error || "Маркирането не успя.");
      else onSuccess();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Грешка.");
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy("clear");
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(phone)}/upsell`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) onError(json.error || "Премахването не успя.");
      else onSuccess();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Грешка.");
    } finally {
      setBusy(null);
    }
  };

  if (isPending) {
    return (
      <Card className="border border-blue-soft">
        <CardBody className="!p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="w-8 h-8 rounded-full bg-blue-soft text-blue flex items-center justify-center shrink-0">
              <Target size={14} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-text">
                Очаква се upsell поръчка
              </div>
              <div className="text-[12px] text-text-3">
                {agentName ? <>Маркиран от <span className="text-text-2">{agentName}</span> · </> : null}
                Изтича до {formatExpiry(pendingExpiresAt!)}
                {pendingAt && <> · отбелязано {new Date(pendingAt).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit" })}</>}
              </div>
            </div>
            <button
              onClick={clear}
              disabled={busy !== null}
              className="text-[12.5px] text-text-3 hover:text-red transition-colors inline-flex items-center gap-1 px-2 py-1"
            >
              <X size={12} />{busy === "clear" ? "..." : "Премахни"}
            </button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="!p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[13px] text-text-2 min-w-0">
            <Target size={14} className="text-text-3 shrink-0" />
            <span className="truncate">Маркирай за upsell — следващата поръчка ще се зачисли на теб (7 дни).</span>
          </div>
          <Button onClick={mark} disabled={busy !== null} size="sm" variant="secondary">
            <Check size={13} />{busy === "mark" ? "..." : "Маркирай"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
