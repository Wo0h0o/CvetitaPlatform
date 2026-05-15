"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
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

// Search/filter state lives in the URL so a click into a customer's profile
// (and the click back) preserves the operator's working set. The list URL
// also seeds the profile page with the same params + an absolute index `i`
// so Prev/Next buttons can navigate the cohort.
const DEFAULT_FILTER = "all";
const DEFAULT_SORT = "last_order_at";

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

/**
 * Build a /customers/{phone} URL that carries the active list filters plus
 * the customer's absolute index in the filtered cohort. The profile page
 * uses these to render Prev/Next buttons and to send the operator back to
 * the right page of the list.
 */
function customerHref(phone: string, params: URLSearchParams, absoluteIndex: number): string {
  const sp = new URLSearchParams(params.toString());
  sp.set("i", String(absoluteIndex));
  return `/customers/${encodeURIComponent(phone)}?${sp.toString()}`;
}

/**
 * Returns the subset of URL search params that describe the list filter
 * state. We strip pagination (`page`) from the customer-row link because
 * the profile page derives the right page from the absolute index `i`.
 */
function cohortParams(sp: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of ["q", "filter", "sort", "from", "to"] as const) {
    const v = sp.get(k);
    if (v) out.set(k, v);
  }
  return out;
}

export function CustomerListTab() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // Filter state derived from URL so it survives navigation to the profile
  // and back. Defaults are elided from the URL to keep links clean.
  const urlQ = sp.get("q") ?? "";
  const urlFilter = (sp.get("filter") as typeof FILTERS[number]["key"]) || DEFAULT_FILTER;
  const urlSort = (sp.get("sort") as typeof SORTS[number]["key"]) || DEFAULT_SORT;
  const urlFrom = sp.get("from") ?? "";
  const urlTo = sp.get("to") ?? "";
  const urlPage = Math.max(0, Number(sp.get("page")) || 0);

  // The search input is the one piece we keep local (for debounce).
  const [search, setSearch] = useState(urlQ);
  // Re-sync when the URL changes externally (e.g. back/forward).
  useEffect(() => {
    setSearch(urlQ);
  }, [urlQ]);

  /**
   * Patches the URL search params. Empty / default values are removed so
   * `/customers` stays clean when no filter is set, and so SWR keys don't
   * thrash on identity values.
   */
  const patchUrl = useCallback(
    (patch: Record<string, string | number | undefined | null>, opts: { resetPage?: boolean } = {}) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, raw] of Object.entries(patch)) {
        const v = raw == null ? "" : String(raw);
        const isDefault =
          v === "" ||
          (k === "filter" && v === DEFAULT_FILTER) ||
          (k === "sort" && v === DEFAULT_SORT) ||
          (k === "page" && v === "0");
        if (isDefault) next.delete(k);
        else next.set(k, v);
      }
      if (opts.resetPage) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, sp]
  );

  // Debounced search → URL.
  useEffect(() => {
    if (search === urlQ) return;
    const t = setTimeout(() => patchUrl({ q: search.trim() }, { resetPage: true }), 300);
    return () => clearTimeout(t);
  }, [search, urlQ, patchUrl]);

  // Aliases so the rest of the render reads naturally.
  const filter = urlFilter;
  const sort = urlSort;
  const from = urlFrom;
  const to = urlTo;
  const page = urlPage;

  const url = useMemo(() => {
    const qs = new URLSearchParams();
    if (urlQ) qs.set("q", urlQ);
    qs.set("filter", filter);
    qs.set("sort", sort);
    qs.set("order", "desc");
    qs.set("limit", String(PAGE_SIZE));
    qs.set("offset", String(page * PAGE_SIZE));
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return `/api/customers/list?${qs.toString()}`;
  }, [urlQ, filter, sort, from, to, page]);

  const hasDateFilter = !!(from || to);
  const cohortSp = useMemo(() => cohortParams(sp), [sp]);

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
                onClick={() => patchUrl({ filter: f.key }, { resetPage: true })}
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
                onChange={(e) => patchUrl({ from: e.target.value }, { resetPage: true })}
                max={to || undefined}
                className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-[12.5px] text-text focus:outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-text-3 mb-0.5">До</span>
              <input
                type="date"
                value={to}
                onChange={(e) => patchUrl({ to: e.target.value }, { resetPage: true })}
                min={from || undefined}
                className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-[12.5px] text-text focus:outline-none focus:border-accent"
              />
            </label>
            {hasDateFilter && (
              <button
                type="button"
                onClick={() => patchUrl({ from: "", to: "" }, { resetPage: true })}
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
              onChange={(e) => patchUrl({ sort: e.target.value }, { resetPage: true })}
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
                  {customers.map((c, idx) => (
                    <tr
                      key={c.phone_e164}
                      className="border-t border-border hover:bg-surface-2 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={customerHref(c.phone_e164, cohortSp, page * PAGE_SIZE + idx)}
                          className="block"
                        >
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
            {customers.map((c, idx) => (
              <Link
                key={c.phone_e164}
                href={customerHref(c.phone_e164, cohortSp, page * PAGE_SIZE + idx)}
                className="block"
              >
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
                onClick={() => patchUrl({ page: Math.max(0, page - 1) })}
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
                onClick={() => patchUrl({ page: Math.min(totalPages - 1, page + 1) })}
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
