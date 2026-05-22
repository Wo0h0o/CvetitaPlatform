import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { runReport, isGA4Configured } from "@/lib/ga4";
import { getMetaClient } from "@/lib/meta";

/**
 * GET /api/settings/health
 *
 * Live integration health probe. Replaces the hardcoded status badges on
 * /settings — those lied: a broken token or expired credential stayed
 * green forever (violates the "Real Data Only" principle).
 *
 * Each integration is probed independently with a cheap, real API call.
 * One failing probe never breaks the others (graceful degradation) — every
 * checker catches its own errors and resolves, so Promise.all never rejects.
 */

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT = 10_000;

type IntegrationStatus = "connected" | "error" | "disconnected";

interface IntegrationHealth {
  key: string;
  name: string;
  status: IntegrationStatus;
  detail: string;
}

/** Human-readable, token-free error string for a failed probe. */
function probeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Неизвестна грешка";
  if (/timeout/i.test(msg)) return "Времето за връзка изтече";
  return msg.slice(0, 120);
}

async function checkShopify(): Promise<IntegrationHealth> {
  const base = { key: "shopify", name: "Shopify" };
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!storeUrl || !token) {
    return { ...base, status: "disconnected", detail: "Няма конфигурирани креденшъли" };
  }
  try {
    const res = await fetchWithTimeout(
      `https://${storeUrl}/admin/api/2024-10/shop.json`,
      { headers: { "X-Shopify-Access-Token": token } },
      PROBE_TIMEOUT
    );
    if (!res.ok) {
      const reason = res.status === 401 || res.status === 403
        ? "Невалиден Access Token"
        : `Shopify върна ${res.status}`;
      return { ...base, status: "error", detail: reason };
    }
    const data = await res.json();
    return { ...base, status: "connected", detail: data.shop?.name ?? "Свързан" };
  } catch (err) {
    return { ...base, status: "error", detail: probeError(err) };
  }
}

async function checkGA4(): Promise<IntegrationHealth> {
  const base = { key: "ga4", name: "Google Analytics" };
  if (!isGA4Configured()) {
    return { ...base, status: "disconnected", detail: "Няма конфигуриран OAuth" };
  }
  try {
    // Cheapest possible report — exercises the full OAuth refresh + Data API
    // chain, which is exactly what we want to verify.
    await runReport({
      metrics: ["sessions"],
      startDate: "yesterday",
      endDate: "yesterday",
      limit: 1,
    });
    return { ...base, status: "connected", detail: "OAuth + Data API активни" };
  } catch (err) {
    return { ...base, status: "error", detail: probeError(err) };
  }
}

async function checkMeta(): Promise<IntegrationHealth> {
  const base = { key: "meta", name: "Meta Ads" };
  try {
    const client = await getMetaClient();
    if (!client.accountId || !client.token) {
      return { ...base, status: "disconnected", detail: "Няма конфигуриран рекламен акаунт" };
    }
    // Token passed via Authorization header — never in the URL (no token in logs).
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v21.0/${client.accountId}?fields=name,account_status`,
      { headers: { Authorization: `Bearer ${client.token}` } },
      PROBE_TIMEOUT
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body?.error?.message ?? `HTTP ${res.status}`;
      return { ...base, status: "error", detail: msg.slice(0, 120) };
    }
    const data = await res.json();
    // account_status 1 = ACTIVE; anything else means ads can't run.
    if (data.account_status !== 1) {
      return { ...base, status: "error", detail: "Рекламният акаунт не е активен" };
    }
    return { ...base, status: "connected", detail: data.name ?? "Свързан" };
  } catch (err) {
    return { ...base, status: "error", detail: probeError(err) };
  }
}

async function checkKlaviyo(): Promise<IntegrationHealth> {
  const base = { key: "klaviyo", name: "Klaviyo" };
  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) {
    return { ...base, status: "disconnected", detail: "Няма конфигуриран API ключ" };
  }
  try {
    const res = await fetchWithTimeout(
      "https://a.klaviyo.com/api/accounts/",
      {
        headers: {
          Authorization: `Klaviyo-API-Key ${apiKey}`,
          revision: "2024-10-15",
          Accept: "application/json",
        },
      },
      PROBE_TIMEOUT
    );
    if (!res.ok) {
      const reason = res.status === 401 || res.status === 403
        ? "Невалиден API ключ"
        : `Klaviyo върна ${res.status}`;
      return { ...base, status: "error", detail: reason };
    }
    const data = await res.json();
    const orgName = data?.data?.[0]?.attributes?.contact_information?.organization_name;
    return { ...base, status: "connected", detail: orgName ?? "Свързан" };
  } catch (err) {
    return { ...base, status: "error", detail: probeError(err) };
  }
}

/**
 * Google Ads has no direct API integration yet (awaiting Developer Token).
 * The /google-ads page sources its data from GA4 — so honestly: disconnected.
 */
function checkGoogleAds(): IntegrationHealth {
  return {
    key: "google-ads",
    name: "Google Ads",
    status: "disconnected",
    detail: "Директна интеграция предстои — данните идват от GA4",
  };
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const [shopify, ga4, meta, klaviyo] = await Promise.all([
    checkShopify(),
    checkGA4(),
    checkMeta(),
    checkKlaviyo(),
  ]);

  return NextResponse.json({
    integrations: [shopify, ga4, meta, klaviyo, checkGoogleAds()],
    checkedAt: new Date().toISOString(),
  });
}
