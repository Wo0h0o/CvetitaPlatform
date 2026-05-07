"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  ArrowLeft, Phone, Mail, MapPin, Package, Euro, Calendar, PhoneCall,
  StickyNote, AlertCircle, PhoneOff, Clock, CheckCircle2, XCircle,
  ArrowDownNarrowWide, ArrowUpNarrowWide, X, Truck, Home, Target,
  type LucideIcon,
} from "lucide-react";
import { LogEntryForm } from "../_components/LogEntryForm";
import { ProfileSettings } from "../_components/ProfileSettings";
import { UpsellWidget } from "../_components/UpsellWidget";

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
  return json;
});

interface Customer {
  phone_e164: string;
  phone_raw: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  total_orders: number;
  total_spent: number;
  first_order_at: string | null;
  last_order_at: string | null;
  default_city: string | null;
  default_address: string | null;
  country: string | null;
  notes: string | null;
  preferred_call_hour: string | null;
  do_not_call: boolean;
  pending_upsell_agent_id: string | null;
  pending_upsell_at: string | null;
  pending_upsell_expires_at: string | null;
  created_at: string;
}

interface LineItem {
  title?: string;
  name?: string;
  quantity?: number;
  variant_title?: string | null;
  sku?: string | null;
  price?: string | number;
}

interface OrderRow {
  shopify_order_id: number;
  shopify_order_number: string;
  total_price: string;
  subtotal_price: string;
  total_discounts: string;
  total_refunded: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  event_type: string;
  line_items: LineItem[];
  shopify_created_at: string;
  shipping_title: string | null;
  shipping_address: string | null;
  attributed_agent_id: string | null;
  attribution_source: string | null;
  attribution_revoked: boolean;
}

interface CallLogEntry {
  id: number;
  customer_phone_e164: string;
  agent_user_id: string | null;
  kind: "call" | "note";
  outcome: string | null;
  body: string | null;
  duration_seconds: number | null;
  follow_up_at: string | null;
  created_at: string;
}

interface AgentInfo {
  name: string;
  email: string | null;
}

interface ProfileData {
  customer: Customer;
  orders: OrderRow[];
  call_log: CallLogEntry[];
  agents: Record<string, AgentInfo>;
}

const OUTCOME_LABEL: Record<string, string> = {
  satisfied:    "Доволен",
  unsatisfied:  "Недоволен",
  no_answer:    "Не вдига",
  declined:     "Отказва",
  wants_repeat: "Иска повторна",
  has_question: "Има въпрос",
  other:        "Друго",
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

const FIN_LABEL: Record<string, string> = {
  paid:               "Платена",
  pending:            "Изчаква",
  partially_paid:     "Частично",
  authorized:         "Авторизирана",
  refunded:           "Върната",
  partially_refunded: "Част. върната",
  voided:             "Отменена",
};

const FIN_VARIANT: Record<string, "green" | "red" | "blue" | "orange" | "neutral"> = {
  paid:               "green",
  pending:            "orange",
  partially_paid:     "orange",
  authorized:         "blue",
  refunded:           "red",
  partially_refunded: "orange",
  voided:             "neutral",
};

function formatEUR(n: number | string, currency = "EUR"): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return "—";
  const symbol = currency === "EUR" ? "€" : currency;
  return `${symbol}${v.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds < 0) return null;
  if (seconds < 60) return `${seconds}с`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}мин ${s}с` : `${m}мин`;
}

function customerName(c: Customer): string {
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return full || c.email || c.phone_e164;
}

function itemTitle(item: LineItem): string {
  const base = item.title || item.name || "Артикул";
  return item.variant_title ? `${base} — ${item.variant_title}` : base;
}

interface ParsedShipping {
  carrier: string;
  method: "office" | "home" | "unknown";
  location: string | null;
}

const CARRIER_PATTERNS: Array<{ re: RegExp; carrier: string }> = [
  { re: /еконт|econt/i,        carrier: "Еконт" },
  { re: /спиди|speedy/i,       carrier: "Спиди" },
  { re: /box\s*now/i,          carrier: "BoxNow" },
  { re: /sameday|самдей/i,     carrier: "Sameday" },
];

function parseShipping(title: string | null, address: string | null): ParsedShipping | null {
  if (!title && !address) return null;

  const haystack = `${title || ""} ${address || ""}`;
  let carrier = "Доставка";
  for (const p of CARRIER_PATTERNS) {
    if (p.re.test(haystack)) { carrier = p.carrier; break; }
  }

  const t = title || "";
  let method: ParsedShipping["method"] = "unknown";
  if (/офис/i.test(t)) method = "office";
  else if (/адрес|до адрес|home/i.test(t)) method = "home";

  // For office deliveries the address1 starts with "Офис <Carrier> <City> <Branch>: ..."
  // Trim the colon-suffix and the leading "Офис <Carrier>" so we keep only the location.
  let location: string | null = address?.trim() || null;
  if (location && method === "office") {
    const beforeColon = location.split(":")[0];
    location = beforeColon
      .replace(/^офис\s+(econt|еконт|спиди|speedy|boxnow|box\s*now|sameday|самдей)\s+/i, "")
      .trim() || null;
  }

  return { carrier, method, location };
}

export default function CustomerProfilePage({
  params,
}: {
  params: Promise<{ phone: string }>;
}) {
  const { phone: phoneParam } = use(params);
  const phone = decodeURIComponent(phoneParam);
  const apiUrl = `/api/customers/${encodeURIComponent(phone)}`;

  const { data, error, isLoading, mutate } = useSWR<ProfileData>(apiUrl, fetcher, {
    revalidateOnFocus: false,
  });

  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Order timeline filters (client-side; the API returns the full list)
  const [orderFrom, setOrderFrom] = useState<string>("");
  const [orderTo, setOrderTo] = useState<string>("");
  const [orderAsc, setOrderAsc] = useState<boolean>(false); // false = newest first

  const filteredOrders = useMemo<OrderRow[]>(() => {
    if (!data?.orders) return [];
    const from = orderFrom ? new Date(`${orderFrom}T00:00:00`).getTime() : null;
    const to = orderTo ? new Date(`${orderTo}T23:59:59.999`).getTime() : null;
    const filtered = data.orders.filter((o) => {
      const t = new Date(o.shopify_created_at).getTime();
      if (Number.isNaN(t)) return false;
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      return true;
    });
    filtered.sort((a, b) => {
      const at = new Date(a.shopify_created_at).getTime();
      const bt = new Date(b.shopify_created_at).getTime();
      return orderAsc ? at - bt : bt - at;
    });
    return filtered;
  }, [data?.orders, orderFrom, orderTo, orderAsc]);

  const hasOrderFilters = !!(orderFrom || orderTo);
  const clearOrderFilters = () => { setOrderFrom(""); setOrderTo(""); };

  if (isLoading) {
    return (
      <>
        <PageHeader title="Зареждане..." />
        <Skeleton className="h-32 w-full mb-4 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-48 lg:col-span-2 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader title="Профил на клиент" />
        <Card><CardBody>
          <div className="text-center py-10">
            <AlertCircle size={32} className="text-red mx-auto mb-3" />
            <p className="text-[14px] text-text mb-1">
              {error?.message === "Customer not found" ? "Клиентът не е намерен" : "Грешка при зареждане"}
            </p>
            <Link href="/customers" className="text-[13px] text-accent hover:underline mt-3 inline-block">
              ← Към списъка
            </Link>
          </div>
        </CardBody></Card>
      </>
    );
  }

  const { customer, call_log, agents } = data;
  const totalOrders = data.orders.length;
  const agentName = (id: string | null) => (id && agents[id]?.name) || null;

  return (
    <>
      <PageHeader title={customerName(customer)}>
        <Link
          href="/customers"
          className="text-[13px] text-text-2 hover:text-text inline-flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft size={14} />Списък
        </Link>
      </PageHeader>

      {/* Hero / contact summary */}
      <Card className="mb-4">
        <CardBody>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[18px] font-semibold text-text">{customerName(customer)}</h2>
                {customer.do_not_call && (
                  <Badge variant="red"><PhoneOff size={11} />Не звъни</Badge>
                )}
                {customer.total_orders >= 2 && (
                  <Badge variant="green">Повторен</Badge>
                )}
                {customer.preferred_call_hour && (
                  <Badge variant="blue"><Clock size={11} />{customer.preferred_call_hour}</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-text-2">
                <span className="inline-flex items-center gap-1.5">
                  <Phone size={12} />{customer.phone_e164}
                </span>
                {customer.email && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail size={12} />{customer.email}
                  </span>
                )}
                {customer.default_city && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={12} />
                    {customer.default_city}{customer.default_address ? ` · ${customer.default_address}` : ""}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5 md:text-right">
              <KpiCell icon={Package} label="Поръчки" value={String(customer.total_orders)} />
              <KpiCell icon={Euro} label="Похарчено" value={formatEUR(customer.total_spent)} highlight />
              <KpiCell icon={Calendar} label="Първа" value={formatDate(customer.first_order_at)} small />
              <KpiCell icon={Calendar} label="Последна" value={formatDate(customer.last_order_at)} small />
            </div>
          </div>
        </CardBody>
      </Card>

      {feedback && (
        <div className={`mb-4 p-3 rounded-lg text-[13px] flex items-center gap-2
          ${feedback.kind === "success" ? "bg-accent-soft text-accent" : "bg-red-soft text-red"}`}>
          {feedback.kind === "success" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {feedback.text}
        </div>
      )}

      {/* Upsell tracking */}
      <div className="mb-3">
        <UpsellWidget
          phone={phone}
          pendingAgentId={customer.pending_upsell_agent_id}
          pendingAt={customer.pending_upsell_at}
          pendingExpiresAt={customer.pending_upsell_expires_at}
          agentName={agentName(customer.pending_upsell_agent_id)}
          onSuccess={() => {
            setFeedback({ kind: "success", text: "Upsell статусът е обновен." });
            mutate();
            setTimeout(() => setFeedback(null), 3000);
          }}
          onError={(msg) => {
            setFeedback({ kind: "error", text: msg });
            setTimeout(() => setFeedback(null), 4500);
          }}
        />
      </div>

      {/* Log entry form */}
      <LogEntryForm
        phone={phone}
        onSuccess={() => {
          setFeedback({ kind: "success", text: "Записът е добавен." });
          mutate();
          setTimeout(() => setFeedback(null), 3000);
        }}
        onError={(msg) => {
          setFeedback({ kind: "error", text: msg });
          setTimeout(() => setFeedback(null), 4500);
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* Left: timelines */}
        <div className="lg:col-span-2 space-y-4">
          {/* Call log timeline */}
          <Card>
            <CardHeader>Дневник ({call_log.length})</CardHeader>
            <CardBody>
              {call_log.length === 0 ? (
                <p className="text-[13px] text-text-3 text-center py-6">Няма обаждания или бележки.</p>
              ) : (
                <ol className="space-y-3">
                  {call_log.map((e) => {
                    const Icon = e.kind === "call" ? PhoneCall : StickyNote;
                    const dur = formatDuration(e.duration_seconds);
                    return (
                      <li key={e.id} className="flex gap-3">
                        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                          ${e.kind === "call" ? "bg-blue-soft text-blue" : "bg-orange-soft text-orange"}`}>
                          <Icon size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-0.5">
                            <span className="text-[13px] font-medium text-text">
                              {e.kind === "call" ? "Обаждане" : "Бележка"}
                            </span>
                            {e.outcome && (
                              <Badge variant={OUTCOME_VARIANT[e.outcome] || "neutral"}>
                                {OUTCOME_LABEL[e.outcome] || e.outcome}
                              </Badge>
                            )}
                            {dur && <span className="text-[12px] text-text-3">· {dur}</span>}
                            {agentName(e.agent_user_id) && (
                              <span className="text-[12px] text-text-3">· {agentName(e.agent_user_id)}</span>
                            )}
                            <span className="text-[12px] text-text-3 ml-auto">{formatDate(e.created_at, true)}</span>
                          </div>
                          {e.body && (
                            <p className="text-[13px] text-text-2 whitespace-pre-wrap break-words">{e.body}</p>
                          )}
                          {e.follow_up_at && (
                            <p className="text-[12px] text-orange mt-1 inline-flex items-center gap-1">
                              <Clock size={11} />Follow-up: {formatDate(e.follow_up_at, true)}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardBody>
          </Card>

          {/* Orders timeline */}
          <Card>
            <CardHeader>
              Поръчки ({hasOrderFilters ? `${filteredOrders.length} от ${totalOrders}` : totalOrders})
            </CardHeader>
            <CardBody className="!p-0">
              {totalOrders === 0 ? (
                <p className="text-[13px] text-text-3 text-center py-6">Няма поръчки.</p>
              ) : (
                <>
                  {/* Filter bar */}
                  <div className="flex flex-wrap items-end gap-2 px-5 py-3 border-b border-border bg-surface-2/50">
                    <label className="block">
                      <span className="block text-[11px] uppercase tracking-wide text-text-3 mb-0.5">От</span>
                      <input
                        type="date"
                        value={orderFrom}
                        onChange={(e) => setOrderFrom(e.target.value)}
                        max={orderTo || undefined}
                        className="bg-surface border border-border rounded-md px-2 py-1.5 text-[12.5px] text-text focus:outline-none focus:border-accent"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[11px] uppercase tracking-wide text-text-3 mb-0.5">До</span>
                      <input
                        type="date"
                        value={orderTo}
                        onChange={(e) => setOrderTo(e.target.value)}
                        min={orderFrom || undefined}
                        className="bg-surface border border-border rounded-md px-2 py-1.5 text-[12.5px] text-text focus:outline-none focus:border-accent"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setOrderAsc((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] text-text-2 hover:text-text bg-surface border border-border rounded-md transition-colors"
                      title={orderAsc ? "Най-стари → Най-нови" : "Най-нови → Най-стари"}
                    >
                      {orderAsc ? <ArrowUpNarrowWide size={13} /> : <ArrowDownNarrowWide size={13} />}
                      {orderAsc ? "Най-стари" : "Най-нови"}
                    </button>
                    {hasOrderFilters && (
                      <button
                        type="button"
                        onClick={clearOrderFilters}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] text-text-3 hover:text-text transition-colors"
                      >
                        <X size={12} />Изчисти
                      </button>
                    )}
                  </div>
                  {filteredOrders.length === 0 ? (
                    <p className="text-[13px] text-text-3 text-center py-6">
                      Няма поръчки за избрания период.
                    </p>
                  ) : (
                <ol className="divide-y divide-border">
                  {filteredOrders.map((o) => (
                    <li key={o.shopify_order_id} className="px-5 py-3">
                      <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className="text-[13px] font-medium text-text">{o.shopify_order_number || `#${o.shopify_order_id}`}</span>
                            <Badge variant={FIN_VARIANT[o.financial_status] || "neutral"}>
                              {FIN_LABEL[o.financial_status] || o.financial_status}
                            </Badge>
                            {o.event_type === "cancelled" && <Badge variant="red">Отменена</Badge>}
                            {o.attributed_agent_id && !o.attribution_revoked && (
                              <Badge variant="blue">
                                <Target size={11} />
                                Upsell{agentName(o.attributed_agent_id) ? ` · ${agentName(o.attributed_agent_id)}` : ""}
                              </Badge>
                            )}
                            {o.attributed_agent_id && o.attribution_revoked && (
                              <Badge variant="neutral">Upsell отменен</Badge>
                            )}
                          </div>
                          {Array.isArray(o.line_items) && o.line_items.length > 0 ? (
                            <ul className="space-y-0.5">
                              {o.line_items.map((item, idx) => (
                                <li key={idx} className="text-[12.5px] text-text-2 flex items-baseline gap-2">
                                  <span className="text-text-3 tabular-nums shrink-0">{item.quantity || 1}×</span>
                                  <span className="min-w-0 break-words">{itemTitle(item)}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-[12px] text-text-3">Няма данни за артикулите.</p>
                          )}
                          <ShippingLine title={o.shipping_title} address={o.shipping_address} />
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-medium tabular-nums text-text">{formatEUR(o.total_price, o.currency)}</div>
                          <div className="text-[12px] text-text-3">{formatDate(o.shopify_created_at)}</div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right: notes + profile */}
        <div className="space-y-4">
          <Card>
            <CardHeader>Бележки</CardHeader>
            <CardBody>
              {customer.notes && customer.notes.trim() ? (
                <pre className="text-[12.5px] text-text-2 whitespace-pre-wrap break-words font-sans leading-relaxed max-h-[420px] overflow-auto">
                  {customer.notes}
                </pre>
              ) : (
                <p className="text-[13px] text-text-3">
                  Все още няма. Добави с обаждане или бележка по-горе.
                </p>
              )}
            </CardBody>
          </Card>

          <ProfileSettings
            phone={phone}
            doNotCall={customer.do_not_call}
            preferredCallHour={customer.preferred_call_hour}
            onSuccess={() => {
              setFeedback({ kind: "success", text: "Профилът е обновен." });
              mutate();
              setTimeout(() => setFeedback(null), 3000);
            }}
            onError={(msg) => {
              setFeedback({ kind: "error", text: msg });
              setTimeout(() => setFeedback(null), 4500);
            }}
          />
        </div>
      </div>
    </>
  );
}

function ShippingLine({ title, address }: { title: string | null; address: string | null }) {
  const parsed = parseShipping(title, address);
  if (!parsed) return null;

  const Icon = parsed.method === "home" ? Home : Truck;
  const methodLabel =
    parsed.method === "office" ? "офис" :
    parsed.method === "home"   ? "до адрес" :
    null;

  return (
    <div className="mt-2 pt-2 border-t border-border/50 flex items-start gap-1.5 text-[12px] text-text-3">
      <Icon size={12} className="shrink-0 mt-0.5" />
      <span className="min-w-0 break-words">
        <span className="font-medium text-text-2">{parsed.carrier}</span>
        {methodLabel && <span className="text-text-3"> · {methodLabel}</span>}
        {parsed.location && (
          <>
            <span className="text-text-3"> · </span>
            <span>{parsed.location}</span>
          </>
        )}
      </span>
    </div>
  );
}

function KpiCell({
  icon: Icon, label, value, highlight = false, small = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  highlight?: boolean;
  small?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] text-text-3 uppercase tracking-wide md:justify-end mb-0.5">
        <Icon size={11} />{label}
      </div>
      <div className={`tabular-nums ${small ? "text-[13px]" : "text-[15px]"} ${highlight ? "font-semibold text-accent" : "font-medium text-text"}`}>
        {value}
      </div>
    </div>
  );
}
