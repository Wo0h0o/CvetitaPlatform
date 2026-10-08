import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchActiveStores } from "@/lib/sales-queries";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/stores — List active stores
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const stores = await fetchActiveStores();

    return NextResponse.json(
      { stores },
      {
        headers: {
          "Cache-Control": "s-maxage=300, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/stores failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/stores — Create a new store + schema + credentials
// ---------------------------------------------------------------------------

interface CreateStoreBody {
  name: string;
  marketCode: string;
  platform: "shopify";
  domain: string;
  accessToken: string;
  clientSecret?: string;
  organizationId: string;
  apiVersion?: string;
}

const VALID_MARKETS = new Set(["bg", "gr", "ro", "de", "it", "uk", "hu", "hr", "rs", "cz", "si"]);

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  let body: CreateStoreBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  const { name, marketCode, platform, domain, accessToken, clientSecret, organizationId } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!VALID_MARKETS.has(marketCode)) {
    return NextResponse.json(
      { error: `marketCode must be one of: ${[...VALID_MARKETS].join(", ")}` },
      { status: 400 }
    );
  }
  if (platform !== "shopify") {
    return NextResponse.json({ error: "Only 'shopify' platform is supported" }, { status: 400 });
  }
  if (!domain?.trim()) {
    return NextResponse.json({ error: "domain is required" }, { status: 400 });
  }
  if (!accessToken?.trim()) {
    return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
  }
  if (!organizationId?.trim()) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const schemaName = `store_${marketCode}`;

  try {
    // 1. Има ли вече магазин за този пазар?
    const { data: existingRows } = await supabaseAdmin
      .from("stores")
      .select("id, settings")
      .eq("market_code", marketCode)
      .limit(1);
    const existingStore = existingRows?.[0];

    let storeId: string;
    let reuse = false;

    if (existingStore) {
      // Вече има Shopify креденшъли? → истински дубликат, отказваме.
      const { data: cred } = await supabaseAdmin
        .from("store_credentials")
        .select("id")
        .eq("store_id", existingStore.id)
        .eq("service", "shopify")
        .maybeSingle();
      if (cred) {
        return NextResponse.json(
          { error: `Store with market code '${marketCode}' already exists` },
          { status: 409 }
        );
      }
      // Само-Meta запис (напр. HU) → надграждаме го с Shopify, пазим Meta връзката.
      reuse = true;
      storeId = existingStore.id as string;
      const settings = { ...((existingStore.settings as Record<string, unknown>) || {}) };
      delete settings.meta_only;
      const { error: updErr } = await supabaseAdmin
        .from("stores")
        .update({ name: name.trim(), domain: domain.trim(), platform, is_active: true, settings })
        .eq("id", storeId);
      if (updErr) {
        logger.error("Failed to update meta-only store", { storeId, error: updErr.message });
        throw new Error("Failed to update store record");
      }
    } else {
      // 2. Нов магазин
      const { data: store, error: storeErr } = await supabaseAdmin
        .from("stores")
        .insert({
          name: name.trim(),
          market_code: marketCode,
          platform,
          domain: domain.trim(),
          organization_id: organizationId,
          is_active: true,
          settings: {},
        })
        .select("id")
        .single();
      if (storeErr || !store) {
        logger.error("Failed to insert store", { error: storeErr?.message });
        throw new Error("Failed to create store record");
      }
      storeId = store.id;
    }

    // 3. Encrypt & insert credentials
    const credentials = {
      store_domain: domain.trim(),
      access_token: encrypt(accessToken.trim()),
      client_secret: clientSecret?.trim() ? encrypt(clientSecret.trim()) : null,
      api_version: body.apiVersion || "2024-10",
    };

    const { error: credErr } = await supabaseAdmin
      .from("store_credentials")
      .insert({
        store_id: storeId,
        service: "shopify",
        credentials,
        status: "active",
      });

    if (credErr) {
      logger.error("Failed to insert credentials", { storeId, error: credErr.message });
      if (!reuse) await supabaseAdmin.from("stores").delete().eq("id", storeId);
      throw new Error("Failed to save credentials");
    }

    // 4. Create per-store schema (idempotent — CREATE … IF NOT EXISTS). За reuse
    // (HU) схемата вече съществува, затова грешка тук е незначителна.
    const { error: schemaErr } = await supabaseAdmin.rpc("create_store_schema", {
      p_schema: schemaName,
    });

    if (schemaErr && !reuse) {
      logger.error("Failed to create store schema", { schemaName, error: schemaErr.message });
      await supabaseAdmin.from("store_credentials").delete().eq("store_id", storeId);
      await supabaseAdmin.from("stores").delete().eq("id", storeId);
      throw new Error("Failed to create database schema");
    } else if (schemaErr) {
      logger.warn("create_store_schema warning on reuse (non-fatal)", { schemaName, error: schemaErr.message });
    }

    // 5. Register schema in PostgREST
    const { error: regErr } = await supabaseAdmin.rpc("register_store_in_postgrest", {
      p_schema: schemaName,
    });

    if (regErr) {
      // Non-fatal — schema exists, just PostgREST needs manual reload
      logger.warn("PostgREST registration failed (non-fatal)", {
        schemaName,
        error: regErr.message,
      });
    }

    logger.info("Store created successfully", { storeId, schemaName, market: marketCode });

    return NextResponse.json({ storeId, schemaName }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("POST /api/stores failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
