"use client";

import useSWR from "swr";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Factory, Loader2, AlertTriangle, FileText } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Row {
  id: string;
  name: string;
  sku: number | string;
  free: number;
  q30: number;
  q90: number;
  q60?: number;
  d30: number;
  d90: number;
  daily: number;
  cover: number;
  stockout: string;
  suggest: number;
  prodQty?: number;
  trend: number;
}

interface Snapshot {
  today?: string;
  buckets: { crit: number; order: number; watch: number; ok: number };
  singles: Row[];
  bundles: Row[];
  noStock: { name: string }[];
}

const nf = (x: number, dp = 0) =>
  x.toLocaleString("bg-BG", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtDate = (s: string) => (s ? s.split("-").reverse().join(".") : "—");

function statusOf(c: number) {
  if (c <= 30) return { k: "crit", t: "КРИТИЧНО" } as const;
  if (c <= 60) return { k: "order", t: "ЗАЯВИ СЕГА" } as const;
  if (c <= 90) return { k: "watch", t: "НАБЛЮДАВАЙ" } as const;
  return { k: "ok", t: "ОК" } as const;
}

const PILL: Record<string, string> = {
  crit: "bg-red-500/15 text-red-600 dark:text-red-400",
  order: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  watch: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  ok: "bg-green-500/15 text-green-600 dark:text-green-400",
};
const STRIPE: Record<string, string> = {
  crit: "border-l-red-500",
  order: "border-l-amber-500",
  watch: "border-l-transparent",
  ok: "border-l-transparent",
};

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  const color: Record<string, string> = {
    crit: "text-red-600 dark:text-red-400",
    order: "text-amber-600 dark:text-amber-400",
    watch: "text-blue-600 dark:text-blue-400",
    ok: "text-green-600 dark:text-green-400",
  };
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-text-3">{label}</div>
      <div className={`text-[30px] font-bold mt-1 ${color[tone]}`}>{value}</div>
    </Card>
  );
}

export default function ProductionPage() {
  const router = useRouter();
  const { data, isLoading } = useSWR<{ snapshot: Snapshot | null; as_of?: string }>(
    "/api/production/forecast",
    fetcher,
    { revalidateOnFocus: false }
  );
  // продукти вече в отворена заявка -> показваме предупреждение да не дублираме
  const { data: ordersData } = useSWR<{
    orders: { id: number; letter_no: string | null; issued_date: string; status: string; items: { item_id: string; status?: string }[] }[];
  }>("/api/production/orders", fetcher, { revalidateOnFocus: false });
  const pendingInOrder: Record<string, { label: string; date: string }> = {};
  for (const o of ordersData?.orders ?? []) {
    if (o.status === "done") continue;
    for (const it of o.items) {
      if (it.status === "produced") continue;
      pendingInOrder[String(it.item_id)] = {
        label: o.letter_no ? `№${o.letter_no}` : `#${o.id}`,
        date: o.issued_date,
      };
    }
  }

  // избор за заявка: item_id -> количество
  const [sel, setSel] = useState<Record<string, number>>({});
  const [showBundles, setShowBundles] = useState(false);
  const [sortBy, setSortBy] = useState<"cover" | "name" | "sales">("cover");
  const snap = data?.snapshot ?? null;

  const toggle = (r: Row) => {
    // ако продуктът вече е в отворена заявка — питаме, за да не дублираме
    if (sel[r.id] == null && pendingInOrder[r.id]) {
      const o = pendingInOrder[r.id];
      if (!confirm(`„${r.name}" вече е в заявка ${o.label} от ${fmtDate(o.date)} и още не е отбелязан като произведен.\n\nСигурен ли си, че искаш да го добавиш в нова заявка?`))
        return;
    }
    setSel((s) => {
      const n = { ...s };
      if (n[r.id] != null) delete n[r.id];
      else n[r.id] = r.prodQty && r.prodQty > 0 ? r.prodQty : 50;
      return n;
    });
  };
  const setQty = (id: string, q: number) => setSel((s) => ({ ...s, [id]: Math.max(0, q) }));

  const selectedIds = Object.keys(sel);
  const singles = [...(snap?.singles ?? [])].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name, "bg");
    if (sortBy === "sales") return (b.q60 ?? 0) - (a.q60 ?? 0);
    return a.cover - b.cover; // спешност
  });

  const createZayavka = () => {
    const encoded = selectedIds.map((id) => `${id}~${sel[id]}`).join(",");
    router.push(`/production/zayavka?sel=${encodeURIComponent(encoded)}`);
  };

  const suggestAll = () => {
    if (!snap) return;
    const next: Record<string, number> = {};
    // пропускаме продукти, които вече са в отворена заявка -> без дублиране
    for (const r of snap.singles)
      if ((r.prodQty ?? 0) > 0 && !pendingInOrder[r.id]) next[r.id] = r.prodQty!;
    setSel(next);
  };

  return (
    <div className="pb-24">
      <PageHeader
        title={
          <>
            <Factory size={22} className="text-accent" /> Наличности - Цветита Хербал
          </>
        }
      >
        {data?.as_of && <span className="text-[13px] text-text-3">към {fmtDate(data.as_of)}</span>}
      </PageHeader>

      {isLoading && (
        <div className="flex items-center gap-2 text-text-3 py-12 justify-center">
          <Loader2 className="animate-spin" size={18} /> Зареждане…
        </div>
      )}

      {!isLoading && !snap && (
        <Card className="p-6 flex items-start gap-3">
          <AlertTriangle className="text-amber-500 flex-shrink-0" size={20} />
          <div className="text-[14px] text-text-2">
            Още няма качена прогноза. Пусни локалната сутрешна рутина
            <code className="mx-1 px-1.5 py-0.5 rounded bg-surface-2 text-[12px]">/nalichnosti</code>.
          </div>
        </Card>
      )}

      {!isLoading && snap && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard label="Критично ≤30д" value={snap.buckets.crit} tone="crit" />
            <SummaryCard label="Заяви сега 31–60д" value={snap.buckets.order} tone="order" />
            <SummaryCard label="Наблюдавай 61–90д" value={snap.buckets.watch} tone="watch" />
            <SummaryCard label="ОК >90д" value={snap.buckets.ok} tone="ok" />
          </div>

          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-text">Единични продукти</h3>
                <p className="text-[12px] text-text-3 mt-0.5">
                  {'Чекни продуктите и коригирай количеството, после „Създай заявка". По подразбиране = за 3 месеца напред.'}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1 text-[12px]">
                  <span className="text-text-3 mr-1">Подреди:</span>
                  {([
                    ["cover", "по спешност"],
                    ["name", "по име (А-Я)"],
                    ["sales", "по продажби"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setSortBy(key)}
                      className={`px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                        sortBy === key ? "bg-accent-soft text-accent font-medium" : "text-text-2 hover:bg-surface-2"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={suggestAll}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-border text-text-2 hover:bg-surface-2 cursor-pointer"
                >
                  Избери всички с недостиг
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[900px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-text-3">
                    <th className="w-10 px-3 py-2.5"></th>
                    <th className="text-left font-medium px-4 py-2.5">Продукт</th>
                    <th className="text-right font-medium px-4 py-2.5">Своб.</th>
                    <th className="text-right font-medium px-4 py-2.5">Прод. 2 мес</th>
                    <th className="text-right font-medium px-4 py-2.5">Дни до 0</th>
                    <th className="text-left font-medium px-4 py-2.5">Статус</th>
                    <th className="text-left font-medium px-4 py-2.5">Заявка</th>
                    <th className="text-right font-medium px-4 py-2.5">Заяви бр.</th>
                  </tr>
                </thead>
                <tbody>
                  {singles.map((r) => {
                    const s = statusOf(r.cover);
                    const checked = sel[r.id] != null;
                    return (
                      <tr
                        key={r.id}
                        className={`border-t border-border border-l-2 ${STRIPE[s.k]} ${checked ? "bg-accent-soft/40" : ""}`}
                      >
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(r)}
                            className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                            aria-label={`Избери ${r.name}`}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-text max-w-[300px]">{r.name}</div>
                          <div className="text-[11px] text-text-3">SKU {r.sku}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{nf(r.free)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{nf(r.q60 ?? 0)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[15px] font-bold text-text">
                          {r.cover > 900 ? ">900" : nf(r.cover)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${PILL[s.k]}`}>
                            {s.t}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {pendingInOrder[r.id] ? (
                            <Link
                              href="/production/orders"
                              className="inline-flex items-center gap-1 text-[12px] text-amber-600 hover:underline whitespace-nowrap"
                              title="Отвори Заявки за статуса"
                            >
                              📋 {fmtDate(pendingInOrder[r.id].date)} · {pendingInOrder[r.id].label}
                            </Link>
                          ) : (
                            <span className="text-[12px] text-text-3">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {checked ? (
                            <input
                              type="number"
                              min={0}
                              step={50}
                              value={sel[r.id]}
                              onChange={(e) => setQty(r.id, parseInt(e.target.value || "0", 10))}
                              className="w-24 px-2 py-1 text-right rounded-md border border-border bg-surface tabular-nums"
                            />
                          ) : (
                            <span className="tabular-nums text-accent font-semibold">
                              {(r.prodQty ?? 0) > 0 ? nf(r.prodQty!) : "—"}
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

          <button
            onClick={() => setShowBundles((v) => !v)}
            className="text-[13px] text-text-3 hover:text-text cursor-pointer"
          >
            {showBundles ? "▾" : "▸"} Комбо/промо ({snap.bundles.length}) · без запис в Офис Склад ({snap.noStock.length})
          </button>
          {showBundles && (
            <Card className="p-5">
              <p className="text-[12px] text-text-3 leading-relaxed">
                <b>Продава се, но няма запис в Офис Склад:</b> {snap.noStock.map((x) => x.name).join(" · ") || "—"}
              </p>
            </Card>
          )}
        </div>
      )}

      {/* Долна лента за действие */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 md:left-[var(--sidebar-width)] bg-surface border-t border-border px-5 py-3 flex items-center justify-between gap-3 z-30 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="text-[13px] text-text-2">
            Избрани <b className="text-text">{selectedIds.length}</b> продукта ·{" "}
            {nf(selectedIds.reduce((a, id) => a + (sel[id] || 0), 0))} бр общо
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSel({})}
              className="text-[13px] px-3 py-2 rounded-lg text-text-3 hover:bg-surface-2 cursor-pointer"
            >
              Изчисти
            </button>
            <button
              onClick={createZayavka}
              className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer"
            >
              <FileText size={16} /> Създай заявка
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
