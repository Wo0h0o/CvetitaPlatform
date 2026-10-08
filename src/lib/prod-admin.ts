import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUserContext } from "@/lib/user-role";

/** Само админ/мениджър (супервайзър) достъп до производствените справки/настройки. */
export async function requireManager(req: NextRequest): Promise<{ error: NextResponse } | { userId: string }> {
  const ctx = await getUserContext(req);
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (ctx.role !== "admin" && ctx.role !== "manager") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: ctx.userId };
}

/** % изпълнение на дневен запис = Σ(количество / норма) по операции. */
export function entryPct(items: { operation_id: number; qty: number }[], normById: Map<number, number | null>): number | null {
  let sum = 0;
  let counted = 0;
  for (const it of items ?? []) {
    const norm = normById.get(it.operation_id);
    if (norm && norm > 0) {
      sum += (Number(it.qty) || 0) / norm;
      counted++;
    }
  }
  return counted > 0 ? Math.round(sum * 1000) / 10 : null; // напр. 92.5
}
