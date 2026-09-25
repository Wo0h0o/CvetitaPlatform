import { connectPrim } from "@/lib/prim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Refresh the raw-material catalogue for the Private-Label pricing module.
 * Pulls all raw materials (tp="material", measured in kg) from PRIM and their
 * last purchase price (€/kg) from the `__SAVED_PO_PRICES__` price list, then
 * upserts them into `pl_materials`.
 */

interface PrimItem {
  id: number | string;
  sku: number | string;
  name: string;
  tp?: string;
  group?: { id?: number | string };
  measures?: { code?: string; name?: string }[];
}

const CAPSULE_GROUP = "81000110737150"; // „КАПСУЛИ и СИЛИГА ГЕЛ" — празни капсули
// Опаковъчни материали (флакони/капачки/чашки/лъжички + етикети/кутии) — за операциите.
const PACKAGING_GROUPS: Record<string, string> = {
  "81000110737324": "Флакони, капачки",
  "81000110736948": "Етикети и кутии",
};
interface PriceRow {
  sku: number | string;
  price: number | string;
  currency?: string;
  measure_code?: string;
}

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export async function refreshMaterials(): Promise<{ ok: boolean; materials: number; priced: number; capsules: number; packaging: number }> {
  const prim = await connectPrim();

  const all = (await prim.callTool<{ result?: PrimItem[] }>("Items-get", { limit: 10000 })).result ?? [];
  const materials = all.filter((i) => i.tp === "material" && (i.measures ?? []).some((m) => m.code === "kg"));
  const capsules = all.filter(
    (i) => i.tp === "material" && String(i.group?.id ?? "") === CAPSULE_GROUP && /^\s*капсула/i.test(i.name || "")
  );
  const packaging = all.filter((i) => i.tp === "material" && !!PACKAGING_GROUPS[String(i.group?.id ?? "")]);

  // последна доставна цена от ценова листа __SAVED_PO_PRICES__ (на партиди)
  const priceBySku = new Map<string, { price: number; currency: string }>();
  const skus = [...new Set([...materials, ...capsules, ...packaging].map((m) => String(m.sku)).filter(Boolean))];
  for (const part of chunk(skus, 100)) {
    try {
      const pr = await prim.callTool<{ result?: PriceRow[] }>("Prices-get", {
        data: part.map((sku) => ({ sku, pricelist_code: "__SAVED_PO_PRICES__" })),
      });
      for (const p of pr.result ?? []) {
        priceBySku.set(String(p.sku), { price: parseFloat(String(p.price)), currency: p.currency || "EUR" });
      }
    } catch (e) {
      logger.warn("pricing: price chunk failed", { error: String(e) });
    }
  }

  const now = new Date().toISOString();
  const rows = materials.map((m) => {
    const p = priceBySku.get(String(m.sku));
    return {
      item_id: Number(m.id),
      sku: String(m.sku),
      name: m.name,
      unit: "kg",
      price_eur: p ? p.price : null,
      price_updated: p ? now : null,
      updated_at: now,
    };
  });

  if (rows.length) {
    const { error } = await supabaseAdmin.from("pl_materials").upsert(rows, { onConflict: "item_id" });
    if (error) throw new Error(`pl_materials upsert: ${error.message}`);
  }

  // капсули (цена за 1 капсула)
  const capRows = capsules.map((c) => {
    const p = priceBySku.get(String(c.sku));
    return { item_id: Number(c.id), sku: String(c.sku), name: c.name, price_eur: p ? p.price : null, updated_at: now };
  });
  if (capRows.length) {
    const { error } = await supabaseAdmin.from("pl_capsules").upsert(capRows, { onConflict: "item_id" });
    if (error) throw new Error(`pl_capsules upsert: ${error.message}`);
  }

  // опаковки (цена за 1 бр)
  const packRows = packaging.map((c) => {
    const p = priceBySku.get(String(c.sku));
    return {
      item_id: Number(c.id),
      sku: String(c.sku),
      name: c.name,
      category: PACKAGING_GROUPS[String(c.group?.id ?? "")] ?? null,
      price_eur: p ? p.price : null,
      updated_at: now,
    };
  });
  if (packRows.length) {
    const { error } = await supabaseAdmin.from("pl_packaging").upsert(packRows, { onConflict: "item_id" });
    if (error) throw new Error(`pl_packaging upsert: ${error.message}`);
  }

  const priced = rows.filter((r) => r.price_eur != null).length;
  logger.info("pricing materials refreshed", { materials: rows.length, priced, capsules: capRows.length, packaging: packRows.length });
  return { ok: true, materials: rows.length, priced, capsules: capRows.length, packaging: packRows.length };
}
