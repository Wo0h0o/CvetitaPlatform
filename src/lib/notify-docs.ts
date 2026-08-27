/**
 * Pure builders for the three БАБХ documents (Проекто-етикет, Списък, Заявление)
 * from a product + company + site + submit date. No I/O — just string/number shaping,
 * so the same output feeds the on-screen preview and any future export.
 */

export interface NzIngredient {
  name_bg: string;
  name_lat?: string | null;
  kind: "herb" | "vitmin" | "other";
  unit: string;
  amount: number | string;
  ref_value?: number | string | null;
  /** optional note, e.g. "доставящ 105,5 mg чист калций" */
  note?: string;
}

export interface NzProduct {
  name: string;
  product_type: "supplement" | "sport";
  audience?: string; // "за възрастни"
  action?: string; // Действие / предназначение
  dose_form?: string; // таблетки | капсули | прах | ml
  daily_dose?: string; // Препоръчителна дневна доза (пълен текст)
  dose_basis?: string; // "2 таблетки" | "5 грама" — базата на състава
  unit_net_weight?: number | string | null; // нетно тегло на 1 таблетка (g)
  pack_sizes?: number[]; // избрани разфасовки (брой)
  active_ingredients?: NzIngredient[];
  additional_ingredients?: string[]; // допълнителни съставки (пълнители)
  sweetener?: string; // Подсладител (по избор)
  reg_number?: string;
  reg_date?: string;
}

export interface NzCompany {
  eik: string;
  name: string;
  manager: string;
  address: string;
  reg_role?: "producer" | "trader";
  remote_website?: string;
  remote_phone?: string;
  remote_email?: string;
}

// Постоянни данни на производителя (Цветита физически произвежда всичко)
export const PRODUCER = {
  name: "Цветита Хербал ЕООД",
  seat: "гр. Бургас, ул. Граф Игнатиев № 17",
  siteAddress:
    "Производствена сграда и склад за съхранение на хранителни добавки, гр. Бургас, Промишлена зона „Север“, Поземлен имот 07079.603.9, квартал 2, парцел II, общ. Бургас, обл. Бургас",
};

// Регулаторен контакт за подаване (винаги Цветита)
export const FILING_CONTACT = { phone: "0885363623", email: "pm@cvetitaherbal.com" };

const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined || v === "") return NaN;
  return typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
};

/** BG форматиране: десетична запетая, без излишни нули. */
export function bgNum(v: number, maxDec = 2): string {
  if (!isFinite(v)) return "";
  const r = Math.round(v * 10 ** maxDec) / 10 ** maxDec;
  return String(r).replace(".", ",");
}

/** % от референтни стойности = количество ÷ референтна × 100 (закръглено). */
export function nrvPct(amount: number | string, refValue: number | string | null | undefined): number | null {
  const a = num(amount);
  const r = num(refValue);
  if (!isFinite(a) || !isFinite(r) || r === 0) return null;
  return Math.round((a / r) * 100);
}

/** Един ред от състава, форматиран според вида на съставката. */
export function ingredientLine(ing: NzIngredient): string {
  const amount = `${bgNum(num(ing.amount))} ${ing.unit}`.trim();
  const parts: string[] = [];
  let head = ing.name_bg;
  if (ing.kind === "herb" && ing.name_lat) head = `${ing.name_bg} (${ing.name_lat})`;
  parts.push(`${head} – ${amount}`);
  if (ing.note) parts[0] += ` (${ing.note}`;
  const pct = nrvPct(ing.amount, ing.ref_value ?? null);
  if (pct !== null) {
    const open = ing.note ? ", " : " (";
    parts[0] += `${open}${pct} % от референтни стойности, съгласно Регламент (ЕС) 1169/2011)`;
  } else if (ing.note) {
    parts[0] += ")";
  }
  return parts.join("");
}

/** „Съставки в дневна доза X: …“ */
export function compositionText(p: NzProduct): string {
  const list = (p.active_ingredients ?? []).map(ingredientLine).join(", ");
  const basis = p.dose_basis ? ` ${p.dose_basis}` : "";
  return `Съставки в дневна доза${basis}: ${list}`;
}

/** Нетно тегло за дадена разфасовка (брой × тегло на единица). */
export function netWeightFor(count: number, unitWeight: number | string | null | undefined): string {
  const w = num(unitWeight);
  if (!isFinite(w)) return "";
  return `${bgNum(count * w)} g ± 5%`;
}

/** Списък „Нетно количество“ за всички избрани разфасовки. */
export function netWeightsAll(p: NzProduct): string {
  return (p.pack_sizes ?? [])
    .map((c) => netWeightFor(c, p.unit_net_weight))
    .filter(Boolean)
    .join("; ");
}

export const typeLabel = (t: NzProduct["product_type"]) =>
  t === "sport" ? "храна, предназначена за употреба при интензивно мускулно натоварване" : "хранителна добавка";

const unitWord = (form?: string) => {
  switch ((form || "").toLowerCase()) {
    case "капсули":
      return "капсула";
    case "прах":
      return "грам";
    case "ml":
    case "мл":
      return "ml";
    default:
      return "таблетка";
  }
};

/** Дата на пускане = дата на подаване + 14 дни (BG формат dd.mm.yyyy). */
export function marketDate(submitISO: string): string {
  const d = new Date(submitISO + "T00:00:00");
  d.setDate(d.getDate() + 14);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export function bgDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** Пълните редове за ПРОЕКТО-ЕТИКЕТ. */
export function labelDoc(p: NzProduct) {
  const packs = (p.pack_sizes ?? []).join(", ");
  const contents = [
    ...(p.active_ingredients ?? []).map((i) => i.name_bg),
    ...(p.additional_ingredients ?? []),
  ].join(", ");
  return {
    name: p.name,
    subtitle: `${typeLabel(p.product_type) === "хранителна добавка" ? "Хранителна добавка" : "Храна за употреба при интензивно мускулно натоварване"}${p.audience ? " " + p.audience : ""}`,
    regLine: `Номер и дата на вписване на хранителната добавка в регистъра: ${p.reg_number ? p.reg_number + (p.reg_date ? " / " + bgDate(p.reg_date) : "") : "…………………………"}`,
    action: p.action ? `Действие: ${p.action}` : "",
    packsLine: `Дози в опаковка: ${packs}`,
    countLine: `Брой ${unitWord(p.dose_form)} в опаковка: ${packs}`,
    netLine: `Нетно количество: ${netWeightsAll(p)}`,
    doseLine: p.daily_dose ? `Препоръчителна дневна доза: ${p.daily_dose}` : "",
    composition: compositionText(p),
    additional: (p.additional_ingredients ?? []).length
      ? `Допълнителни съставки: ${(p.additional_ingredients ?? []).join(", ")}`
      : "",
    contents: `Съдържание в 1 (една) опаковка: ${contents}`,
    sweetener: p.sweetener ? `Подсладител: ${p.sweetener}` : "",
    warnings: [
      "Да се съхранява на място, недостъпно за малки деца.",
      "Да не се превишава препоръчителната дневна доза.",
      "Да не се използва като заместител на разнообразното хранене.",
      "Продуктът е хранителна добавка, а не лекарствено средство.",
      "Да се съхранява на сухо, хладно и защитено от пряка слънчева светлина място на температура до 25°C.",
      "Да не се използва след изтичане срока на годност, посочен на опаковката.",
      "Не съдържа генетично модифицирани съставки и консерванти, оцветители.",
    ],
    producer: `Произведено в ЕС от ${PRODUCER.name} ${PRODUCER.seat},`,
    footer: ["Партиден номер:", "Дата на производство: ....................", "Най-добър до: ..........................."],
  };
}
