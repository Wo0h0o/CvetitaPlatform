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
const BUNDLE_RE = /\+|ПОДАРЪК|ПАКЕТ|ПРОМО|Х2|2Х|шейкър/i;
const RAW_MEASURES = new Set(["Килограм", "Литър", "Грам", "Милилитър"]);

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

export async function refreshForecast(): Promise<{ ok: boolean; singles: number; recipes: number; as_of: string }> {
  const prim = await connectPrim();
  const today = new Date();
  const asOf = ymd(today);

  // own-production item ids (кеширани от номенклатурата)
  const { data: ownRows } = await supabaseAdmin.from("prim_own_items").select("item_id, sku, name");
  const own = new Map((ownRows ?? []).map((r) => [String(r.item_id), r]));
  if (own.size === 0) throw new Error("prim_own_items празна — нужно е зареждане на номенклатурата.");

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

  // --- скорост (брутни продажби, без груп. филтър) ---
  const vel = async (from: string): Promise<Map<string, number>> => {
    const res = await prim.callTool<{ data?: string }>("DataAnalyses-getSalesData", {
      types: ["so"],
      select: [{ col: "item_id" }, { agg: "sum", col: "quantity", as: "q" }],
      where: [{ col: "for_date", op: "between", value: [from, asOf] }, { col: "quantity", op: ">", value: "0" }],
      group_by: ["item_id"],
      limit: 2000,
    });
    return new Map(tsv(res).map((r) => [r[0], +r[1]]));
  };
  const [g30, g60, g90] = await Promise.all([vel(daysAgo(today, 30)), vel(daysAgo(today, 60)), vel(daysAgo(today, 90))]);

  // --- forecast ---
  const status = (c: number) => (c <= 30 ? "crit" : c <= 60 ? "order" : c <= 90 ? "watch" : "ok");
  const buckets = { crit: 0, order: 0, watch: 0, ok: 0 };
  const rows: Record<string, unknown>[] = [];
  const noStock: { id: string; name: string }[] = [];
  for (const id of own.keys()) {
    const q90 = Math.max(0, g90.get(id) || 0);
    const q60 = Math.max(0, g60.get(id) || 0);
    const q30 = Math.max(0, g30.get(id) || 0);
    if (q90 <= 0 && q60 <= 0 && q30 <= 0) continue;
    const o = office.get(id);
    const it = own.get(id)!;
    const name = o?.name || it.name;
    const isBundle = BUNDLE_RE.test(name);
    const free = o ? o.free : 0;
    // комбо/сглобяем пакет без наличност -> справочно (скрито); продажбата му изписва компонентите
    if (isBundle && free <= 0) { noStock.push({ id, name }); continue; }
    const d30 = q30 / 30, d90 = q90 / 90, daily = Math.max(d30, d90);
    if (daily <= 0 && free > 0) continue; // има стока, няма скорошни продажби -> без интерес
    // нулева наличност + продажби = НАЙ-спешно за производство (cover 0), не се крие
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
  const singles = rows.filter((r) => !r.isBundle);
  const bundles = rows.filter((r) => r.isBundle);

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
  const recipeByProduct = new Map<string, Record<string, unknown>>();
  const recentWO: { item_id: string; wo_num: string; date: string; qty: number }[] = [];
  for (const [num, w] of byWo) {
    const outputs = w.rows.filter((r) => own.has(r.item_id) && r.quantity > 0);
    for (const o of outputs) recentWO.push({ item_id: o.item_id, wo_num: num, date: w.for_date, qty: o.quantity });
    if (!outputs.length) continue;
    const output = outputs.sort((a, b) => b.quantity - a.quantity)[0];
    if (recipeByProduct.has(output.item_id)) continue; // сортирано desc -> първата е най-нова
    const components = [];
    for (const r of w.rows) {
      if (r === output || own.has(r.item_id) || !(r.quantity > 0)) continue;
      if (!RAW_MEASURES.has(r.measure_nm) && OP_RE.test(r.item_nm)) continue; // операция/труд
      const kind = RAW_MEASURES.has(r.measure_nm) ? "raw" : "pack";
      const measure = RAW_MEASURES.has(r.measure_nm) ? (r.measure_nm.includes("итър") ? "л" : "кг") : "бр";
      components.push({ name: r.item_nm.trim(), measure, qty_per_batch: r.quantity, kind });
    }
    if (!components.length) continue;
    const it = own.get(output.item_id)!;
    recipeByProduct.set(output.item_id, { item_id: output.item_id, sku: String(it.sku), item_name: it.name, batch_qty: output.quantity, wo_num: num, components });
  }

  // --- запис ---
  const payload = { today: asOf, buckets, singles, bundles, noStock, rawStock, recentWO };
  const { error: e1 } = await supabaseAdmin.from("inventory_forecast").insert({ as_of: asOf, payload });
  if (e1) throw new Error("snapshot insert: " + e1.message);
  const recipeRows = [...recipeByProduct.values()];
  if (recipeRows.length) {
    const { error: e2 } = await supabaseAdmin.from("product_recipes").upsert(recipeRows, { onConflict: "item_id" });
    if (e2) logger.error("recipes upsert failed", { error: e2.message });
  }

  logger.info("PRIM forecast refreshed", { as_of: asOf, singles: singles.length, recipes: recipeRows.length });
  return { ok: true, singles: singles.length, recipes: recipeRows.length, as_of: asOf };
}
