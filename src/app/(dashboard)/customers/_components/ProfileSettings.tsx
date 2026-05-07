"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";

interface Props {
  phone: string;
  doNotCall: boolean;
  preferredCallHour: string | null;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export function ProfileSettings({
  phone, doNotCall, preferredCallHour, onSuccess, onError,
}: Props) {
  const [dnc, setDnc] = useState(doNotCall);
  const [hour, setHour] = useState(preferredCallHour ?? "");
  const [saving, setSaving] = useState(false);

  // Re-sync if parent props change (e.g. after mutate())
  useEffect(() => { setDnc(doNotCall); }, [doNotCall]);
  useEffect(() => { setHour(preferredCallHour ?? ""); }, [preferredCallHour]);

  const dirty = dnc !== doNotCall || (hour.trim() || null) !== (preferredCallHour ?? null);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(phone)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          do_not_call: dnc,
          preferred_call_hour: hour.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onError(json.error || "Неуспешно запазване.");
      } else {
        onSuccess();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Грешка.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>Профил</CardHeader>
      <CardBody className="space-y-3">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div>
            <div className="text-[13px] text-text font-medium">Не звъни</div>
            <div className="text-[12px] text-text-3">Клиентът не желае обаждания.</div>
          </div>
          <input
            type="checkbox"
            checked={dnc}
            onChange={(e) => setDnc(e.target.checked)}
            className="w-5 h-5 accent-accent cursor-pointer"
          />
        </label>

        <label className="block">
          <div className="text-[13px] text-text font-medium mb-1">Предпочитан час</div>
          <input
            type="text"
            value={hour}
            onChange={(e) => setHour(e.target.value)}
            placeholder="напр. 18:00–20:00"
            maxLength={32}
            className="w-full px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg text-text placeholder:text-text-3 focus:outline-none focus:border-accent"
          />
          <div className="text-[12px] text-text-3 mt-1">
            Свободен текст. Пример: след 18:00.
          </div>
        </label>

        <div className="flex justify-end pt-1">
          <Button onClick={save} disabled={!dirty || saving} size="sm">
            {saving ? "Запазва..." : "Запази"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
