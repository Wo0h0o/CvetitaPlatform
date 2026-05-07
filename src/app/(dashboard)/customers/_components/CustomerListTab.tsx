"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Card, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { Button } from "@/components/shared/Button";
import {
  Search, Phone, MapPin, ChevronLeft, ChevronRight, Users,
  PhoneOff, AlertCircle, X,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const PAGE_SIZE = 50;

const FILTERS = [
  { key: "all",            label: "Всички" },
  { key: "never_called",   label: "Без обаждане" },
  { key: "needs_followup", label: "Чакащи follow-up" },
  { key: "has_followup",   label: "С follow-up" },
  { key: "do_not_call",    label: "Не звъни" },
] as const;

const SORTS = [
  { key: "last_order_at",  label: "Последна поръчка" },
  { key: "total_spent",    label: "Похарчено" },
  { key: "total_orders",   label: "Брой поръчки" },
  { key: "last_call_at",   label: "Последно обаждане" },
  { key: "first_name",     label: "Име" },
] as const;

const OUTCOME_LABEL: Record<string, string> = {
  satisfied:     "Доволен",
  unsatisfied:   "Недоволен",
  no_answer:     "Не вдига",
  declined:      "Отказва",
  wants_repeat:  "Иска повторна",
  has_question:  "Има въпрос",
  other:         "Друго",
};

const OUTCOME_VARIANT: Record<string, "green" | "red" | "blue" | "orange" | "neutral"> = {
  satisfied:    "green",
  unsatisfied:  "red",
  no_answer:    "neutral",
  declined:     "red",
  wants_repeat: "blue",
  has_question: "orange",
  other:        "neutral",
};

interface CustomerRow {
  phone_e164: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  total_orders: number;
  total_spent: number;
  last_order_at: string | null;
  default_city: string | null;
  do_not_call: boolean;
  last_call_at: string | null;
  last_call_outcome: string | null;
  call_count: number;
  next_followup_at: string | null;
}

interface ListResponse {
  customers: CustomerRow[];
  total: number;
  limit: number;
  offset: number;
}

function formatEUR(n: number | string): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return "€0,00";
  return `€${v.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function customerName(c: CustomerRow): string {
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return full || c.email || c.phone_e164;
}

function customerHref(phone: string): string {
  return `/customers/${encodeURIComponent(phone)}`;
}

export function CustomerListTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<typeof FILTERS[number]["key"]>("all");
  const [sort, setSort] = useState<typeof SORTS[number]["key"]>("last_order_at");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [page, setPage] = useState(0);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 0 when filters/search/sort/dates change
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, filter, sort, from, to]);

  const url = useMemo(() => {
    const sp = new URLSearchParams();
    if (debouncedSearch) sp.set("q", debouncedSearch);
    sp.set("filter", filter);
    sp.set("sort", sort);
    sp.set("order", "desc");
    sp.set("limit", String(PAGE_SIZE));
    sp.set("offset", String(page * PAGE_SIZE));
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    return `/api/customers/list?${sp.toString()}`;
  }, [debouncedSearch, filter, sort, from, to, page]);

  const hasDateFilter = !!(from || to);

  const { data, isLoading, error } = useSWR<ListResponse>(url, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  const total = data?.total ?? 0;
  const customers = data?.customers ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <>
      {/* Filters bar */}
      <Card className="mb-4">
        <CardBody className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Търси по име, телефон, имейл..."
              className="w-full pl-10 pr-3 py-2.5 text-[13px] bg-surface-2 border border-border rounded-lg text-text placeholder:text-text-3 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`
                  px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors
                  ${filter === f.key
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-text-2 hover:text-text border border-border"}
                `}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Date range — filters by last_order_at */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-text-3 mb-0.5">Поръчки от</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                max={to || undefined}
                className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-[12.5px] text-text focus:outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-text-3 mb-0.5">До</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                min={from || undefined}
                className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-[12.5px] text-text focus:outline-none focus:border-accent"
              />
            </label>
            {hasDateFilter && (
              <button
                type="button"
                onClick={() => { setFrom(""); setTo(""); }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] text-text-3 hover:text-text transition-colors"
              >
                <X size={12} />Изчисти период
              </button>
            )}
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2 text-[12px] text-text-2">
            <span>Сортирай по:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof SORTS[number]["key"])}
              className="bg-surface-2 border border-border rounded-md px-2 py-1 text-[12px] text-text focus:outline-none focus:border-accent"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <span className="ml-auto">
              {total > 0 ? `${showingFrom}–${showingTo} от ${total.toLocaleString("bg-BG")}` : "—"}
            </span>
          </div>
        </CardBody>
      </Card>

      {/* Body: table on desktop, cards on mobile */}
      {error ? (
        <Card><CardBody>
          <div className="text-center py-8">
            <AlertCircle size={28} className="text-red mx-auto mb-2" />
            <p className="text-[14px] text-text">Грешка при зареждане</p>
          </div>
        </CardBody></Card>
      ) : isLoading ? (
        <div className="space-y-2">
          {[1,2,3,4,5,6,7,8].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : customers.length === 0 ? (
        <Card><CardBody>
          <div className="text-center py-12">
            <Users size={32} className="text-text-3 mx-auto mb-3" />
            <p className="text-[14px] text-text mb-1">Няма клиенти за тези филтри</p>
            <p className="text-[13px] text-text-2">Опитай с друго търсене или филтър.</p>
          </div>
        </CardBody></Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2 text-text-2 text-[12px]">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Име</th>
                    <th className="text-left px-4 py-2.5 font-medium">Град</th>
                    <th className="text-right px-4 py-2.5 font-medium">Поръчки</th>
                    <th className="text-right px-4 py-2.5 font-medium">Похарчено</th>
                    <th className="text-left px-4 py-2.5 font-medium">Последна поръчка</th>
                    <th className="text-left px-4 py-2.5 font-medium">Последно обаждане</th>
                    <th className="text-center px-4 py-2.5 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr
                      key={c.phone_e164}
                      className="border-t border-border hover:bg-surface-2 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link href={customerHref(c.phone_e164)} className="block">
                          <div className="font-medium text-text">{customerName(c)}</div>
                          <div className="text-[12px] text-text-3 flex items-center gap-1 mt-0.5">
                            <Phone size={11} />{c.phone_e164}
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-text-2">{c.default_city || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.total_orders}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatEUR(c.total_spent)}</td>
                      <td className="px-4 py-3 text-text-2">{formatDate(c.last_order_at)}</td>
                      <td className="px-4 py-3">
                        {c.last_call_at ? (
                          <div className="flex items-center gap-2">
                            <span className="text-text-2">{formatDate(c.last_call_at)}</span>
                            {c.last_call_outcome && (
                              <Badge variant={OUTCOME_VARIANT[c.last_call_outcome] || "neutral"}>
                                {OUTCOME_LABEL[c.last_call_outcome] || c.last_call_outcome}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {c.do_not_call ? (
                          <Badge variant="red"><PhoneOff size={11} />Не звъни</Badge>
                        ) : c.next_followup_at && new Date(c.next_followup_at) <= new Date() ? (
                          <Badge variant="orange">Follow-up</Badge>
                        ) : c.total_orders >= 2 ? (
                          <Badge variant="green">Повторен</Badge>
                        ) : (
                          <span className="text-text-3 text-[12px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {customers.map((c) => (
              <Link key={c.phone_e164} href={customerHref(c.phone_e164)} className="block">
                <Card hover>
                  <CardBody className="!p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="font-medium text-text truncate">{customerName(c)}</div>
                        <div className="text-[12px] text-text-3 flex items-center gap-1 mt-0.5">
                          <Phone size={11} />{c.phone_e164}
                        </div>
                        {c.default_city && (
                          <div className="text-[12px] text-text-3 flex items-center gap-1 mt-0.5">
                            <MapPin size={11} />{c.default_city}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold text-text tabular-nums">{formatEUR(c.total_spent)}</div>
                        <div className="text-[12px] text-text-3">{c.total_orders} поръчки</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                      <div className="text-[12px] text-text-2">
                        {c.last_call_at ? (
                          <span>Звънено: {formatDate(c.last_call_at)}</span>
                        ) : (
                          <span className="text-text-3">Без обаждане</span>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {c.last_call_outcome && (
                          <Badge variant={OUTCOME_VARIANT[c.last_call_outcome] || "neutral"}>
                            {OUTCOME_LABEL[c.last_call_outcome] || c.last_call_outcome}
                          </Badge>
                        )}
                        {c.do_not_call && (
                          <Badge variant="red"><PhoneOff size={11} />Не звъни</Badge>
                        )}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-[13px]">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft size={14} />Назад
              </Button>
              <span className="text-text-2 tabular-nums">
                Стр. {page + 1} от {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Напред<ChevronRight size={14} />
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
