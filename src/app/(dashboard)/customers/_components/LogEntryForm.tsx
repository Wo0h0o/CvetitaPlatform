"use client";

import { useState, useRef } from "react";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { PhoneCall, StickyNote, Send, X } from "lucide-react";

const OUTCOMES: { key: string; label: string }[] = [
  { key: "satisfied",    label: "Доволен" },
  { key: "unsatisfied",  label: "Недоволен" },
  { key: "no_answer",    label: "Не вдига" },
  { key: "declined",     label: "Отказва" },
  { key: "wants_repeat", label: "Иска повторна" },
  { key: "has_question", label: "Има въпрос" },
  { key: "other",        label: "Друго" },
];

interface Props {
  phone: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export function LogEntryForm({ phone, onSuccess, onError }: Props) {
  const [kind, setKind] = useState<"call" | "note">("call");
  const [outcome, setOutcome] = useState<string>("satisfied");
  const [body, setBody] = useState("");
  const [duration, setDuration] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const reset = () => {
    setBody("");
    setDuration("");
    setFollowUp("");
    setShowAdvanced(false);
    bodyRef.current?.focus();
  };

  const submit = async () => {
    if (kind === "note" && !body.trim()) {
      onError("Бележката не може да е празна.");
      return;
    }

    const payload: Record<string, unknown> = {
      kind,
      body: body.trim() || null,
    };

    if (kind === "call") {
      payload.outcome = outcome;
      if (duration) {
        const n = parseInt(duration, 10);
        if (!Number.isFinite(n) || n < 0) {
          onError("Невалидна продължителност.");
          return;
        }
        payload.duration_seconds = n;
      }
    }

    if (followUp) {
      const d = new Date(followUp);
      if (Number.isNaN(d.getTime())) {
        onError("Невалидна дата за follow-up.");
        return;
      }
      payload.follow_up_at = d.toISOString();
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(phone)}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        onError(json.error || "Неуспешен запис.");
      } else {
        reset();
        onSuccess();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Грешка.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardBody className="space-y-3">
        {/* Kind toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setKind("call")}
            className={`flex-1 px-3 py-2 text-[13px] font-medium rounded-lg flex items-center justify-center gap-2 transition-colors
              ${kind === "call"
                ? "bg-accent text-white"
                : "bg-surface-2 text-text-2 hover:text-text border border-border"}`}
          >
            <PhoneCall size={14} />Обаждане
          </button>
          <button
            type="button"
            onClick={() => setKind("note")}
            className={`flex-1 px-3 py-2 text-[13px] font-medium rounded-lg flex items-center justify-center gap-2 transition-colors
              ${kind === "note"
                ? "bg-accent text-white"
                : "bg-surface-2 text-text-2 hover:text-text border border-border"}`}
          >
            <StickyNote size={14} />Бележка
          </button>
        </div>

        {/* Outcome (only for calls) */}
        {kind === "call" && (
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setOutcome(o.key)}
                className={`px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors
                  ${outcome === o.key
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-text-2 hover:text-text border border-border"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={kind === "call" ? "Какво се обсъди? (по желание)" : "Запиши бележка..."}
          rows={3}
          className="w-full p-3 text-[13px] bg-surface-2 border border-border rounded-lg text-text placeholder:text-text-3 focus:outline-none focus:border-accent transition-colors resize-y min-h-[80px]"
        />

        {/* Advanced */}
        {showAdvanced ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {kind === "call" && (
              <label className="block text-[12px] text-text-2">
                Продължителност (секунди)
                <input
                  type="number"
                  min="0"
                  max="86400"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg text-text focus:outline-none focus:border-accent"
                />
              </label>
            )}
            <label className="block text-[12px] text-text-2">
              Follow-up до
              <input
                type="datetime-local"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg text-text focus:outline-none focus:border-accent"
              />
            </label>
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[12px] text-text-3 hover:text-text-2 transition-colors"
          >
            {showAdvanced ? <X size={12} className="inline mr-1" /> : "+ "}
            {showAdvanced ? "Скрий" : kind === "call" ? "Продължителност · Follow-up" : "Follow-up"}
          </button>
          <Button onClick={submit} disabled={submitting} size="md">
            <Send size={14} />{submitting ? "Записва..." : "Запиши"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
