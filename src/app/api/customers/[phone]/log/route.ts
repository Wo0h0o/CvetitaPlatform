import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sofiaDateTimeLabel } from "@/lib/sofia-date";
import { logger } from "@/lib/logger";

const SCHEMA = "store_bg";
const E164_RE = /^\+\d{8,15}$/;
const MAX_BODY = 5000;
const MAX_DURATION = 86_400;

const OUTCOMES = new Set([
  "satisfied",
  "unsatisfied",
  "no_answer",
  "declined",
  "wants_repeat",
  "has_question",
  "other",
]);

interface LogBody {
  kind: "call" | "note";
  outcome?: string | null;
  body?: string | null;
  duration_seconds?: number | null;
  follow_up_at?: string | null;
}

function validate(input: unknown): { ok: true; data: LogBody } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid body" };
  const b = input as Record<string, unknown>;

  if (b.kind !== "call" && b.kind !== "note") {
    return { ok: false, error: "kind must be 'call' or 'note'" };
  }

  const outcome = b.outcome === undefined || b.outcome === null || b.outcome === "" ? null : String(b.outcome);
  if (b.kind === "call") {
    if (!outcome) return { ok: false, error: "outcome is required for kind='call'" };
    if (!OUTCOMES.has(outcome)) return { ok: false, error: `outcome must be one of: ${[...OUTCOMES].join(", ")}` };
  } else {
    if (outcome) return { ok: false, error: "outcome must be absent for kind='note'" };
  }

  let body: string | null = null;
  if (typeof b.body === "string") {
    body = b.body.trim();
    if (body.length === 0) body = null;
    if (body && body.length > MAX_BODY) return { ok: false, error: `body must be ≤ ${MAX_BODY} chars` };
  }
  if (b.kind === "note" && !body) return { ok: false, error: "body is required for kind='note'" };

  let duration_seconds: number | null = null;
  if (b.duration_seconds !== undefined && b.duration_seconds !== null) {
    const n = Number(b.duration_seconds);
    if (!Number.isFinite(n) || n < 0 || n > MAX_DURATION) {
      return { ok: false, error: `duration_seconds must be between 0 and ${MAX_DURATION}` };
    }
    duration_seconds = Math.round(n);
  }

  let follow_up_at: string | null = null;
  if (b.follow_up_at !== undefined && b.follow_up_at !== null && b.follow_up_at !== "") {
    const d = new Date(String(b.follow_up_at));
    if (Number.isNaN(d.getTime())) return { ok: false, error: "follow_up_at must be a valid ISO date" };
    follow_up_at = d.toISOString();
  }

  return { ok: true, data: { kind: b.kind, outcome, body, duration_seconds, follow_up_at } };
}

function getAuthorLabel(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }): string {
  const meta = user.user_metadata || {};
  const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  if (fullName) return fullName;
  return user.email || "agent";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { phone: phoneParam } = await params;
    const phone = decodeURIComponent(phoneParam);

    if (!E164_RE.test(phone)) {
      return NextResponse.json({ error: "Invalid phone format (expected E.164)" }, { status: 400 });
    }

    const parsed = validate(await req.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const data = parsed.data;

    // Get the user (requireAuth verified the session; re-read for id + metadata)
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: () => {},
        },
      }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify customer exists (FK would error otherwise; nicer 404 here)
    const { data: customer, error: custErr } = await supabaseAdmin
      .schema(SCHEMA)
      .from("customers")
      .select("phone_e164, notes")
      .eq("phone_e164", phone)
      .maybeSingle();

    if (custErr) throw custErr;
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Insert call_log row
    const { data: entry, error: logErr } = await supabaseAdmin
      .schema(SCHEMA)
      .from("call_log")
      .insert({
        customer_phone_e164: phone,
        agent_user_id: user.id,
        kind: data.kind,
        outcome: data.outcome,
        body: data.body,
        duration_seconds: data.duration_seconds,
        follow_up_at: data.follow_up_at,
      })
      .select("*")
      .single();

    if (logErr) throw logErr;

    // Append a formatted block to customers.notes when there's body text.
    // Newest on top. Read-then-write — acceptable for v1 (low concurrency
    // per customer); see project_call_center_crm.md for race-condition note.
    let updatedNotes: string | null = (customer as { notes: string | null }).notes;
    if (data.body) {
      const author = getAuthorLabel(user);
      const stamp = sofiaDateTimeLabel();
      const block = `[${stamp} · ${author}]\n${data.body}`;
      updatedNotes = updatedNotes && updatedNotes.trim().length > 0
        ? `${block}\n\n${updatedNotes}`
        : block;

      const { error: updErr } = await supabaseAdmin
        .schema(SCHEMA)
        .from("customers")
        .update({ notes: updatedNotes })
        .eq("phone_e164", phone);

      if (updErr) throw updErr;
    }

    return NextResponse.json({ entry, notes: updatedNotes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("POST /api/customers/[phone]/log failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
