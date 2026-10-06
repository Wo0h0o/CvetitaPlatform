import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Месечен касов отчет по шаблона „ОТЧЕТ Магазин": дневните приходи се агрегират от
 * продажбите (оборот в брой / ПОС / НМ), разходите се въвеждат ръчно, НС и „други"
 * се пазят per месец, а резюмето смята общо приход/разход и „в брой без ПОС".
 */

function resolveStore(ctx: { canAllStores: boolean; storeId: number | null }, requested: string | null): number | null {
  if (!ctx.canAllStores) return ctx.storeId;
  return requested ? Number(requested) : null;
}
const nextMonth = (ym: string) => {
  const [y, mo] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo, 1));
  return d.toISOString().slice(0, 10);
};
const n = (v: unknown) => Number(v) || 0;

export async function GET(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const store = resolveStore(ctx, sp.get("store"));
  const month = sp.get("month") || new Date().toISOString().slice(0, 7);
  if (!store) return NextResponse.json({ error: "store required" }, { status: 400 });
  const start = `${month}-01`;
  const end = nextMonth(month);

  const [salesRes, monthRes, expRes] = await Promise.all([
    supabaseAdmin.from("store_sales").select("sold_at, payment, total").eq("store_id", store).gte("sold_at", start).lt("sold_at", end),
    supabaseAdmin.from("store_months").select("opening_ns, other_income, note").eq("store_id", store).eq("month", month).maybeSingle(),
    supabaseAdmin.from("store_expenses").select("*").eq("store_id", store).gte("spent_at", start).lt("spent_at", end).order("spent_at"),
  ]);
  if (salesRes.error) return NextResponse.json({ error: salesRes.error.message }, { status: 500 });

  // дневна агрегация
  const byDay = new Map<string, { day: string; count: number; cash: number; pos: number; nm: number }>();
  for (const s of salesRes.data ?? []) {
    const d = s.sold_at as string;
    if (!byDay.has(d)) byDay.set(d, { day: d, count: 0, cash: 0, pos: 0, nm: 0 });
    const row = byDay.get(d)!;
    row.count++;
    if (s.payment === "cash") row.cash += n(s.total);
    else if (s.payment === "card") row.pos += n(s.total);
    else row.nm += n(s.total);
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));

  const turnoverCash = days.reduce((a, d) => a + d.cash, 0);
  const turnoverPos = days.reduce((a, d) => a + d.pos, 0);
  const turnoverNm = days.reduce((a, d) => a + d.nm, 0);
  const salesCount = days.reduce((a, d) => a + d.count, 0);
  const openingNs = n(monthRes.data?.opening_ns);
  const otherIncome = n(monthRes.data?.other_income);
  const expensesStore = (expRes.data ?? []).reduce((a, e) => a + n(e.amount_store), 0);
  const expensesOther = (expRes.data ?? []).reduce((a, e) => a + n(e.amount_other), 0);
  const totalExpense = expensesStore + expensesOther;
  const totalIncome = openingNs + turnoverCash + turnoverNm + turnoverPos + otherIncome;
  const cashTotal = totalIncome - totalExpense; // общо пари (в брой+ПОС+НМ)
  const cashNoPos = cashTotal - turnoverPos; // в брой без ПОС → НС за следващия месец

  return NextResponse.json({
    month,
    days,
    expenses: expRes.data ?? [],
    meta: { opening_ns: openingNs, other_income: otherIncome, note: monthRes.data?.note ?? "" },
    summary: { salesCount, turnoverCash, turnoverPos, turnoverNm, openingNs, otherIncome, expensesStore, expensesOther, totalExpense, totalIncome, cashTotal, cashNoPos },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const store = resolveStore(ctx, (body.store_id as string) ?? null);
  const month = (body.month as string) || new Date().toISOString().slice(0, 7);
  if (!store) return NextResponse.json({ error: "store required" }, { status: 400 });
  const row = {
    store_id: store,
    month,
    opening_ns: body.opening_ns != null && body.opening_ns !== "" ? Number(body.opening_ns) : 0,
    other_income: body.other_income != null && body.other_income !== "" ? Number(body.other_income) : 0,
    note: (body.note as string) || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from("store_months").upsert(row, { onConflict: "store_id,month" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ meta: data });
}
