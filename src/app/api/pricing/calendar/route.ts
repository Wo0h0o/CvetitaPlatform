import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGoogleAuth, insertCalendarEvent } from "@/lib/google";
import { logger } from "@/lib/logger";

/**
 * Автоматично проследяване на изпратена оферта:
 *  1. записва follow-up в pl_followups (със стандартните 3 задачи),
 *  2. ако Google е свързан — създава 3 събития в календара + Gmail чернова.
 * Ако Google НЕ е свързан → връща connected:false и фронтендът пада към линковете.
 */

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const client = (body.client as string) || "клиент";
  const clientEmail = (body.client_email as string) || "";
  const subject = (body.subject as string) || `Оферта — ${client}`;
  const moduleName = (body.module as string) || "standard";
  const base = (body.sent_date as string) || new Date().toISOString().slice(0, 10);

  const tasks = [
    { kind: "call", label: "Обади се на клиента — пусната оферта", due: addDays(base, 0), done: false, done_at: null },
    { kind: "email", label: "Изпрати нов имейл (ако няма отговор)", due: addDays(base, 3), done: false, done_at: null },
    { kind: "call", label: "Обади се (ако няма отговор)", due: addDays(base, 5), done: false, done_at: null },
  ];

  // 1) Follow-up запис
  const { data: followup, error: fErr } = await supabaseAdmin
    .from("pl_followups")
    .insert({
      module: moduleName,
      client,
      client_email: clientEmail || null,
      product_ids: body.product_ids ?? [],
      subject,
      status: "изпратена",
      sent_date: base,
      tasks,
      owner: (body.owner as string) ?? null,
    })
    .select()
    .single();
  if (fErr) {
    logger.error("pricing/calendar followup insert failed", { error: fErr.message });
    return NextResponse.json({ error: fErr.message }, { status: 500 });
  }

  // 2) Google (ако е свързан)
  const auth = await getGoogleAuth();
  if (!auth?.refresh_token) {
    return NextResponse.json({ ok: true, connected: false, followup });
  }

  let events = 0;
  const details = `Оферта: ${subject}\nКлиент: ${client}${clientEmail ? ` (${clientEmail})` : ""}`;
  try {
    for (const t of tasks) {
      await insertCalendarEvent(`${t.label} — ${client}`, t.due, details);
      events++;
    }
  } catch (e) {
    logger.error("pricing/calendar events failed", { error: e instanceof Error ? e.message : String(e) });
  }

  // Имейлът НЕ се прави през Gmail API (restricted scope) — фронтендът отваря compose URL.
  return NextResponse.json({ ok: true, connected: true, email: auth.email, events, draft: false, followup });
}
