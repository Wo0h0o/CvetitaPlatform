import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlUnlock, plModule } from "@/lib/pricing-lock";
import { PL_TYPES, pricePerTablet, pricePerPack, opPerPack, type PlIngredient, type PlOperation, type PlProductType } from "@/lib/pricing";

/**
 * Експорт на оферта в Excel (.xlsx) с пълна разбивка + колона „Надценка %",
 * за да се провери дали суровините са на +20% спрямо доставната цена от ПРИМ.
 */

const num = (v: unknown) => {
  const x = parseFloat(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : 0;
};

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const url = new URL(req.url);
  const m = plModule(url.searchParams.get("module"));
  const locked = await requirePlUnlock(m);
  if (locked) return locked;
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: offer, error } = await supabaseAdmin.from("pl_offers").select("*").eq("id", Number(id)).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!offer) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Базови (доставни) цени от ПРИМ — за проверка на надценката
  const [mats, caps, packs] = await Promise.all([
    supabaseAdmin.from("pl_materials").select("item_id, price_eur"),
    supabaseAdmin.from("pl_capsules").select("name, price_eur"),
    supabaseAdmin.from("pl_packaging").select("name, price_eur"),
  ]);
  const baseByItem = new Map<string, number | null>((mats.data ?? []).map((r) => [String(r.item_id), r.price_eur]));
  const baseByCap = new Map<string, number | null>((caps.data ?? []).map((r) => [r.name, r.price_eur]));
  const baseByPack = new Map<string, number | null>((packs.data ?? []).map((r) => [r.name, r.price_eur]));

  const type = (offer.product_type as PlProductType) || "tablet";
  const cfg = PL_TYPES[type];
  const divisor = cfg.divisor;
  const tabs = offer.tabs_per_pack ?? 0;
  const ingredients: PlIngredient[] = offer.ingredients ?? [];
  const operations: PlOperation[] = offer.operations ?? [];
  const isKey = m === "key";

  const wb = new ExcelJS.Workbook();
  wb.creator = "Cvetita Command Center";
  const ws = wb.addWorksheet("Оферта");
  const money = "#,##0.0000 €";
  const pct = '0.0 "%"';

  const titleRow = (label: string, value: string) => {
    const r = ws.addRow([label, value]);
    r.getCell(1).font = { bold: true };
  };
  titleRow("Продукт:", offer.product_name || "");
  titleRow("Клиент:", offer.client || "");
  titleRow("Вид продукт:", cfg.label);
  titleRow("Брой в опаковка:", `${tabs} ${cfg.packUnit}`);
  titleRow("Режим:", isKey ? "Ключови клиенти (себестойност, без надценка)" : "Private Label (суровини +20%)");
  titleRow("Дата:", new Date().toLocaleDateString("bg-BG"));
  ws.addRow([]);

  // ── Модул 1 · Суровини ──
  const h1 = ws.addRow(["Модул 1 · Суровини"]);
  h1.getCell(1).font = { bold: true, size: 12 };
  const head1 = ws.addRow(["№", "Суровина", "Доставна €/кг (ПРИМ)", "Използвана €/кг", "Надценка %", cfg.doseLabel, "€/доза", "€/опаковка"]);
  head1.font = { bold: true };
  head1.eachCell((c) => (c.alignment = { wrapText: true, vertical: "middle" }));

  let totalRaw = 0;
  let doseNative = 0;
  ingredients.forEach((ing, i) => {
    const used = num(ing.price_eur);
    const base = ing.item_id != null ? baseByItem.get(String(ing.item_id)) ?? null : null;
    const markup = base && base > 0 ? (used / base - 1) * 100 : null;
    const perPack = pricePerPack(ing, tabs, divisor);
    totalRaw += perPack;
    doseNative += num(ing.mg_per_tablet);
    const row = ws.addRow([
      i + 1,
      ing.name || "",
      base ?? "н.д.",
      used,
      markup == null ? "ръчно" : markup,
      num(ing.mg_per_tablet),
      pricePerTablet(ing, divisor),
      perPack,
    ]);
    row.getCell(3).numFmt = money;
    row.getCell(4).numFmt = money;
    if (markup != null) row.getCell(5).numFmt = pct;
    row.getCell(7).numFmt = money;
    row.getCell(8).numFmt = money;
  });
  const doseMg = cfg.doseUnit === "г" ? doseNative * 1000 : doseNative;
  const dr = ws.addRow(["", `Общо активни в 1 доза (${cfg.doseUnit})`, "", "", "", doseMg + " мг", "", ""]);
  dr.getCell(2).font = { italic: true };
  const tr1 = ws.addRow(["", "Тотал суровини за опаковка", "", "", "", "", "", totalRaw]);
  tr1.font = { bold: true };
  tr1.getCell(8).numFmt = money;
  ws.addRow([]);

  // ── Модул 2 · Операции ──
  const h2 = ws.addRow(["Модул 2 · Операции"]);
  h2.getCell(1).font = { bold: true, size: 12 };
  const head2 = ws.addRow(["№", "Операция", "ПРИМ артикул", "Доставна €/бр (ПРИМ)", "Ед. цена €", "Надценка %", "Начин", "Труд", "€/опаковка"]);
  head2.font = { bold: true };
  head2.eachCell((c) => (c.alignment = { wrapText: true, vertical: "middle" }));

  let totalOps = 0;
  let labor = 0;
  operations.forEach((op, i) => {
    const unit = num(op.unit_price);
    const linked = op.capsule || op.packaging || "";
    const base = op.capsule ? baseByCap.get(op.capsule) ?? null : op.packaging ? baseByPack.get(op.packaging) ?? null : null;
    const markup = base && base > 0 ? (unit / base - 1) * 100 : null;
    const perPack = opPerPack(op, tabs);
    totalOps += perPack;
    if (op.is_labor) labor += perPack;
    const row = ws.addRow([
      i + 1,
      op.name || "",
      linked,
      base ?? (linked ? "н.д." : ""),
      unit,
      markup == null ? (linked ? "ръчно" : "") : markup,
      op.kind === "per_unit" ? "× брой в опаковка" : "фиксирана",
      op.is_labor ? "да" : "",
      perPack,
    ]);
    if (typeof base === "number") row.getCell(4).numFmt = money;
    row.getCell(5).numFmt = money;
    if (markup != null) row.getCell(6).numFmt = pct;
    row.getCell(9).numFmt = money;
  });
  const lr = ws.addRow(["", "Труд (ръчни операции)", "", "", "", "", "", "", labor]);
  lr.getCell(9).numFmt = money;
  const tr2 = ws.addRow(["", "Тотал операции за опаковка", "", "", "", "", "", "", totalOps]);
  tr2.font = { bold: true };
  tr2.getCell(9).numFmt = money;
  ws.addRow([]);

  const fin = ws.addRow(["", `Себестойност/цена за опаковка (без ДДС)`, "", "", "", "", "", "", totalRaw + totalOps]);
  fin.font = { bold: true, size: 12 };
  fin.getCell(9).numFmt = money;

  // ── Ценообразуване към клиента ──
  ws.addRow([]);
  const hp = ws.addRow(["Ценообразуване към клиента"]);
  hp.getCell(1).font = { bold: true, size: 12 };
  const priceRow = (label: string, val: unknown) => {
    const r = ws.addRow(["", label, "", "", "", "", "", "", val == null ? "—" : Number(val)]);
    if (val != null) r.getCell(9).numFmt = money;
  };
  priceRow("Финална цена / бр (ръчна)", offer.final_price);
  priceRow("Цена за 500 бр", offer.price_500);
  priceRow("Цена за 1000 бр", offer.price_1000);
  priceRow("Цена за 5000 бр", offer.price_5000);

  // ширини на колоните
  ws.columns.forEach((c, i) => (c.width = i === 1 || i === 2 ? 34 : 16));

  const buf = await wb.xlsx.writeBuffer();
  const nameSafe = String(offer.product_name || "oferta").replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "oferta";
  const fname = `Oferta_${nameSafe}.xlsx`;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="oferta.xlsx"; filename*=UTF-8''${encodeURIComponent(fname)}`,
      "Cache-Control": "no-store",
    },
  });
}
