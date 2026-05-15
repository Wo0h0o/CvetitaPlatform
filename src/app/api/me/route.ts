import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/user-role";

/**
 * GET /api/me — returns role context for the current session.
 *
 * Used by the Sidebar to know whether to render the HR-only menu (worker)
 * or the full dashboard menu (admin/manager/viewer/agent). Cheap enough
 * that we can let SWR keep it warm without polling.
 */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    role: ctx.role,
  });
}
