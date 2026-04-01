import { NextResponse } from "next/server";

export async function GET() {
  const keys = [
    "KLAVIYO_API_KEY",
    "SHOPIFY_STORE_URL",
    "CLAUDE_API_KEY",
    "GA4_PROPERTY_ID",
  ];

  const status: Record<string, string> = {};
  for (const key of keys) {
    const val = process.env[key];
    status[key] = val ? `SET (${val.slice(0, 6)}...)` : "MISSING";
  }

  return NextResponse.json(status);
}
