/**
 * Pure Private-Label pricing math (no I/O). Mirrors the „система за цени" sheet:
 * cost per pack = raw materials + operations = the offer price (без ДДС).
 */

export interface PlIngredient {
  item_id?: number;
  name: string;
  price_eur: number | string; // последна доставна €/кг
  markup: number; // 1 | 1.2 | 2
  mg_per_tablet: number | string; // мг в таблетка/капсула
}
export interface PlOperation {
  name: string;
  unit_price: number | string;
  kind: "per_unit" | "per_pack"; // per_unit = × брой в опаковка; per_pack = фиксирана
  is_input?: boolean;
  is_labor?: boolean;
  capsule?: string; // избран вид капсула (за „Капсули цена")
}

const n = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return isFinite(x) ? x : 0;
};

/** Ефективна цена €/кг след надценка. */
export const effPricePerKg = (ing: PlIngredient) => n(ing.price_eur) * (ing.markup || 1);
/** Цена за 1 таблетка/капсула от тази съставка (€). */
export const pricePerTablet = (ing: PlIngredient) => (effPricePerKg(ing) / 1_000_000) * n(ing.mg_per_tablet);
/** Цена за цялата опаковка от тази съставка (€). */
export const pricePerPack = (ing: PlIngredient, tabsPerPack: number | string) => pricePerTablet(ing) * n(tabsPerPack);

/** Цена за опаковка на една операция. */
export const opPerPack = (op: PlOperation, tabsPerPack: number | string) =>
  op.kind === "per_unit" ? n(op.unit_price) * n(tabsPerPack) : n(op.unit_price);

export interface PricingTotals {
  totalRaw: number; // Модул 1 — тотал суровини
  totalOps: number; // Модул 2 — тотал операции
  labor: number; // Труд (само операции с is_labor)
  total: number; // Модул 3 — крайна оферта (без ДДС)
}

export function computeTotals(
  ingredients: PlIngredient[],
  operations: PlOperation[],
  tabsPerPack: number | string
): PricingTotals {
  const totalRaw = ingredients.reduce((s, ing) => s + pricePerPack(ing, tabsPerPack), 0);
  const totalOps = operations.reduce((s, op) => s + opPerPack(op, tabsPerPack), 0);
  const labor = operations.filter((op) => op.is_labor).reduce((s, op) => s + opPerPack(op, tabsPerPack), 0);
  return { totalRaw, totalOps, labor, total: totalRaw + totalOps };
}

/** €, до 4 знака (за единични), с BG запетая. */
export const eur = (v: number, dp = 4) =>
  (isFinite(v) ? v : 0).toLocaleString("bg-BG", { minimumFractionDigits: dp, maximumFractionDigits: dp });
