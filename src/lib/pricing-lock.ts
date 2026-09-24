import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Втори слой защита (парола) за модула „Оферти". */
export const PL_COOKIE = "pl_unlock";

export async function getPlConfig(): Promise<{ password: string | null; unlock_token: string } | null> {
  const { data } = await supabaseAdmin.from("pl_config").select("password, unlock_token").eq("id", 1).maybeSingle();
  return data ?? null;
}

/** Отключено ли е: няма зададена парола (bootstrap) или бисквитката съвпада с токена. */
export async function isPlUnlocked(): Promise<boolean> {
  const cfg = await getPlConfig();
  if (!cfg?.password) return true;
  const c = (await cookies()).get(PL_COOKIE)?.value;
  return !!c && c === cfg.unlock_token;
}

/** Guard за API маршрутите — 403 ако е заключено. */
export async function requirePlUnlock(): Promise<NextResponse | null> {
  if (await isPlUnlocked()) return null;
  return NextResponse.json({ error: "locked" }, { status: 403 });
}
