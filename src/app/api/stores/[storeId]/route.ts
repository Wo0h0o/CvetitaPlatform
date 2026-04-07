import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { StoreRow } from "@/types/store";

/**
 * GET /api/stores/[storeId]
 *
 * Returns store details + credential status (without decrypted secrets).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { storeId } = await params;

    const { data: store, error: storeErr } = await supabaseAdmin
      .from("stores")
      .select("*")
      .eq("id", storeId)
      .single();

    if (storeErr || !store) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const { data: creds } = await supabaseAdmin
      .from("store_credentials")
      .select("service, status, connected_at, expires_at")
      .eq("store_id", storeId);

    return NextResponse.json({
      store: store as StoreRow,
      connections: (creds ?? []).map(
        (c: { service: string; status: string; connected_at: string; expires_at: string | null }) => ({
          service: c.service,
          status: c.status,
          connectedAt: c.connected_at,
          expiresAt: c.expires_at,
        })
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/stores/[storeId] failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
