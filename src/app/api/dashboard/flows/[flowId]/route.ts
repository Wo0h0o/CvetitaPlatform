import { NextRequest, NextResponse } from "next/server";
import { getFlowDetail } from "@/lib/klaviyo";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  if (!process.env.KLAVIYO_API_KEY) {
    return NextResponse.json({ error: "Klaviyo not configured" });
  }

  try {
    const { flowId } = await params;
    const preset = req.nextUrl.searchParams.get("preset") || "30d";
    const data = await getFlowDetail(flowId, preset);

    if (!data) {
      return NextResponse.json({ error: "Flow not found" }, { status: 404 });
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("Flow detail error:", error);
    return NextResponse.json({
      error: "Flow fetch failed",
      detail: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
