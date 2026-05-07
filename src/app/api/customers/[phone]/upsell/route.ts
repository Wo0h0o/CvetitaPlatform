import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

const SCHEMA = "store_bg";
const E164_RE = /^\+\d{8,15}$/;
const WINDOW_DAYS = 7;

async function getUserId(req: NextRequest): Promise<string | null> {
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
  return user?.id ?? null;
}

function decodePhone(raw: string): string | null {
  const phone = decodeURIComponent(raw);
  return E164_RE.test(phone) ? phone : null;
}

// POST — mark customer for upsell. Overwrites any existing pending flag
// (latest agent wins, per product decision).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { phone: phoneParam } = await params;
    const phone = decodePhone(phoneParam);
    if (!phone) {
      return NextResponse.json({ error: "Invalid phone format" }, { status: 400 });
    }

    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const expires = new Date(now.getTime() + WINDOW_DAYS * 86_400_000);

    const { data, error } = await supabaseAdmin
      .schema(SCHEMA)
      .from("customers")
      .update({
        pending_upsell_agent_id: userId,
        pending_upsell_at: now.toISOString(),
        pending_upsell_expires_at: expires.toISOString(),
      })
      .eq("phone_e164", phone)
      .select("pending_upsell_agent_id, pending_upsell_at, pending_upsell_expires_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json({ pending: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("POST /api/customers/[phone]/upsell failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// DELETE — clear the pending upsell flag.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { phone: phoneParam } = await params;
    const phone = decodePhone(phoneParam);
    if (!phone) {
      return NextResponse.json({ error: "Invalid phone format" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .schema(SCHEMA)
      .from("customers")
      .update({
        pending_upsell_agent_id: null,
        pending_upsell_at: null,
        pending_upsell_expires_at: null,
      })
      .eq("phone_e164", phone)
      .select("phone_e164")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json({ pending: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("DELETE /api/customers/[phone]/upsell failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
