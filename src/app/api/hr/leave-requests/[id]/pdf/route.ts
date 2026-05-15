import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getUserContext, isManagerOrAdmin } from "@/lib/user-role";
import { generateLeavePdf } from "@/lib/pdf-leave";
import { logger, requestMeta } from "@/lib/logger";

function getSupabase(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

/**
 * GET /api/hr/leave-requests/[id]/pdf — renders the leave application
 * PDF on demand from the request's frozen snapshot. We don't store the
 * PDF blob — regenerating is cheap and avoids stale copies if the org
 * name ever changes in settings.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const supabase = getSupabase(req);
    const { data: rec, error } = await supabase
      .from("hr_leave_requests")
      .select(
        "id, user_id, leave_type, start_date, end_date, working_days, snapshot_full_name, snapshot_egn, snapshot_city, snapshot_address, snapshot_job_title, submitted_at, organization_id"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (rec.user_id !== ctx.userId && !isManagerOrAdmin(ctx.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Pull the org name for the header. Fall back to the hardcoded default
    // if the row doesn't have a settings.company.
    const { data: org } = await supabase
      .from("organizations")
      .select("name, settings")
      .eq("id", rec.organization_id)
      .maybeSingle();
    const orgName =
      (org?.settings as { company?: string } | null)?.company ||
      org?.name ||
      "Цветита Хербал ЕООД";

    const bytes = await generateLeavePdf({
      leave_type: rec.leave_type as "paid" | "unpaid",
      start_date: rec.start_date,
      end_date: rec.end_date ?? null,
      working_days: rec.working_days,
      full_name: rec.snapshot_full_name,
      egn: rec.snapshot_egn,
      city: rec.snapshot_city,
      address: rec.snapshot_address,
      job_title: rec.snapshot_job_title,
      submitted_at: rec.submitted_at,
      organization_name: orgName,
    });

    const filename = `Molba-${rec.leave_type === "paid" ? "platen" : "neplaten"}-otpusk-${rec.start_date}.pdf`;

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("HR leave PDF failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
