import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

// v1: BG store only. TODO: resolve from store binding when going multi-store.
const SCHEMA = "store_bg";
const E164_RE = /^\+\d{8,15}$/;
const MAX_PREF_HOUR = 32;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { phone: phoneParam } = await params;
    const phone = decodeURIComponent(phoneParam);

    if (!E164_RE.test(phone)) {
      return NextResponse.json(
        { error: "Invalid phone format (expected E.164)" },
        { status: 400 }
      );
    }

    const [customerRes, ordersRes, callLogRes] = await Promise.all([
      supabaseAdmin
        .schema(SCHEMA)
        .from("customers")
        .select("*")
        .eq("phone_e164", phone)
        .maybeSingle(),
      supabaseAdmin.rpc("customer_orders", {
        p_schema: SCHEMA,
        p_phone: phone,
      }),
      supabaseAdmin
        .schema(SCHEMA)
        .from("call_log")
        .select("*")
        .eq("customer_phone_e164", phone)
        .order("created_at", { ascending: false }),
    ]);

    if (customerRes.error) throw customerRes.error;
    if (ordersRes.error) throw ordersRes.error;
    if (callLogRes.error) throw callLogRes.error;

    if (!customerRes.data) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Resolve agent names for any user IDs that appear in this profile
    // (call_log.agent_user_id, orders.attributed_agent_id, customer.pending_upsell_agent_id).
    const agentIds = new Set<string>();
    const customer = customerRes.data as Record<string, unknown>;
    if (typeof customer.pending_upsell_agent_id === "string") {
      agentIds.add(customer.pending_upsell_agent_id);
    }
    for (const e of (callLogRes.data ?? []) as Array<{ agent_user_id: string | null }>) {
      if (e.agent_user_id) agentIds.add(e.agent_user_id);
    }
    for (const o of (ordersRes.data ?? []) as Array<{ attributed_agent_id: string | null }>) {
      if (o.attributed_agent_id) agentIds.add(o.attributed_agent_id);
    }

    const agents: Record<string, { name: string; email: string | null }> = {};
    if (agentIds.size > 0) {
      try {
        // Small team — single page is enough; safety cap below.
        let page = 1;
        const perPage = 200;
        while (agentIds.size > 0) {
          const { data: users, error: usrErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
          if (usrErr) {
            logger.error("listUsers failed in customer profile", { error: usrErr.message });
            break;
          }
          for (const u of users.users) {
            if (!agentIds.has(u.id)) continue;
            const meta = (u.user_metadata || {}) as Record<string, unknown>;
            const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
            agents[u.id] = {
              name: fullName || u.email || u.id.slice(0, 8),
              email: u.email ?? null,
            };
            agentIds.delete(u.id);
          }
          if (users.users.length < perPage) break;
          page++;
          if (page > 10) break;
        }
      } catch (e) {
        logger.error("agent name lookup failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    return NextResponse.json({
      customer: customerRes.data,
      orders: ordersRes.data || [],
      call_log: callLogRes.data || [],
      agents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/customers/[phone] failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// PATCH /api/customers/[phone] — edit local profile fields only
// (do_not_call, preferred_call_hour). Notes are append-only via the log
// endpoint; Shopify-derived fields aren't editable from here.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { phone: phoneParam } = await params;
    const phone = decodeURIComponent(phoneParam);

    if (!E164_RE.test(phone)) {
      return NextResponse.json({ error: "Invalid phone format" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const update: { do_not_call?: boolean; preferred_call_hour?: string | null } = {};

    if ("do_not_call" in body) {
      if (typeof body.do_not_call !== "boolean") {
        return NextResponse.json({ error: "do_not_call must be boolean" }, { status: 400 });
      }
      update.do_not_call = body.do_not_call;
    }

    if ("preferred_call_hour" in body) {
      const v = body.preferred_call_hour;
      if (v === null || v === "") {
        update.preferred_call_hour = null;
      } else if (typeof v === "string" && v.length <= MAX_PREF_HOUR) {
        update.preferred_call_hour = v.trim() || null;
      } else {
        return NextResponse.json({ error: `preferred_call_hour must be a string ≤ ${MAX_PREF_HOUR} chars` }, { status: 400 });
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .schema(SCHEMA)
      .from("customers")
      .update(update)
      .eq("phone_e164", phone)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json({ customer: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("PATCH /api/customers/[phone] failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
