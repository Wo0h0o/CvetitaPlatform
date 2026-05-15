/**
 * Generate the "Молба за платен/неплатен отпуск" PDF.
 *
 * Layout mirrors the .docx the user supplied: addressed to the manager of
 * Цветита Хербал ЕООД, with personal details from the worker's HR profile
 * snapshot, body sentence in Cyrillic, signature block at the bottom.
 *
 * Why pdf-lib + Noto Sans: pdfkit's built-in fonts don't include Cyrillic
 * glyphs (CP1252 only). pdf-lib + fontkit lets us embed a full Cyrillic
 * TTF so the output renders correctly regardless of the PDF reader.
 */

import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "fs/promises";
import { join } from "path";

export interface LeavePdfInput {
  leave_type: "paid" | "unpaid";
  start_date: string;       // YYYY-MM-DD
  end_date?: string | null; // YYYY-MM-DD — inclusive; omitted for legacy rows
  working_days: number;
  full_name: string;
  egn: string;
  city: string;
  address: string;
  job_title: string;
  submitted_at: string; // ISO timestamp
  organization_name?: string; // defaults to "Цветита Хербал ЕООД"
}

const PAGE_WIDTH = 595.28;  // A4 in points
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 70;
const MARGIN_RIGHT = 70;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

function formatDateBg(iso: string): string {
  // YYYY-MM-DD or ISO timestamp → DD.MM.YYYY
  const d = iso.length > 10 ? new Date(iso) : new Date(iso + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

/** Word-wrap `text` into lines no wider than `maxWidth` at the given size. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const probe = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(probe, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = probe;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function generateLeavePdf(input: LeavePdfInput): Promise<Uint8Array> {
  const orgName = input.organization_name ?? "Цветита Хербал ЕООД";
  const regularPath = join(process.cwd(), "public", "fonts", "NotoSans-Regular.ttf");
  const boldPath = join(process.cwd(), "public", "fonts", "NotoSans-Bold.ttf");
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(regularPath),
    readFile(boldPath),
  ]);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const black = rgb(0, 0, 0);

  // Cursor (y measured from top to keep the layout code readable).
  let y = PAGE_HEIGHT - 70;
  const drawAt = (
    text: string,
    x: number,
    font: PDFFont,
    size: number,
    color = black
  ) => {
    page.drawText(text, { x, y, size, font, color });
  };

  // ---------- Header: "До Управителя на ..." (right-aligned) ----------
  const headerLine1 = "До Управителя на";
  const headerLine2 = orgName;
  const headerSize = 11;
  const w1 = regular.widthOfTextAtSize(headerLine1, headerSize);
  const w2 = bold.widthOfTextAtSize(headerLine2, headerSize);
  drawAt(headerLine1, PAGE_WIDTH - MARGIN_RIGHT - w1, regular, headerSize);
  y -= 16;
  drawAt(headerLine2, PAGE_WIDTH - MARGIN_RIGHT - w2, bold, headerSize);
  y -= 50;

  // ---------- Title ----------
  const title = "М О Л Б А";
  const titleSize = 18;
  const titleWidth = bold.widthOfTextAtSize(title, titleSize);
  drawAt(title, (PAGE_WIDTH - titleWidth) / 2, bold, titleSize);
  y -= 50;

  // ---------- Body ----------
  const body = 11;
  // "От [Three names]"
  drawAt("От", MARGIN_LEFT, regular, body);
  const fromLabelWidth = regular.widthOfTextAtSize("От ", body);
  drawAt(input.full_name, MARGIN_LEFT + fromLabelWidth, bold, body);
  y -= 14;

  drawAt(
    "/ трите имена по документ за самоличност /",
    MARGIN_LEFT + 60,
    regular,
    8
  );
  y -= 22;

  // "ЕГН: [egn], живущ в гр./с. [city], адрес [address]"
  // Render as one flowing paragraph that wraps if the address is long.
  // We pre-build a single string then word-wrap; embedded values keep the
  // bold weight, but for simplicity here we render the whole line in
  // regular weight and trust the contrast of italic /label/ for hierarchy.
  const ln1 = `ЕГН: ${input.egn},  живущ в гр./с. ${input.city},  адрес: ${input.address}`;
  const ln1Lines = wrap(ln1, regular, body, CONTENT_WIDTH);
  for (const line of ln1Lines) {
    drawAt(line, MARGIN_LEFT, regular, body);
    y -= 16;
  }
  y -= 4;

  drawAt(`на длъжност  `, MARGIN_LEFT, regular, body);
  const posLabelWidth = regular.widthOfTextAtSize("на длъжност  ", body);
  drawAt(input.job_title, MARGIN_LEFT + posLabelWidth, bold, body);
  y -= 28;

  // Salutation
  drawAt("Уважаеми(а) господин(жо),", MARGIN_LEFT, regular, body);
  y -= 22;

  // Main sentence — concrete numbers stand out in bold so the reader's
  // eye lands on what matters: type, days, start date, and (when known)
  // the end date.
  const leaveLabel = input.leave_type === "paid" ? "платен" : "неплатен";
  const main = `моля да ми разрешите да ползвам ${leaveLabel} отпуск в размер на`;
  const mainLines = wrap(main, regular, body, CONTENT_WIDTH);
  for (const line of mainLines) {
    drawAt(line, MARGIN_LEFT, regular, body);
    y -= 16;
  }
  // ... continued with bold numbers, then the rest of the sentence
  drawAt(String(input.working_days), MARGIN_LEFT, bold, body);
  const daysW = bold.widthOfTextAtSize(String(input.working_days), body);
  drawAt(`  работни дни, считано от`, MARGIN_LEFT + daysW, regular, body);
  y -= 16;

  // Start date line. Append "до <end_date> г." when we have an end date,
  // otherwise keep the legacy "г." closure so the sentence still reads.
  drawAt(formatDateBg(input.start_date), MARGIN_LEFT, bold, body);
  const startW = bold.widthOfTextAtSize(formatDateBg(input.start_date), body);
  if (input.end_date) {
    drawAt(" г.  до", MARGIN_LEFT + startW, regular, body);
    const tailW = regular.widthOfTextAtSize(" г.  до  ", body);
    drawAt(formatDateBg(input.end_date), MARGIN_LEFT + startW + tailW, bold, body);
    const endW = bold.widthOfTextAtSize(formatDateBg(input.end_date), body);
    drawAt(" г.", MARGIN_LEFT + startW + tailW + endW, regular, body);
  } else {
    drawAt(" г.", MARGIN_LEFT + startW, regular, body);
  }
  y -= 40;

  // Signature block: city left, signature right
  drawAt(`гр./с. ${input.city}`, MARGIN_LEFT, regular, body);
  const sigLabel = "С УВАЖЕНИЕ: ..........................";
  const sigWidth = regular.widthOfTextAtSize(sigLabel, body);
  drawAt(sigLabel, PAGE_WIDTH - MARGIN_RIGHT - sigWidth, regular, body);
  y -= 16;

  drawAt(`${formatDateBg(input.submitted_at)} г.`, MARGIN_LEFT, regular, body);

  const sigSubLabel = "/ подпис /";
  const sigSubWidth = regular.widthOfTextAtSize(sigSubLabel, 9);
  // Place the / подпис / underneath the signature line
  page.drawText(sigSubLabel, {
    x: PAGE_WIDTH - MARGIN_RIGHT - sigWidth + (sigWidth - sigSubWidth) / 2,
    y: y + 16 - 14,
    size: 9,
    font: regular,
    color: black,
  });

  return pdf.save();
}
