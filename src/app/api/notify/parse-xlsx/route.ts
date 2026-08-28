import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import ExcelJS from "exceljs";

/**
 * POST /api/notify/parse-xlsx  body: { fileBase64 }
 *
 * Deterministic (no AI) reader for the company's composition spreadsheets.
 * Finds the „мг.в табл." column by header, reads name + mg for each row,
 * routes „Пълнители" to fillers, and guesses dose form + pack size.
 * Returns { product_name, dose_form, pack_size, ingredients, fillers }.
 */
export const maxDuration = 30;

type Cell = string | number | null;

function cellVal(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: string; richText?: { text: string }[] };
    if (o.result !== undefined) return cellVal(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const asNum = (c: Cell): number => (typeof c === "number" ? c : parseFloat(String(c ?? "").replace(",", ".")));

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  let body: { fileBase64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.fileBase64) return NextResponse.json({ error: "Няма файл." }, { status: 400 });

  try {
    const b64 = body.fileBase64.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.worksheets[0];
    if (!ws) return NextResponse.json({ error: "Празен файл." }, { status: 422 });

    // grid
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const arr: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        arr[colNumber - 1] = cellVal(cell.value);
      });
      rows.push(arr);
    });

    // find quantity column („мг.в табл." / „мкг в табл." …) + pack column
    let qtyCol = -1;
    let headerIdx = -1;
    let packCol = -1;
    let unit = "mg";
    for (let i = 0; i < rows.length && qtyCol < 0; i++) {
      for (let j = 0; j < rows[i].length; j++) {
        const c = typeof rows[i][j] === "string" ? norm(rows[i][j] as string) : "";
        if (!c) continue;
        if (/(мг|мкг|µg|mg)\s*\.?\s*в\s*(табл|капс|доза)/.test(c) || /количество\s*в\s*(табл|капс|доза)/.test(c)) {
          qtyCol = j;
          headerIdx = i;
          unit = /мкг|µg|mcg/.test(c) ? "µg" : "mg";
        }
        if (/кап\/?таб|таб\/?кап|в\s*опаков/.test(c)) packCol = j;
      }
    }
    if (qtyCol < 0) return NextResponse.json({ error: "Не намерих колона „мг.в табл.“ в таблицата." }, { status: 422 });

    const ingredients: { name: string; amount: string; unit: string }[] = [];
    const fillers: string[] = [];
    let packSize: number | null = null;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = rows[i];
      const nameCell = cells.find((c) => typeof c === "string" && /[А-Яа-яA-Za-z]/.test(c) && !/^\d+([.,]\d+)?$/.test(c.trim()));
      const nm = typeof nameCell === "string" ? nameCell.replace(/\s+/g, " ").trim() : "";
      const val = asNum(cells[qtyCol]);
      if (!nm || !isFinite(val) || val <= 0) continue;
      if (packCol >= 0 && packSize === null) {
        const p = asNum(cells[packCol]);
        if (isFinite(p) && p > 0) packSize = p;
      }
      if (/пълнит/i.test(nm)) { fillers.push(nm); continue; }
      ingredients.push({ name: nm, amount: String(val), unit });
    }

    // form hint (капсули / таблетки / прах) от първите редове
    let doseForm = "";
    outer: for (let i = 0; i < Math.min(rows.length, 6); i++) {
      for (const c of rows[i]) {
        if (typeof c !== "string") continue;
        const n = norm(c);
        if (n === "капсули" || n.includes("капсул")) { doseForm = "капсули"; break outer; }
        if (n === "таблетки" || n.includes("таблет")) { doseForm = "таблетки"; break outer; }
        if (n.includes("прах")) { doseForm = "прах"; break outer; }
      }
    }

    return NextResponse.json({
      result: {
        product_name: ws.name || "",
        dose_form: doseForm,
        pack_size: packSize,
        ingredients,
        fillers,
      },
    });
  } catch (e) {
    logger.error("parse-xlsx failed", { error: String(e) });
    return NextResponse.json({ error: "Грешка при четене на файла." }, { status: 500 });
  }
}
