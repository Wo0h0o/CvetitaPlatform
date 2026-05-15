import { NextRequest, NextResponse } from "next/server";
import { getUserContext, isManagerOrAdmin } from "@/lib/user-role";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger, requestMeta } from "@/lib/logger";

interface InviteBody {
  email: string;
  full_name?: string;
  job_title?: string;
}

/**
 * POST /api/hr/invite — invite a new worker to the org.
 *
 * Manager+admin only. Sends a Supabase magic-link invite email; the worker
 * clicks the link, gets logged in, and lands on /hr (middleware redirects
 * them away from / since worker role is HR-only).
 *
 * Idempotency: if the email already exists in auth.users, we DO NOT create a
 * duplicate. Instead we surface a clear "вече съществува" error and let the
 * admin decide whether to add the existing user as a worker manually.
 */
export async function POST(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: InviteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return NextResponse.json({ error: "Невалиден имейл" }, { status: 400 });
  }

  try {
    // Send invite email — Supabase creates the auth.users row for us.
    const { data: invited, error: inviteErr } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(body.email, {
        data: {
          full_name: body.full_name ?? null,
        },
      });

    if (inviteErr) {
      if (/already been registered|already exists/i.test(inviteErr.message)) {
        return NextResponse.json(
          { error: "Този имейл вече е регистриран в системата" },
          { status: 409 }
        );
      }
      throw inviteErr;
    }
    if (!invited?.user) throw new Error("Invite succeeded but no user returned");

    const newUserId = invited.user.id;

    // Add as organization member with role=worker. Using admin client to
    // bypass the org_member RLS insert check (admin policy requires being
    // admin of the org; manager wouldn't pass that). The role-check above
    // is the actual authorization.
    const { error: memErr } = await supabaseAdmin
      .from("organization_members")
      .insert({
        organization_id: ctx.organizationId,
        user_id: newUserId,
        role: "worker",
      });
    if (memErr) throw memErr;

    // Pre-create the HR profile row (with name + title if provided) so the
    // /settings page renders a populated form on first login.
    const { error: profileErr } = await supabaseAdmin.from("hr_profiles").insert({
      user_id: newUserId,
      organization_id: ctx.organizationId,
      full_name: body.full_name ?? null,
      job_title: body.job_title ?? null,
    });
    if (profileErr) throw profileErr;

    return NextResponse.json({
      user: { id: newUserId, email: body.email },
    });
  } catch (err) {
    logger.error("HR invite failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to invite worker" }, { status: 500 });
  }
}

interface RemoveBody {
  userId: string;
}

/**
 * DELETE /api/hr/invite — remove a worker from the org. Hard-deletes the
 * auth.users row only if they have no other org memberships (we don't want
 * to orphan a user that's a worker in two orgs, even though the platform
 * doesn't support multi-org yet).
 */
export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: RemoveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  try {
    // Sanity: only remove worker-role members of THIS org. Don't allow
    // privilege escalation by removing an admin via this endpoint.
    const { data: member } = await supabaseAdmin
      .from("organization_members")
      .select("role, organization_id")
      .eq("user_id", body.userId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!member || member.role !== "worker") {
      return NextResponse.json({ error: "Not a worker in this org" }, { status: 400 });
    }

    const { error: delMemErr } = await supabaseAdmin
      .from("organization_members")
      .delete()
      .eq("user_id", body.userId)
      .eq("organization_id", ctx.organizationId);
    if (delMemErr) throw delMemErr;

    // If no other memberships, delete auth.users entirely. hr_profiles +
    // hr_day_events + hr_leave_requests cascade on the user_id FK.
    const { data: otherMemberships } = await supabaseAdmin
      .from("organization_members")
      .select("id")
      .eq("user_id", body.userId);
    if (!otherMemberships || otherMemberships.length === 0) {
      await supabaseAdmin.auth.admin.deleteUser(body.userId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("HR invite DELETE failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to remove worker" }, { status: 500 });
  }
}
