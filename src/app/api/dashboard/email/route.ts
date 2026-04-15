import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getKlaviyoMetrics } from "@/lib/klaviyo";
import { requireAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!process.env.KLAVIYO_API_KEY) {
    return NextResponse.json({ error: "Klaviyo not configured" });
  }

  const preset = request.nextUrl.searchParams.get("preset") || "30d";

  try {
    const data = await getKlaviyoMetrics(preset);

    if (!data) {
      return NextResponse.json({ error: "Klaviyo fetch failed" });
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=300" },
    });
  } catch (error) {
    logger.error("Email API error", { error: String(error) });
    return NextResponse.json(
      { error: "Klaviyo fetch failed" },
      { status: 500 }
    );
  }
}
