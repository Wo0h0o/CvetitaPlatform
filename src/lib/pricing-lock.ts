import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Втори слой защита (парола) — отделна за всеки модул: „standard" и „key" (ключови клиенти). */
export type PlModule = "standard" | "key";

const CONFIG_ID: Record<PlModule, number> = { standard: 1, key: 2 };
const COOKIE: Record<PlModule, string> = { standard: "pl_unlock", key: "pl_unlock_key" };

export const plModule = (v?: string | null): PlModule => (v === "key" ? "key" : "standard");
export const plCookie = (m: PlModule) => COOKIE[m];

export async function getPlConfig(m: PlModule): Promise<{ password: string | null; unlock_token: string } | null> {
  const { data } = await supabaseAdmin.from("pl_config").select("password, unlock_token").eq("id", CONFIG_ID[m]).maybeSingle();
  return data ?? null;
}

/** Отключено ли е: няма зададена парола (bootstrap) или бисквитката съвпада с токена. */
export async function isPlUnlocked(m: PlModule): Promise<boolean> {
  const cfg = await getPlConfig(m);
  if (!cfg?.password) return true;
  const c = (await cookies()).get(COOKIE[m])?.value;
  return !!c && c === cfg.unlock_token;
}

/** Guard за API маршрутите — 403 ако е заключено. */
export async function requirePlUnlock(m: PlModule): Promise<NextResponse | null> {
  if (await isPlUnlocked(m)) return null;
  return NextResponse.json({ error: "locked" }, { status: 403 });
}
