/**
 * Pure Private-Label pricing math (no I/O). Mirrors the „система за цени" sheet:
 * cost per pack = raw materials + operations = the offer price (без ДДС).
 */

export interface PlIngredient {
  item_id?: number;
  name: string;
  price_eur: number | string; // €/кг (доставната от PRIM вече е +20%; полето е редактируемо)
  markup?: number; // (запазено за стари оферти, вече не се ползва)
  mg_per_tablet: number | string; // количество в 1 доза (мг за табл./капс./течни; г за сашета/прахове)
}

/** Надценка над доставната цена от PRIM (по подразбиране +20%). */
export const PRIM_MARKUP = 1.2;
export interface PlOperation {
  name: string;
  unit_price: number | string;
  kind: "per_unit" | "per_pack"; // per_unit = × брой в опаковка; per_pack = фиксирана
  is_input?: boolean;
  is_labor?: boolean;
  capsule?: string; // избран вид капсула (за „Капсули цена")
}

/** Видове продукти — всеки лист от „система за цени.xlsx". */
export type PlProductType = "tablet" | "sachet" | "powder" | "liquid";

export interface PlTypeConfig {
  label: string; // за менюто
  doseLabel: string; // заглавие на колоната с количеството в доза
  doseUnit: string; // мерна единица на дозата
  packLabel: string; // етикет на полето „брой в опаковка"
  packUnit: string; // мерна единица на опаковката
  perUnitLabel: string; // заглавие на колоната „цена за 1 доза"
  divisor: number; // €/кг → €/единица дозиране (1e6 за мг, 1000 за г)
  defaultOps: PlOperation[]; // операции по подразбиране (за tablet идват от PRIM)
}

export const PL_TYPES: Record<PlProductType, PlTypeConfig> = {
  tablet: {
    label: "Таблетки / Капсули",
    doseLabel: "Мг в табл./капс.",
    doseUnit: "мг",
    packLabel: "Брой в опаковка (табл/капс)",
    packUnit: "табл/капс",
    perUnitLabel: "€/табл.",
    divisor: 1_000_000,
    defaultOps: [], // зареждат се от PRIM (pl_operations)
  },
  sachet: {
    label: "Сашета",
    doseLabel: "Грам в 1 саше",
    doseUnit: "г",
    packLabel: "Брой сашета в опаковка",
    packUnit: "сашета",
    perUnitLabel: "€/саше",
    divisor: 1000,
    defaultOps: [
      { name: "Флакон/Кутия", unit_price: 0, kind: "per_pack" },
      { name: "Пълнене в кутия", unit_price: 0.5, kind: "per_pack", is_labor: true },
      { name: "Пълнене в саше", unit_price: 0.08, kind: "per_unit", is_labor: true },
      { name: "Други операции", unit_price: 0, kind: "per_pack" },
    ],
  },
  powder: {
    label: "Прахообразни",
    doseLabel: "Грам в 1 доза",
    doseUnit: "г",
    packLabel: "Дози в опаковка",
    packUnit: "дози",
    perUnitLabel: "€/доза",
    divisor: 1000,
    defaultOps: [
      { name: "Флакон/Кутия", unit_price: 0, kind: "per_pack" },
      { name: "Етикет", unit_price: 0, kind: "per_pack" },
      { name: "Пълнене във флакон", unit_price: 1, kind: "per_pack", is_labor: true },
      { name: "Лепене на етикет", unit_price: 0.5, kind: "per_pack", is_labor: true },
      { name: "Поставяне на слийв фолио", unit_price: 0.3, kind: "per_pack", is_labor: true },
      { name: "Слийв фолио", unit_price: 0.06, kind: "per_pack" },
      { name: "Лъжичка", unit_price: 0.1, kind: "per_pack" },
      { name: "Други операции", unit_price: 0, kind: "per_pack" },
    ],
  },
  liquid: {
    label: "Течни екстракти",
    doseLabel: "Мг в 1 мл",
    doseUnit: "мг/мл",
    packLabel: "Мл в опаковка",
    packUnit: "мл",
    perUnitLabel: "€/мл",
    divisor: 1_000_000,
    defaultOps: [
      { name: "Стъклен флакон", unit_price: 0, kind: "per_pack" },
      { name: "Капачка", unit_price: 0, kind: "per_pack" },
      { name: "Мерителна чашка", unit_price: 0, kind: "per_pack" },
      { name: "Етикет", unit_price: 0, kind: "per_pack" },
      { name: "Кутия", unit_price: 0, kind: "per_pack" },
      { name: "Труд", unit_price: 2, kind: "per_pack", is_labor: true },
    ],
  },
};

const n = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return isFinite(x) ? x : 0;
};

/** Ефективна цена €/кг (стойността в полето е крайната, вкл. +20% при PRIM цените). */
export const effPricePerKg = (ing: PlIngredient) => n(ing.price_eur);
/** Цена за 1 доза (табл./капс./мл) от тази съставка (€). divisor: 1e6 за мг, 1000 за г. */
export const pricePerTablet = (ing: PlIngredient, divisor = 1_000_000) => (effPricePerKg(ing) / divisor) * n(ing.mg_per_tablet);
/** Цена за цялата опаковка от тази съставка (€). */
export const pricePerPack = (ing: PlIngredient, tabsPerPack: number | string, divisor = 1_000_000) => pricePerTablet(ing, divisor) * n(tabsPerPack);

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
  tabsPerPack: number | string,
  divisor = 1_000_000
): PricingTotals {
  const totalRaw = ingredients.reduce((s, ing) => s + pricePerPack(ing, tabsPerPack, divisor), 0);
  const totalOps = operations.reduce((s, op) => s + opPerPack(op, tabsPerPack), 0);
  const labor = operations.filter((op) => op.is_labor).reduce((s, op) => s + opPerPack(op, tabsPerPack), 0);
  return { totalRaw, totalOps, labor, total: totalRaw + totalOps };
}

/** €, до 4 знака (за единични), с BG запетая. */
export const eur = (v: number, dp = 4) =>
  (isFinite(v) ? v : 0).toLocaleString("bg-BG", { minimumFractionDigits: dp, maximumFractionDigits: dp });
