import { NextResponse } from "next/server";
import { getKlaviyoMetrics } from "@/lib/klaviyo";

export async function GET() {
  try {
    const hasKey = !!process.env.KLAVIYO_API_KEY;
    const keyPrefix = process.env.KLAVIYO_API_KEY?.slice(0, 6) || "MISSING";
    console.log(`[email] KLAVIYO_API_KEY present: ${hasKey}, prefix: ${keyPrefix}`);

    const data = await getKlaviyoMetrics();

    if (!data) {
      return NextResponse.json({ error: "Klaviyo not configured" });
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("Email API error:", error);
    return NextResponse.json({ error: "Klaviyo fetch failed" });
  }
}
