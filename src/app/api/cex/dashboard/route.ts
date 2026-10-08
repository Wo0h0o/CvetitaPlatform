import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCexWorker } from "@/lib/cex-auth";
import { dashboard } from "@/lib/prod-logic";

/** Супервайзър (телефон): дашборд за период + дневни серии за графики. */
export async function GET(req: NextRequest) {
  const w = await getCexWorker(req);
  if (!w?.is_supervisor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") || new Date().toISOString().slice(0, 10);
  const from = sp.get("from") || to;
  return NextResponse.json(await dashboard(from, to, sp.get("confirmed") === "1"));
}
