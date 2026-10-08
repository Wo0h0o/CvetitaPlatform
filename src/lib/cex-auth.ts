import crypto from "crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Лек PIN вход за производствените колеги — без Supabase акаунт. Колегата избира
 * име + 4-цифрен PIN; при успех пазим подписана httpOnly бисквитка с worker_id.
 * Така всеки вижда/пише само за себе си и няма достъп до останалата платформа.
 */

const SECRET = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "cex-dev-secret";
export const CEX_COOKIE = "cex_worker";

const sign = (id: number | string) => crypto.createHmac("sha256", SECRET).update(`cex:${id}`).digest("base64url");
export const cexToken = (id: number) => `${id}.${sign(id)}`;
export function cexVerify(token: string | undefined | null): number | null {
  if (!token) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig || sign(id) !== sig) return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

export async function getCexWorker(req: NextRequest): Promise<{ id: number; name: string; is_supervisor: boolean } | null> {
  const id = cexVerify(req.cookies.get(CEX_COOKIE)?.value);
  if (!id) return null;
  const { data } = await supabaseAdmin.from("prod_workers").select("id, name, active, is_supervisor").eq("id", id).maybeSingle();
  if (!data || !data.active) return null;
  return { id: data.id, name: data.name, is_supervisor: !!data.is_supervisor };
}
