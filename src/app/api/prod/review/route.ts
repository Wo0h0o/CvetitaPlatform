import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireManager } from "@/lib/prod-admin";
import { reviewByDate, applyReview, editLine, type ItemStatus } from "@/lib/prod-logic";

/** Админ/мениджър (десктоп): преглед по дата + одобрение/връщане по операция. */
export async function GET(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const date = new URL(req.url).searchParams.get("date") || new Date().toISOString().slice(0, 10);
  return NextResponse.json(await reviewByDate(date));
}

export async function PATCH(req: NextRequest) {
  const a = await requireManager(req);
  if ("error" in a) return a.error;
  const b = await req.json().catch(() => ({}));
  if (!b.entry_id) return NextResponse.json({ error: "entry_id" }, { status: 400 });
  try {
    if (b.edit && b.line_id) {
      const entry = await editLine(Number(b.entry_id), String(b.line_id), b.edit, a.userId);
      return NextResponse.json({ entry });
    }
    if (!["confirmed", "rejected", "submitted"].includes(b.status)) return NextResponse.json({ error: "валиден status" }, { status: 400 });
    const entry = await applyReview(Number(b.entry_id), { lineId: b.line_id, status: b.status as ItemStatus, note: b.note ?? null, reviewerId: a.userId });
    return NextResponse.json({ entry });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
