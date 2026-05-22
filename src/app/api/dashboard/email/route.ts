import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getKlaviyoMetrics, getKlaviyoComparison } from "@/lib/klaviyo";
import { requireAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!process.env.KLAVIYO_API_KEY) {
    return NextResponse.json({ error: "Klaviyo not configured" });
  }

  const preset = request.nextUrl.searchParams.get("preset") || "30d";

  try {
    // Sequential, NOT Promise.all — Klaviyo's report endpoints throttle a
    // burst of 4 concurrent queries (2 here + 2 in the comparison). The
    // primary fetch runs first and alone; the comparison follows.
    const data = await getKlaviyoMetrics(preset);

    if (!data) {
      return NextResponse.json({ error: "Klaviyo fetch failed" });
    }

    // Comparison is best-effort — a failed prev-period fetch drops the
    // deltas but must not take the whole page down (principle 8).
    const previous = await getKlaviyoComparison(preset).catch((e) => {
      logger.error("Klaviyo comparison failed", { error: String(e) });
      return null;
    });

    return NextResponse.json({ ...data, previous }, {
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
