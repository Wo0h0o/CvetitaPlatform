"use client";

import useSWR from "swr";
import { useState } from "react";
import Link from "next/link";
import { ClipboardList, Loader2, Clock, PackageCheck, Trash2, FileText, CalendarClock, Pencil, Save, X, RefreshCw } from "lucide-react";
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
  produced_qty?: number | null;
  produced_date?: string | null;
}
// произведено количество (със съвместимост към стари заявки с булев статус)
const producedOf = (it: Item): number =>
  it.produced_qty != null ? it.produced_qty : it.status === "produced" ? it.qty : 0;
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
  // recentWO от снимката — за авто-попълване на произведеното
  const { data: fc, mutate: mutateFc } = useSWR<{ snapshot: { recentWO?: WO[] } | null }>(
    "/api/production/forecast",
    fetcher,
    { revalidateOnFocus: false }
  );
  const recentWO = fc?.snapshot?.recentWO ?? [];
  const [busy, setBusy] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const syncNow = async () => {
    setSyncing(true);
    try {
      await fetch("/api/production/sync", { method: "POST" });
      await Promise.all([mutate(), mutateFc()]);
    } finally {
      setSyncing(false);
    }
  };

  // произведено от работните поръчки в PRIM (сума за продукта след издаване на заявката)
  const woSumFor = (itemId: string, since: string): number =>
    recentWO.filter((w) => String(w.item_id) === String(itemId) && w.date >= since).reduce((a, w) => a + w.qty, 0);
  // ефективно произведено = по-голямото от ръчно вписаното и автоматичното от PRIM
  const effProduced = (it: Item, issuedDate: string): number => Math.max(producedOf(it), woSumFor(it.item_id, issuedDate));

  const orders = data?.orders ?? [];

  const patchOrder = async (order: Order, items: Item[]) => {
    setBusy(order.id);
    const allDone = items.every((it) => producedOf(it) >= it.qty);
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

  // произведено количество (частично) — редактира се inline и се пази при blur
  const [prodDraft, setProdDraft] = useState<Record<string, number>>({});
  const today = () => new Date().toISOString().slice(0, 10);
  const saveProduced = (order: Order, idx: number, value: number) => {
    const val = Math.max(0, value || 0);
    const items = order.items.map((x, i) =>
      i === idx
        ? {
            ...x,
            produced_qty: val,
            status: (val >= x.qty ? "produced" : "pending") as Item["status"],
            produced_date: val >= x.qty ? x.produced_date ?? today() : val > 0 ? x.produced_date ?? today() : null,
          }
        : x
    );
    patchOrder(order, items);
  };

  // редактиране на количествата на издадена заявка
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<number, number>>({});

  const startEdit = (order: Order) => {
    setEditId(order.id);
    setDraft(Object.fromEntries(order.items.map((it, i) => [i, it.qty])));
  };
  const cancelEdit = () => {
    setEditId(null);
    setDraft({});
  };
  const saveEdit = async (order: Order) => {
    const items = order.items.map((it, i) => ({ ...it, qty: Math.max(0, draft[i] ?? it.qty) }));
    setBusy(order.id);
    try {
      await fetch("/api/production/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, items }),
      });
      await mutate();
      setEditId(null);
      setDraft({});
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

  return (
    <div>
      <PageHeader
        title={
          <>
            <ClipboardList size={22} className="text-accent" /> Възлагателни писма
          </>
        }
      >
        <button
          onClick={syncNow}
          disabled={syncing}
          className="flex items-center gap-2 text-[13px] font-medium px-3 py-2 rounded-lg border border-border text-text-2 hover:bg-surface-2 cursor-pointer disabled:opacity-50"
          title="Дръпни най-новите производствени данни от PRIM"
        >
          <RefreshCw size={15} className={syncing ? "animate-spin" : ""} /> {syncing ? "Обновявам…" : "Обнови от PRIM"}
        </button>
      </PageHeader>
      <p className="text-[13px] text-text-3 mb-5">
        {`Проследяване на издадените възлагателни писма. Срок за изработка ~${LEAD_WORKDAYS} работни дни. Произведените бройки се вземат автоматично от работните поръчки в PRIM; можеш и ръчно да коригираш в колона „Произведено".`}
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-text-3 py-12 justify-center">
          <Loader2 className="animate-spin" size={18} /> Зареждане…
        </div>
      )}

      {!isLoading && orders.length === 0 && (
        <Card className="p-6 text-[14px] text-text-2">
          Още няма издадени заявки. Създай от <b>Наличности - Цветита Хербал → избери продукти → Създай заявка → Издай заявката</b>.
        </Card>
      )}

      <div className="space-y-4">
        {orders.map((o) => {
          const ready = addWorkdays(o.issued_date, LEAD_WORKDAYS);
          const totalOrdered = o.items.reduce((a, it) => a + it.qty, 0);
          const totalProduced = o.items.reduce((a, it) => a + Math.min(effProduced(it, o.issued_date), it.qty), 0);
          const doneItems = o.items.filter((it) => effProduced(it, o.issued_date) >= it.qty).length;
          const allDone = o.items.every((it) => effProduced(it, o.issued_date) >= it.qty);
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
                    {editId === o.id ? (
                      <>
                        <button
                          onClick={() => saveEdit(o)}
                          disabled={busy === o.id}
                          className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer disabled:opacity-50"
                        >
                          {busy === o.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={15} />} Запази
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="flex items-center gap-1.5 text-[12px] text-text-3 hover:text-text px-2.5 py-1.5 rounded-lg hover:bg-surface-2 cursor-pointer"
                        >
                          <X size={15} /> Отказ
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(o)}
                          className="flex items-center gap-1.5 text-[12px] font-medium text-text-2 hover:bg-surface-2 px-2.5 py-1.5 rounded-lg cursor-pointer"
                          title="Редактирай количествата"
                        >
                          <Pencil size={15} /> Редактирай
                        </button>
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
                      </>
                    )}
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
                    <div className="text-text-3 text-[10px] uppercase tracking-wider">Произведено</div>
                    <div className="font-semibold text-text mt-0.5 tabular-nums">
                      {nf(totalProduced)} / {nf(totalOrdered)} бр
                      <span className="text-text-3 font-normal"> · {doneItems}/{o.items.length} готови</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[640px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-text-3">
                      <th className="text-left font-medium px-4 py-2">Продукт</th>
                      <th className="text-right font-medium px-4 py-2">Заявено</th>
                      <th className="text-right font-medium px-4 py-2">Произведено</th>
                      <th className="text-left font-medium px-4 py-2">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.items.map((it, idx) => {
                      const prod = effProduced(it, o.issued_date);
                      const auto = woSumFor(it.item_id, o.issued_date); // произведено според PRIM WO
                      const key = `${o.id}:${idx}`;
                      const val = prodDraft[key] ?? prod;
                      const full = prod >= it.qty;
                      const partial = prod > 0 && prod < it.qty;
                      return (
                        <tr key={it.item_id + idx} className="border-t border-border">
                          <td className="px-4 py-2.5">
                            <div className={`font-medium ${full ? "text-text-3" : "text-text"}`}>{it.name}</div>
                            <div className="text-[11px] text-text-3">SKU {it.sku}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {editId === o.id ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  step={50}
                                  value={draft[idx] ?? it.qty}
                                  onChange={(e) => setDraft((d) => ({ ...d, [idx]: parseInt(e.target.value || "0", 10) }))}
                                  className="w-24 px-2 py-1 text-right rounded-md border border-border bg-surface tabular-nums"
                                />
                                <span className="text-text-3">{it.unit ? `× ${it.size} ${it.unit}` : "бр"}</span>
                              </div>
                            ) : (
                              <>{nf(it.qty)} {it.unit ? `× ${it.size} ${it.unit}` : ""}</>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <input
                                type="number"
                                min={0}
                                step={50}
                                value={val}
                                disabled={busy === o.id}
                                onChange={(e) => setProdDraft((d) => ({ ...d, [key]: parseInt(e.target.value || "0", 10) }))}
                                onBlur={() => { if (val !== prod) saveProduced(o, idx, val); }}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                className={`w-20 px-2 py-1 text-right rounded-md border bg-surface tabular-nums ${full ? "border-green-500/50" : partial ? "border-amber-500/50" : "border-border"}`}
                                aria-label={`Произведено от ${it.name}`}
                              />
                              <span className="text-text-3 text-[12px] whitespace-nowrap">/ {nf(it.qty)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            {full ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-green-600 font-medium">
                                <PackageCheck size={15} /> Готово{it.produced_date ? ` · ${fmt(it.produced_date)}` : ""}
                              </span>
                            ) : partial ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-amber-600 font-medium">
                                <Clock size={14} /> Частично {nf(prod)}/{nf(it.qty)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-3">
                                <Clock size={14} /> Чака
                              </span>
                            )}
                            {auto > 0 && (
                              <div className="text-[10px] text-text-3 mt-0.5">от работни поръчки: {nf(auto)}</div>
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
