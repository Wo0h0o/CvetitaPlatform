import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { logger } from "@/lib/logger";

const SHOPIFY_TIMEOUT = 10_000;
const API_VERSION = "2024-10";

interface TestConnectionBody {
  domain: string;
  accessToken: string;
}

/**
 * POST /api/stores/test-connection
 *
 * Tests a Shopify connection without storing credentials.
 * Calls GET /admin/api/{version}/shop.json with the provided token.
 */
export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  let body: TestConnectionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { domain, accessToken } = body;

  if (!domain?.trim()) {
    return NextResponse.json({ error: "domain is required" }, { status: 400 });
  }
  if (!accessToken?.trim()) {
    return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
  }

  // Sanitize domain — accept "store.myshopify.com" or "store"
  const cleanDomain = domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${cleanDomain}/admin/api/${API_VERSION}/shop.json`;

  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken.trim(),
          "Content-Type": "application/json",
        },
      },
      SHOPIFY_TIMEOUT
    );

    if (!res.ok) {
      const status = res.status;
      if (status === 401 || status === 403) {
        return NextResponse.json({
          ok: false,
          error: "Невалиден Access Token или няма достъп",
        });
      }
      if (status === 404) {
        return NextResponse.json({
          ok: false,
          error: "Магазинът не е намерен. Проверете домейна.",
        });
      }
      return NextResponse.json({
        ok: false,
        error: `Shopify върна грешка: ${status}`,
      });
    }

    const data = await res.json();
    const shop = data.shop;

    return NextResponse.json({
      ok: true,
      shopName: shop?.name || "Unknown",
      shopEmail: shop?.email || null,
      shopPlan: shop?.plan_display_name || null,
      shopDomain: shop?.myshopify_domain || cleanDomain,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    logger.error("Shopify connection test failed", { domain: cleanDomain, error: message });

    if (message.includes("timeout") || message.includes("Timeout")) {
      return NextResponse.json({
        ok: false,
        error: "Времето за връзка изтече. Проверете домейна.",
      });
    }

    return NextResponse.json({
      ok: false,
      error: "Не може да се свърже с Shopify. Проверете домейна.",
    });
  }
}
