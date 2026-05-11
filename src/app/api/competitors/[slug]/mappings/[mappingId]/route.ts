import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createServerClient } from "@supabase/ssr";
import { logger, requestMeta } from "@/lib/logger";

function getSupabase(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll(); }, setAll() {} } }
  );
}

// DELETE /api/competitors/[slug]/mappings/[mappingId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; mappingId: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { slug, mappingId } = await params;
    const supabase = getSupabase(req);

    // RLS will block if caller is not a member of the org owning this mapping.
    const { data: deleted, error } = await supabase
      .from("competitor_product_map")
      .delete()
      .eq("id", mappingId)
      .select("id, competitor_id")
      .single();

    if (error || !deleted) {
      return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
    }

    // Sanity-check: confirm the deleted mapping really belonged to this slug's competitor
    const { data: comp } = await supabase
      .from("competitors")
      .select("id")
      .eq("slug", slug)
      .single();

    if (!comp || comp.id !== deleted.competitor_id) {
      logger.error("Mapping/slug mismatch on delete", { ...requestMeta(req), slug, mappingId });
      // The row is already gone — return success but log the anomaly.
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Mapping DELETE failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to delete mapping" }, { status: 500 });
  }
}
