import { connectPrim } from "@/lib/prim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Pull PRIM data over MCP and compute the daily inventory forecast, recipes
 * and recent work orders — the same logic as the local /nalichnosti routine,
 * running server-side so a Vercel Cron can refresh it unattended.
 */

const OFFICE_STORE = 21884; // Офис Склад (готова стока)
const PROD_STORE = 21882; // Склад производство (суровини)
const LEAD_TIME = 45;
const TARGET_COVER = 90;
const ROUND = 50;
const OP_RE = /Смесване|Разливане|Поставяне|Броене|Капсулиране|Таблетиране|Опако|Етикетиране|Пакетиране/i;
const RAW_MEASURES = new Set(["Килограм", "Литър", "Грам", "Милилитър"]);

// Комбо/промо пакет? ВАЖНО: „+" в химично име (Д3+К2+Q10) НЕ е комбо.
// Истинско комбо = ключова дума, или свързани имена с „ + " (с интервали),
// или 2+ разфасовки (напр. „...40 ТАБЛ + ...30 КАПС").
function isBundleName(name: string): boolean {
  if (/ПОДАРЪК|ПАКЕТ|ПРОМО|шейкър|2\s*[ХX]|[ХX]\s*2/i.test(name)) return true;
  if (/ \+ /.test(name)) return true;
  const units = (name.match(/\d+\s*(?:ТАБЛЕТКИ|ТАБЛ|ТАБ|КАПСУЛИ|КАПС|СОФТГЕЛ|МЛ|ГР|G|САШЕ)/gi) || []).length;
  return units >= 2;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(base: Date, n: number): string {
  return ymd(new Date(base.getTime() - n * 86400000));
}

interface AvailRow { item_id: number | string; sku: number | string; item_name: string; store_id: number; quantity: string; quantity_on_stock: string; quantity_blocked: string }
interface WoRow { num: string; for_date: string; item_id: string; item_nm: string; measure_nm: string; quantity: number }

// TSV връща от getSalesData/getRowsData: {data:"header\nrow..."}
function tsv(res: { data?: string }): string[][] {
  if (!res?.data) return [];
  const lines = res.data.trim().split("\n");
  return lines.slice(1).map((l) => l.split("\t"));
}

export async function refreshForecast(): Promise<{ ok: boolean; singles: number; ishleme: number; recipes: number; as_of: string }> {
  const prim = await connectPrim();
  const today = new Date();
  const asOf = ymd(today);

  // продукти по списък: „stoki" (Цветита Хербал) и „ishleme" (ИШЛЕМЕТА)
  const { data: ownRows } = await supabaseAdmin.from("prim_own_items").select("item_id, sku, name, list");
  if (!ownRows || ownRows.length === 0) throw new Error("prim_own_items празна — нужно е зареждане на номенклатурата.");
  const stoki = new Map(ownRows.filter((r) => r.list !== "ishleme").map((r) => [String(r.item_id), r]));
  const ishlemeItems = new Map(ownRows.filter((r) => r.list === "ishleme").map((r) => [String(r.item_id), r]));
  const tracked = new Set(ownRows.map((r) => String(r.item_id))); // за рецепти + recentWO

  // --- наличности ---
  const avail = await prim.callTool<{ result: AvailRow[] }>("Availabilities-get", { have_availability: true });
  const office = new Map<string, { sku: string; name: string; free: number; onStock: number; blocked: number }>();
  const rawStock: Record<string, number> = {};
  for (const r of avail.result ?? []) {
    const id = String(r.item_id);
    if (r.store_id === OFFICE_STORE) {
      office.set(id, { sku: String(r.sku), name: r.item_name, free: +r.quantity, onStock: +r.quantity_on_stock, blocked: +r.quantity_blocked });
    }
    if (r.store_id === PROD_STORE) {
      const nm = String(r.item_name).trim();
      rawStock[nm] = (rawStock[nm] || 0) + +r.quantity;
    }
  }

  // --- скорост (брутни продажби) ---
  // ВАЖНО: ползваме getRowsData (ch_rows = истински редове на документите), НЕ
  // getSalesData (ch_query_orders) — последното дублира редове при поръчки с
  // няколко свързани експедиции/плащания и надува количествата (напр. една
  // едро-поръчка от 100 се брои като 200). ch_rows съвпада с PRIM справките.
  const vel = async (from: string): Promise<Map<string, number>> => {
    const res = await prim.callTool<{ data?: string }>("DataAnalyses-getRowsData", {
      types: ["so"],
      select: [{ col: "item_id" }, { agg: "sum", col: "quantity", as: "q" }],
      where: [
        { col: "for_date", op: "between", value: [from, asOf] },
        { col: "quantity", op: ">", value: "0" },
        { col: "credit", op: "=", value: "0" },
        { col: "debit", op: "=", value: "0" },
      ],
      group_by: ["item_id"],
      limit: 3000,
    });
    return new Map(tsv(res).map((r) => [r[0], +r[1]]));
  };
  const [g30, g60, g90] = await Promise.all([vel(daysAgo(today, 30)), vel(daysAgo(today, 60)), vel(daysAgo(today, 90))]);

  // --- forecast (обща функция за двата списъка) ---
  const status = (c: number) => (c <= 30 ? "crit" : c <= 60 ? "order" : c <= 90 ? "watch" : "ok");
  type Item = { item_id: string; sku: string; name: string };
  const buildForecast = (itemMap: Map<string, Item>, includeAll: boolean) => {
    const buckets = { crit: 0, order: 0, watch: 0, ok: 0 };
    const rows: Record<string, unknown>[] = [];
    const noStock: { id: string; name: string }[] = [];
    for (const id of itemMap.keys()) {
      const q90 = Math.max(0, g90.get(id) || 0);
      const q60 = Math.max(0, g60.get(id) || 0);
      const q30 = Math.max(0, g30.get(id) || 0);
      const o = office.get(id);
      const it = itemMap.get(id)!;
      const name = o?.name || it.name;
      const free = o ? o.free : 0;
      if (!includeAll && q90 <= 0 && q60 <= 0 && q30 <= 0) continue; // без продажби
      if (/\d\s*\+\s*\d/.test(name)) continue; // промо варианти (2+1 / 3+2)
      const isBundle = isBundleName(name);
      if (isBundle && free <= 0) { noStock.push({ id, name }); continue; }
      const d30 = q30 / 30, d90 = q90 / 90, daily = Math.max(d30, d90);
      if (!includeAll && daily <= 0 && free > 0) continue; // има стока, няма продажби
      const cover = daily > 0 ? free / daily : 0;
      const stockout = ymd(new Date(today.getTime() + cover * 86400000));
      let suggest = daily * (LEAD_TIME + TARGET_COVER) - free;
      suggest = suggest > 0 ? Math.ceil(suggest / ROUND) * ROUND : 0;
      let prodQty = (q60 / 2) * 3 - free;
      prodQty = prodQty > 0 ? Math.ceil(prodQty / ROUND) * ROUND : 0;
      buckets[status(cover)]++;
      rows.push({ id, name, sku: o?.sku ?? String(it.sku), free, onStock: o?.onStock ?? 0, blocked: o?.blocked ?? 0, q30, q60, q90, d30, d90, daily, cover, stockout, suggest, prodQty, isBundle, trend: d90 > 0 ? d30 / d90 : (d30 > 0 ? 2 : 1) });
    }
    rows.sort((a, b) => (a.cover as number) - (b.cover as number));
    return { rows, noStock, buckets };
  };
  const st = buildForecast(stoki, false);
  const buckets = st.buckets;
  const noStock = st.noStock;
  const singles = st.rows.filter((r) => !r.isBundle);
  const bundles = st.rows.filter((r) => r.isBundle);
  // ишлеме: показваме ВСИЧКИ продукти (за да пускаме възлагателни писма и без продажби)
  const ishleme = buildForecast(ishlemeItems, true).rows;

  // --- работни поръчки: рецепти + recentWO ---
  const woRes = await prim.callTool<{ data?: string }>("DataAnalyses-getRowsData", {
    types: ["work_order"],
    select: [{ col: "num" }, { col: "for_date" }, { col: "item_id" }, { col: "item_nm" }, { col: "measure_nm" }, { col: "quantity" }],
    where: [{ col: "for_date", op: ">=", value: daysAgo(today, 420) }],
    order_by: [{ col: "for_date", dir: "desc" }],
    limit: 10000,
  });
  const woRows: WoRow[] = tsv(woRes).map((c) => ({ num: c[0], for_date: c[1], item_id: c[2], item_nm: c[3], measure_nm: c[4], quantity: parseFloat(c[5]) }));
  const byWo = new Map<string, { for_date: string; rows: WoRow[] }>();
  for (const r of woRows) {
    if (!byWo.has(r.num)) byWo.set(r.num, { for_date: r.for_date, rows: [] });
    byWo.get(r.num)!.rows.push(r);
  }
  const allItems = new Map<string, Item>([...stoki, ...ishlemeItems]);
  const recipeByProduct = new Map<string, Record<string, unknown>>();
  const recentWO: { item_id: string; wo_num: string; date: string; qty: number }[] = [];
  for (const [num, w] of byWo) {
    const outputs = w.rows.filter((r) => tracked.has(r.item_id) && r.quantity > 0);
    for (const o of outputs) recentWO.push({ item_id: o.item_id, wo_num: num, date: w.for_date, qty: o.quantity });
    if (!outputs.length) continue;
    const output = outputs.sort((a, b) => b.quantity - a.quantity)[0];
    if (recipeByProduct.has(output.item_id)) continue; // сортирано desc -> първата е най-нова
    const components = [];
    for (const r of w.rows) {
      if (r === output || tracked.has(r.item_id) || !(r.quantity > 0)) continue;
      if (!RAW_MEASURES.has(r.measure_nm) && OP_RE.test(r.item_nm)) continue; // операция/труд
      const kind = RAW_MEASURES.has(r.measure_nm) ? "raw" : "pack";
      const measure = RAW_MEASURES.has(r.measure_nm) ? (r.measure_nm.includes("итър") ? "л" : "кг") : "бр";
      components.push({ name: r.item_nm.trim(), measure, qty_per_batch: r.quantity, kind });
    }
    if (!components.length) continue;
    const it = allItems.get(output.item_id)!;
    recipeByProduct.set(output.item_id, { item_id: output.item_id, sku: String(it.sku), item_name: it.name, batch_qty: output.quantity, wo_num: num, components });
  }

  // --- запис ---
  const payload = { today: asOf, buckets, singles, bundles, noStock, rawStock, recentWO, ishleme };
  const { error: e1 } = await supabaseAdmin.from("inventory_forecast").insert({ as_of: asOf, payload });
  if (e1) throw new Error("snapshot insert: " + e1.message);
  const recipeRows = [...recipeByProduct.values()];
  if (recipeRows.length) {
    const { error: e2 } = await supabaseAdmin.from("product_recipes").upsert(recipeRows, { onConflict: "item_id" });
    if (e2) logger.error("recipes upsert failed", { error: e2.message });
  }

  // --- авто-сверка на производството: попълва produced_qty на отворените заявки
  //     от работните поръчки (сума произведено за продукта след издаване) ---
  let reconciled = 0;
  const { data: openOrders } = await supabaseAdmin
    .from("production_orders")
    .select("id, issued_date, items, status")
    .neq("status", "done");
  for (const ord of openOrders ?? []) {
    let changed = false;
    const items = (ord.items as OrderItem[]).map((it) => {
      const woSum = recentWO
        .filter((w) => String(w.item_id) === String(it.item_id) && w.date >= ord.issued_date)
        .reduce((a, w) => a + w.qty, 0);
      const cur = it.produced_qty != null ? it.produced_qty : it.status === "produced" ? it.qty : 0;
      const next = Math.max(cur, woSum); // производството само нараства
      if (next === cur) return it;
      changed = true;
      const full = next >= it.qty;
      return { ...it, produced_qty: next, status: full ? "produced" : "pending", produced_date: full ? it.produced_date ?? asOf : it.produced_date ?? null };
    });
    const allDone = items.every((it) => (it.produced_qty ?? 0) >= it.qty);
    if (changed || (allDone && ord.status !== "done")) {
      await supabaseAdmin.from("production_orders").update({ items, status: allDone ? "done" : "open", updated_at: new Date().toISOString() }).eq("id", ord.id);
      reconciled++;
    }
  }

  logger.info("PRIM forecast refreshed", { as_of: asOf, singles: singles.length, ishleme: ishleme.length, recipes: recipeRows.length, ordersReconciled: reconciled });
  return { ok: true, singles: singles.length, ishleme: ishleme.length, recipes: recipeRows.length, as_of: asOf };
}

interface OrderItem {
  item_id: string;
  qty: number;
  status?: "pending" | "produced";
  produced_qty?: number | null;
  produced_date?: string | null;
}
