"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calculator, Plus, Loader2, FileText, KeyRound, FileDown, Trash2, FolderInput, Folder, X, Search } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { eur, PL_TYPES, type PlProductType } from "@/lib/pricing";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

interface Offer {
  id: number;
  product_name: string;
  client: string | null;
  product_type: PlProductType | null;
  total: number | null;
  created_at: string | null;
  updated_at: string;
}

const NONE = "\u0000none"; // сентинел за „без папка"

export function OffersList({ mode }: { mode: "standard" | "key" }) {
  const base = mode === "key" ? "/pricing-key" : "/pricing";
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR<{ offers: Offer[] }>(`/api/pricing/offers?module=${mode}`, fetcher, { revalidateOnFocus: false });
  const offers = data?.offers ?? [];
  const [sel, setSel] = useState<number[]>([]);
  const [folder, setFolder] = useState<string | null>(null); // null = всички
  const [query, setQuery] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [moving, setMoving] = useState(false);

  // папки = клиенти (с брой), + „без папка"
  const counts = new Map<string, number>();
  for (const o of offers) {
    const c = (o.client || "").trim();
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const clients = [...counts.keys()].filter((c) => c !== "").sort((a, b) => a.localeCompare(b, "bg"));
  const noneCount = counts.get("") || 0;

  const byFolder = folder == null ? offers : folder === NONE ? offers.filter((o) => !(o.client || "").trim()) : offers.filter((o) => (o.client || "").trim() === folder);
  const q = query.trim().toLowerCase();
  const shown = q ? byFolder.filter((o) => (o.product_name || "").toLowerCase().includes(q) || (o.client || "").toLowerCase().includes(q)) : byFolder;

  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allChecked = shown.length > 0 && shown.every((o) => sel.includes(o.id));

  async function del(id: number, name: string) {
    if (!confirm(`Изтриване на офертата „${name || "без име"}"?`)) return;
    await fetch(`/api/pricing/offers?module=${mode}&id=${id}`, { method: "DELETE" });
    setSel((s) => s.filter((x) => x !== id));
    mutate();
  }
  const genDoc = () => sel.length && router.push(`${base}/offer-doc?ids=${sel.join(",")}`);

  async function moveSelected() {
    if (!sel.length || moving) return;
    const target = moveTo.trim();
    setMoving(true);
    try {
      await Promise.all(
        sel.map((id) => fetch(`/api/pricing/offers?module=${mode}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, client: target || null }) }))
      );
      setSel([]);
      setMoveTo("");
      mutate();
    } finally {
      setMoving(false);
    }
  }

  const chip = (label: string, value: string | null, count: number) => {
    const active = folder === value;
    return (
      <button
        key={label}
        onClick={() => setFolder(active ? null : value)}
        className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border cursor-pointer whitespace-nowrap transition-colors ${active ? "bg-accent text-white border-accent" : "border-border text-text-2 hover:bg-surface-2"}`}
      >
        <Folder size={13} /> {label} <span className={active ? "opacity-80" : "text-text-3"}>({count})</span>
      </button>
    );
  };

  return (
    <div>
      <PageHeader
        title={
          <>
            {mode === "key" ? <KeyRound size={22} className="text-accent" /> : <Calculator size={22} className="text-accent" />}
            {mode === "key" ? "Оферти — Ключови клиенти" : "Оферти — Private Label"}
          </>
        }
      >
        {sel.length > 0 && (
          <button onClick={genDoc} className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg border border-accent text-accent hover:bg-accent-soft cursor-pointer">
            <FileDown size={16} /> Оферта PDF ({sel.length})
          </button>
        )}
        <Link href={`${base}/offer`} className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer">
          <Plus size={16} /> Нова оферта
        </Link>
      </PageHeader>

      <p className="text-[13px] text-text-3 mb-4">
        {mode === "key"
          ? "Реални цени и себестойности за ключови клиенти (без надценка) — всичко е редактируемо."
          : "Цени за Private Label оферти: суровини (доставна цена от PRIM) + операции = крайна цена без ДДС."}
      </p>

      {/* Търсачка */}
      {offers.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Търси по продукт или клиент…"
            className="w-full pl-9 pr-8 py-2 text-[13px] rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 hover:text-text cursor-pointer" title="Изчисти"><X size={15} /></button>
          )}
        </div>
      )}

      {/* Папки по клиент */}
      {offers.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {chip("Всички", null, offers.length)}
          {clients.map((c) => chip(c, c, counts.get(c) || 0))}
          {noneCount > 0 && chip("Без папка", NONE, noneCount)}
        </div>
      )}

      {/* Лента за преместване при избрани */}
      {sel.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4 p-3 rounded-lg bg-surface-2 border border-border">
          <FolderInput size={16} className="text-accent" />
          <span className="text-[13px] text-text-2">{sel.length} избрани → премести в папка:</span>
          <input list="pl-clients" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} placeholder="избери или напиши клиент" className="px-3 py-1.5 text-[13px] rounded-lg border border-border bg-surface w-56" />
          <datalist id="pl-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
          <button onClick={moveSelected} disabled={moving} className="flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-50 cursor-pointer">
            {moving ? <Loader2 size={14} className="animate-spin" /> : <FolderInput size={14} />} Премести
          </button>
          <button onClick={() => setSel([])} className="flex items-center gap-1 text-[12px] text-text-3 hover:text-text px-2 py-1.5 cursor-pointer"><X size={14} /> Отказ</button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-text-3 py-12 justify-center">
          <Loader2 className="animate-spin" size={18} /> Зареждане…
        </div>
      )}
      {!isLoading && offers.length === 0 && (
        <Card className="p-6 text-[14px] text-text-2">
          Още няма оферти. Създай първата с <b>Нова оферта</b>.
        </Card>
      )}
      {offers.length > 0 && shown.length === 0 && (
        <Card className="p-6 text-[14px] text-text-2">Няма оферти по този филтър/търсене.</Card>
      )}
      {offers.length > 0 && shown.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[720px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-text-3">
                  <th className="px-3 py-2.5 w-8"><input type="checkbox" checked={allChecked} onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...shown.map((o) => o.id)])] : sel.filter((id) => !shown.some((o) => o.id === id)))} /></th>
                  <th className="text-left font-medium px-4 py-2.5">Продукт</th>
                  <th className="text-left font-medium px-4 py-2.5">Клиент</th>
                  <th className="text-left font-medium px-4 py-2.5">Дата</th>
                  <th className="text-right font-medium px-4 py-2.5">Цена/опаковка</th>
                  <th className="text-right font-medium px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="px-3 py-2.5"><input type="checkbox" checked={sel.includes(o.id)} onChange={() => toggle(o.id)} /></td>
                    <td className="px-4 py-2.5 font-medium text-text">
                      {o.product_name || "—"}
                      <span className="ml-2 text-[10px] font-normal text-text-3 px-1.5 py-0.5 rounded bg-surface-2">{PL_TYPES[o.product_type ?? "tablet"]?.label ?? "Таблетки / Капсули"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-text-2">{o.client || "—"}</td>
                    <td className="px-4 py-2.5 text-text-2 tabular-nums whitespace-nowrap">{fmtDate(o.created_at)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-accent tabular-nums">{o.total != null ? `${eur(o.total, 3)} €` : "—"}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Link href={`${base}/offer?id=${o.id}`} className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline">
                        <FileText size={14} /> Отвори
                      </Link>
                      <button onClick={() => del(o.id, o.product_name)} className="inline-flex items-center gap-1 text-[12px] text-text-3 hover:text-red-500 ml-3" title="Изтрий">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
