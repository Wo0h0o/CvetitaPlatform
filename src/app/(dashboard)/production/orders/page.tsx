"use client";

import useSWR from "swr";
import { useState } from "react";
import Link from "next/link";
import { ClipboardList, Loader2, Check, Clock, PackageCheck, Trash2, FileText, CalendarClock } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Item {
  item_id: string;
  sku?: string;
  name: string;
  qty: number;
  size?: string;
  unit?: string;
  status?: "pending" | "produced";
  produced_date?: string | null;
}
interface Order {
  id: number;
  letter_no: string | null;
  issued_date: string;
  status: string;
  items: Item[];
  created_at: string;
}
interface WO { item_id: string; wo_num: string; date: string; qty: number }

const LEAD_WORKDAYS = 14;

function addWorkdays(iso: string, n: number): Date {
  const d = new Date(iso + "T00:00:00Z");
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}
const fmt = (d: Date | string) => {
  const x = typeof d === "string" ? new Date(d + "T00:00:00Z") : d;
  return x.toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" });
};
const nf = (x: number) => x.toLocaleString("bg-BG");
// календарни дни до дадена дата (спрямо днес)
function daysUntil(d: Date): number {
  const now = new Date();
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

export default function OrdersPage() {
  const { data, isLoading, mutate } = useSWR<{ orders: Order[] }>("/api/production/orders", fetcher, {
    revalidateOnFocus: false,
  });
  // recentWO от снимката — за авто-подсказка „изглежда произведено"
  const { data: fc } = useSWR<{ snapshot: { recentWO?: WO[] } | null }>(
    "/api/production/forecast",
    fetcher,
    { revalidateOnFocus: false }
  );
  const recentWO = fc?.snapshot?.recentWO ?? [];
  const [busy, setBusy] = useState<number | null>(null);

  const orders = data?.orders ?? [];

  const woFor = (itemId: string, sinceIso: string): WO | undefined =>
    recentWO
      .filter((w) => String(w.item_id) === String(itemId) && w.date >= sinceIso)
      .sort((a, b) => b.date.localeCompare(a.date))[0];

  const patchOrder = async (order: Order, items: Item[]) => {
    setBusy(order.id);
    const allDone = items.every((it) => it.status === "produced");
    try {
      await fetch("/api/production/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, items, status: allDone ? "done" : "open" }),
      });
      await mutate();
    } finally {
      setBusy(null);
    }
  };

  const deleteOrder = async (order: Order) => {
    if (!confirm(`Изтрий заявка ${order.letter_no ? `№${order.letter_no}` : `#${order.id}`}? Действието е необратимо.`))
      return;
    setBusy(order.id);
    try {
      await fetch(`/api/production/orders?id=${order.id}`, { method: "DELETE" });
      await mutate();
    } finally {
      setBusy(null);
    }
  };

  const toggleItem = (order: Order, idx: number, produced: boolean, date?: string) => {
    const items = order.items.map((it, i) =>
      i === idx
        ? { ...it, status: (produced ? "produced" : "pending") as Item["status"], produced_date: produced ? date ?? new Date().toISOString().slice(0, 10) : null }
        : it
    );
    patchOrder(order, items);
  };

  return (
    <div>
      <PageHeader
        title={
          <>
            <ClipboardList size={22} className="text-accent" /> Заявки към производството
          </>
        }
      />
      <p className="text-[13px] text-text-3 mb-5">
        Проследяване на издадените възлагателни писма. Срок за изработка ~{LEAD_WORKDAYS} работни дни.
        Отметни произведените продукти, за да не дублираш заявки.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-text-3 py-12 justify-center">
          <Loader2 className="animate-spin" size={18} /> Зареждане…
        </div>
      )}

      {!isLoading && orders.length === 0 && (
        <Card className="p-6 text-[14px] text-text-2">
          Още няма издадени заявки. Създай от <b>Производство → избери продукти → Създай заявка → Издай заявката</b>.
        </Card>
      )}

      <div className="space-y-4">
        {orders.map((o) => {
          const ready = addWorkdays(o.issued_date, LEAD_WORKDAYS);
          const doneCount = o.items.filter((it) => it.status === "produced").length;
          const allDone = doneCount === o.items.length;
          const daysLeft = daysUntil(ready);
          const cd = allDone
            ? { text: "Готова", cls: "bg-green-500/15 text-green-600" }
            : daysLeft > 0
              ? { text: `остават ${daysLeft} ${daysLeft === 1 ? "ден" : "дни"}`, cls: daysLeft <= 3 ? "bg-amber-500/15 text-amber-600" : "bg-blue-500/15 text-blue-600" }
              : daysLeft === 0
                ? { text: "готовност днес", cls: "bg-amber-500/15 text-amber-600" }
                : { text: `просрочена с ${-daysLeft} ${-daysLeft === 1 ? "ден" : "дни"}`, cls: "bg-red-500/15 text-red-600" };
          return (
            <Card key={o.id} className="overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <h3 className="text-[15px] font-semibold text-text flex items-center gap-2">
                    Възлагателно писмо {o.letter_no ? `№${o.letter_no}` : `#${o.id}`}
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${allDone ? "bg-green-500/15 text-green-600" : "bg-amber-500/15 text-amber-600"}`}>
                      {allDone ? "Завършена" : "В производство"}
                    </span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/production/zayavka?order=${o.id}`}
                      className="flex items-center gap-1.5 text-[12px] font-medium text-accent hover:bg-accent-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
                      title="Отвори писмото за преглед/печат"
                    >
                      <FileText size={15} /> Отвори писмото
                    </Link>
                    <button
                      onClick={() => deleteOrder(o)}
                      disabled={busy === o.id}
                      className="flex items-center gap-1.5 text-[12px] text-text-3 hover:text-red-600 px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 cursor-pointer disabled:opacity-50"
                      title="Изтрий заявката"
                    >
                      <Trash2 size={15} /> Изтрий
                    </button>
                  </div>
                </div>
                <div className="flex items-stretch gap-2 flex-wrap text-[12px]">
                  <div className="px-3 py-2 rounded-lg bg-surface-2 border border-border">
                    <div className="text-text-3 text-[10px] uppercase tracking-wider">Заявено</div>
                    <div className="font-semibold text-text mt-0.5">{fmt(o.issued_date)}</div>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-surface-2 border border-border">
                    <div className="text-text-3 text-[10px] uppercase tracking-wider">Очаква се готово</div>
                    <div className="font-semibold text-text mt-0.5">{fmt(ready)}</div>
                  </div>
                  <div className={`px-3 py-2 rounded-lg flex items-center gap-1.5 font-bold ${cd.cls}`}>
                    <CalendarClock size={15} /> {cd.text}
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-surface-2 border border-border ml-auto">
                    <div className="text-text-3 text-[10px] uppercase tracking-wider">Произведени</div>
                    <div className="font-semibold text-text mt-0.5">{doneCount}/{o.items.length}</div>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[640px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-text-3">
                      <th className="w-10 px-3 py-2"></th>
                      <th className="text-left font-medium px-4 py-2">Продукт</th>
                      <th className="text-right font-medium px-4 py-2">Количество</th>
                      <th className="text-left font-medium px-4 py-2">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.items.map((it, idx) => {
                      const produced = it.status === "produced";
                      const hint = !produced ? woFor(it.item_id, o.issued_date) : undefined;
                      return (
                        <tr key={it.item_id + idx} className="border-t border-border">
                          <td className="px-3 py-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={produced}
                              disabled={busy === o.id}
                              onChange={(e) => toggleItem(o, idx, e.target.checked)}
                              className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                              aria-label={`Произведено ${it.name}`}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <div className={`font-medium ${produced ? "text-text-3 line-through" : "text-text"}`}>
                              {it.name}
                            </div>
                            <div className="text-[11px] text-text-3">SKU {it.sku}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {nf(it.qty)} {it.unit ? `× ${it.size} ${it.unit}` : ""}
                          </td>
                          <td className="px-4 py-2.5">
                            {produced ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-green-600 font-medium">
                                <PackageCheck size={15} /> Произведено{it.produced_date ? ` · ${fmt(it.produced_date)}` : ""}
                              </span>
                            ) : hint ? (
                              <button
                                onClick={() => toggleItem(o, idx, true, hint.date)}
                                className="inline-flex items-center gap-1.5 text-[12px] text-amber-600 hover:underline cursor-pointer"
                                title={`Работна поръчка ${hint.wo_num}`}
                              >
                                <Check size={14} /> Изглежда произведено ({fmt(hint.date)}) — потвърди
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-3">
                                <Clock size={14} /> Чака
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
