import { connectPrim } from "@/lib/prim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Синхронизира продаваемите продукти от ПРИМ в `store_products` (кеш за магазинния
 * портал — бързо търсене по име/SKU/баркод, без да удряме ПРИМ при всяко натискане).
 */

interface PrimItem {
  id: number | string;
  sku?: number | string;
  barcode?: number | string;
  name: string;
  tp?: string;
  status?: string;
}

export async function syncStoreProducts(): Promise<{ ok: boolean; products: number }> {
  const prim = await connectPrim();
  const all = (await prim.callTool<{ result?: PrimItem[] }>("Items-get", { item_type: "item", limit: 10000 })).result ?? [];
  // продаваеми = завършени продукти (tp "product"); активни
  const products = all.filter((i) => i.tp === "product" && i.status !== "archive");
  const now = new Date().toISOString();
  const rows = products.map((p) => ({
    item_id: Number(p.id),
    sku: p.sku != null ? String(p.sku) : null,
    barcode: p.barcode != null && String(p.barcode) !== "" ? String(p.barcode) : null,
    name: p.name,
    active: true,
    updated_at: now,
  }));
  if (rows.length) {
    const { error } = await supabaseAdmin.from("store_products").upsert(rows, { onConflict: "item_id" });
    if (error) throw new Error(`store_products upsert: ${error.message}`);
  }
  logger.info("store products synced", { products: rows.length });
  return { ok: true, products: rows.length };
}
