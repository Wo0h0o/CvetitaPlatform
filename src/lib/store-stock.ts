import { connectPrim } from "@/lib/prim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Наличности в магазина (baseline-reset модел): всеки ред пази базова наличност `qty`
 * към момент `as_of`. Очаквано сега = qty − продадено след as_of (от store_sales).
 * Зареждане и ревизия „ресетват" базата (нов as_of). Така продаденото се трупа само
 * до следващото зареждане/ревизия.
 */

export const normName = (s: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
export const matchKey = (item_id: number | null | undefined, name: string) =>
  item_id != null ? `id:${item_id}` : `nm:${normName(name)}`;

export interface LoadItem { item_id: number | null; sku: string | null; name: string; qty: number }

/** Карта key → [{date, qty}] от всички продажби на магазина. */
async function salesByKey(storeId: number) {
  const { data } = await supabaseAdmin.from("store_sales").select("sold_at, items").eq("store_id", storeId);
  const map = new Map<string, { date: string; qty: number }[]>();
  for (const s of data ?? []) {
    for (const it of (s.items as { item_id?: number | null; name?: string; qty?: number }[]) ?? []) {
      const key = matchKey(it.item_id ?? null, it.name || "");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ date: s.sold_at as string, qty: Number(it.qty) || 0 });
    }
  }
  return map;
}
const soldSince = (arr: { date: string; qty: number }[] | undefined, asOf: string) => {
  if (!arr) return 0;
  const since = asOf.slice(0, 10);
  return arr.filter((x) => x.date >= since).reduce((a, x) => a + x.qty, 0);
};

export interface StockRow { item_id: number | null; sku: string | null; name: string; match_key: string; loaded: number; sold: number; expected: number; as_of: string }

export async function computeStock(storeId: number): Promise<StockRow[]> {
  const { data: rows } = await supabaseAdmin.from("store_stock").select("*").eq("store_id", storeId).order("name");
  const sales = await salesByKey(storeId);
  return (rows ?? []).map((r) => {
    const sold = soldSince(sales.get(r.match_key), r.as_of as string);
    return { item_id: r.item_id, sku: r.sku, name: r.name, match_key: r.match_key, loaded: Number(r.qty), sold, expected: Number(r.qty) - sold, as_of: r.as_of as string };
  });
}

/** Зареждане: добавя количества към наличността (ресет на базата). */
export async function loadStock(storeId: number, items: LoadItem[], asOfISO: string) {
  const { data: existing } = await supabaseAdmin.from("store_stock").select("match_key, qty, as_of").eq("store_id", storeId);
  const exMap = new Map((existing ?? []).map((r) => [r.match_key as string, r]));
  const sales = await salesByKey(storeId);
  const now = new Date().toISOString();
  const rows = items.filter((it) => (it.name || "").trim() && (Number(it.qty) || 0) !== 0).map((it) => {
    const key = matchKey(it.item_id, it.name);
    const ex = exMap.get(key);
    const curExpected = ex ? Number(ex.qty) - soldSince(sales.get(key), ex.as_of as string) : 0;
    return {
      store_id: storeId,
      item_id: it.item_id ?? null,
      sku: it.sku ?? null,
      name: it.name.trim(),
      match_key: key,
      qty: curExpected + (Number(it.qty) || 0),
      as_of: asOfISO,
      updated_at: now,
    };
  });
  if (rows.length) {
    const { error } = await supabaseAdmin.from("store_stock").upsert(rows, { onConflict: "store_id,match_key" });
    if (error) throw new Error(`store_stock upsert: ${error.message}`);
  }
  return { ok: true, loaded: rows.length };
}

/** Внася начално зареждане от PRIM продажба (DocInfo-get → редове product). */
export async function importSoToStock(storeId: number, soNum: string) {
  const prim = await connectPrim();
  const doc = await prim.callTool<{ result?: { for_date?: string; rows?: { nm?: string; quantity?: string | number; item_tp?: string }[] }[] }>("DocInfo-get", {
    data: [{ type: "so", num: soNum }],
  });
  const d = doc.result?.[0];
  if (!d?.rows?.length) throw new Error(`Няма редове за ${soNum}`);
  const forDate = d.for_date ? String(d.for_date).slice(0, 10) + "T00:00:00Z" : new Date().toISOString();

  // карта име → {item_id, sku} от кешираните продукти
  const { data: prods } = await supabaseAdmin.from("store_products").select("item_id, sku, name");
  const byName = new Map((prods ?? []).map((p) => [normName(p.name), p]));

  // сумиране по име (редовете са чисти, но за всеки случай)
  const agg = new Map<string, { name: string; qty: number }>();
  for (const r of d.rows) {
    if (r.item_tp !== "product") continue;
    const nm = (r.nm || "").trim();
    const q = Number(r.quantity) || 0;
    if (!nm || q <= 0) continue;
    const k = normName(nm);
    if (!agg.has(k)) agg.set(k, { name: nm, qty: 0 });
    agg.get(k)!.qty += q;
  }
  const items: LoadItem[] = [...agg.values()].map((a) => {
    const p = byName.get(normName(a.name));
    return { item_id: p ? Number(p.item_id) : null, sku: p ? p.sku : null, name: a.name, qty: a.qty };
  });
  const res = await loadStock(storeId, items, forDate);
  logger.info("store stock imported from SO", { storeId, soNum, items: items.length });
  return { ...res, items: items.length, so: soNum, date: forDate.slice(0, 10) };
}
