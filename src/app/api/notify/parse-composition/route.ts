import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { logger } from "@/lib/logger";

/**
 * POST /api/notify/parse-composition
 * body: { text?: string, fileBase64?: string, mediaType?: string }
 *
 * Reads a composition table (pasted text, a photo, or a PDF) with Claude and
 * returns structured fields so the уведомление form fills itself:
 *   { product_name, daily_dose, dose_basis, ingredients: [{ name, amount, unit }] }
 */
export const maxDuration = 60;

const PROMPT = `Ти си асистент за регистрация на хранителни добавки в България. От подадената таблица/текст/снимка със състав извлечи данните и върни САМО валиден JSON (без обяснения, без code fences) с точно тази структура:
{
  "product_name": "" ,            // търговско наименование, ако личи; иначе ""
  "daily_dose": "",               // препоръчителна дневна доза текст, ако личи; иначе ""
  "dose_basis": "",               // база на състава, напр. "1 таблетка", "2 капсули", "5 грама"; иначе ""
  "ingredients": [                // само АКТИВНИ съставки, в реда от таблицата
    { "name": "Магнезиев цитрат", "amount": 625, "unit": "mg" }
  ]
}
Правила: имената са на български както са в таблицата (суровина/съставка). amount е число (десетичен разделител точка). unit е mg, µg (или mcg), g според таблицата. Не измисляй съставки, които ги няма. Ако таблицата е за 1 таблетка/капсула, това е dose_basis.`;

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "CLAUDE_API_KEY not configured" }, { status: 500 });

  let body: { text?: string; fileBase64?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const content: Block[] = [{ type: "text", text: PROMPT }];
  if (body.fileBase64 && body.mediaType) {
    const data = body.fileBase64.replace(/^data:[^;]+;base64,/, "");
    if (body.mediaType.startsWith("image/")) {
      content.push({ type: "image", source: { type: "base64", media_type: body.mediaType, data } });
    } else if (body.mediaType === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    } else {
      return NextResponse.json({ error: "Поддържат се снимка, PDF или поставен текст." }, { status: 400 });
    }
  } else if (body.text && body.text.trim()) {
    content.push({ type: "text", text: `Ето състава:\n\n${body.text.trim()}` });
  } else {
    return NextResponse.json({ error: "Няма подаден състав." }, { status: 400 });
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-opus-4-6", max_tokens: 2048, messages: [{ role: "user", content }] }),
      },
      55000
    );
    if (!res.ok) {
      const err = await res.text();
      logger.error("parse-composition Claude error", { status: res.status });
      return NextResponse.json({ error: `Claude API ${res.status}`, detail: err.slice(0, 200) }, { status: 502 });
    }
    const data = await res.json();
    const textOut: string = (data.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n");
    const m = textOut.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Не успях да разчета състава." }, { status: 422 });
    const parsed = JSON.parse(m[0]);
    return NextResponse.json({ result: parsed });
  } catch (e) {
    logger.error("parse-composition failed", { error: String(e) });
    return NextResponse.json({ error: "Грешка при разчитане." }, { status: 500 });
  }
}
