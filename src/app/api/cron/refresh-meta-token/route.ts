import { NextResponse } from "next/server";
import { refreshToken } from "@/lib/meta";
import { requireCronSecret } from "@/lib/api-auth";

export async function GET(request: Request) {
  const cronError = requireCronSecret(request);
  if (cronError) return cronError;

  try {
    const result = await refreshToken();
    if (!result) {
      return NextResponse.json({ error: "Token refresh failed — check META_APP_ID, META_APP_SECRET, META_ACCESS_TOKEN" }, { status: 500 });
    }

    // Update Vercel env var so the new token persists across deploys
    const vercelToken = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    const teamId = process.env.VERCEL_TEAM_ID;

    if (vercelToken && projectId) {
      const baseUrl = `https://api.vercel.com/v10/projects/${projectId}/env`;
      const teamParam = teamId ? `?teamId=${teamId}` : "";

      // Find the existing META_ACCESS_TOKEN env var ID
      const listRes = await fetch(`${baseUrl}${teamParam}`, {
        headers: { Authorization: `Bearer ${vercelToken}` },
      });

      if (listRes.ok) {
        const envs: { envs: { id: string; key: string }[] } = await listRes.json();
        const metaEnv = envs.envs.find((e) => e.key === "META_ACCESS_TOKEN");

        if (metaEnv) {
          // Update the existing env var
          await fetch(`${baseUrl}/${metaEnv.id}${teamParam}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${vercelToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ value: result.token }),
          });
        }
      }
    }

    const expiresInDays = Math.round(result.expiresIn / 86400);
    return NextResponse.json({
      ok: true,
      expiresInDays,
      updatedVercel: !!(vercelToken && projectId),
    });
  } catch (error) {
    console.error("Meta token refresh error:", error);
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}
