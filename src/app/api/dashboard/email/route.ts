import { NextResponse } from "next/server";
import { getKlaviyoMetrics } from "@/lib/klaviyo";

export async function GET() {
  if (!process.env.KLAVIYO_API_KEY) {
    return NextResponse.json({ error: "Klaviyo not configured" });
  }

  try {
    const data = await getKlaviyoMetrics();

    if (!data) {
      return NextResponse.json({ error: "Klaviyo fetch failed" });
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("Email API error:", error);
    return NextResponse.json({
      error: "Klaviyo fetch failed",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
