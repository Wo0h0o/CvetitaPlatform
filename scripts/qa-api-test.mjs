/**
 * QA Audit Script — ECOMMAND Platform API Routes
 * Tests the Supabase query layer directly (no HTTP auth needed).
 *
 * Run: node scripts/qa-api-test.mjs   (from repo root)
 *
 * Secrets come from .env.local (same pattern as the other scripts/*.mjs).
 * NEVER paste literals back in here — see 2026-05 incident:
 * `incident_2026_05_runaway_curl_script.md` in memory.
 */

import crypto from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Load .env.local into process.env (zero-dep parser; same pattern as
// scripts/inspect-ro-currency.mjs).
// ---------------------------------------------------------------------------

const envPath = resolve(import.meta.dirname, "..", ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  const key = t.slice(0, i);
  if (!process.env[key]) process.env[key] = t.slice(i + 1);
}

// ---------------------------------------------------------------------------
// Config — read from env, fail fast if missing
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const SHOPIFY_FALLBACK_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN; // optional
const BG_STORE_DOMAIN = process.env.SHOPIFY_BG_DOMAIN || "p0xgx1-ic.myshopify.com";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

const required = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY };
const missing = Object.entries(required)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing required env vars in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}

function mask(s) {
  if (!s) return "(null)";
  if (s.length <= 10) return "***";
  return s.slice(0, 6) + "..." + s.slice(-4);
}

// ---------------------------------------------------------------------------
// Supabase REST helper
// ---------------------------------------------------------------------------

const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function supabaseGet(path, schema = "public") {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const h = { ...headers };
  if (schema !== "public") {
    h["Accept-Profile"] = schema;
  }

  // Retry up to 5 times with back-off for PGRST002 (database waking up)
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers: h });
    if (res.ok) return res.json();

    const text = await res.text();
    if (res.status === 503 && text.includes("PGRST002") && attempt < 5) {
      const wait = attempt * 3000;
      console.log(`    [RETRY] DB warming up (attempt ${attempt}/5), waiting ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Decryption (mirrors src/lib/encryption.ts)
// ---------------------------------------------------------------------------

function decrypt(encrypted) {
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const FROM = daysAgo(30);
const TO = daysAgo(0); // today

// ===========================================================================
// TESTS
// ===========================================================================

let passCount = 0;
let failCount = 0;

function printHeader(title) {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

function pass(msg) {
  passCount++;
  console.log(`  [PASS] ${msg}`);
}

function fail(msg, err) {
  failCount++;
  console.log(`  [FAIL] ${msg}`);
  if (err) console.log(`         Error: ${err}`);
}

// ---------------------------------------------------------------------------
// TEST 1: GET /api/stores equivalent
// ---------------------------------------------------------------------------

async function test1_stores() {
  printHeader("TEST 1: GET /api/stores — List active stores");
  try {
    const stores = await supabaseGet("stores?is_active=eq.true&order=name");
    console.log(`  Found ${stores.length} active store(s):\n`);
    for (const s of stores) {
      console.log(`    ID:          ${s.id}`);
      console.log(`    Name:        ${s.name}`);
      console.log(`    Market:      ${s.market_code}`);
      console.log(`    Domain:      ${s.domain}`);
      console.log(`    Platform:    ${s.platform}`);
      console.log(`    Schema:      store_${s.market_code}`);
      console.log(`    Created:     ${s.created_at}`);
      console.log();
    }
    if (stores.length > 0) {
      pass(`Returned ${stores.length} active store(s)`);
    } else {
      fail("No active stores found — pipeline may be broken");
    }
    return stores;
  } catch (err) {
    fail("Could not query stores", err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// TEST 2: GET /api/sales/kpis equivalent
// ---------------------------------------------------------------------------

async function test2_kpis(stores) {
  printHeader(`TEST 2: GET /api/sales/kpis — KPIs for last 30 days (${FROM} to ${TO})`);

  if (stores.length === 0) {
    fail("Skipped — no stores available");
    return;
  }

  let combinedRevenue = 0, combinedOrders = 0, combinedCustomers = 0;

  for (const store of stores) {
    const schema = `store_${store.market_code}`;
    try {
      const rows = await supabaseGet(
        `daily_aggregates?order_date=gte.${FROM}&order_date=lte.${TO}&select=total_revenue,total_orders,unique_customers`,
        schema
      );

      let revenue = 0, orders = 0, customers = 0;
      for (const r of rows) {
        revenue += Number(r.total_revenue);
        orders += Number(r.total_orders);
        customers += Number(r.unique_customers);
      }

      console.log(`\n  Store: ${store.name} (${schema})`);
      console.log(`    Days with data:  ${rows.length}`);
      console.log(`    Total Revenue:   ${revenue.toFixed(2)} EUR`);
      console.log(`    Total Orders:    ${orders}`);
      console.log(`    Unique Customers: ${customers}`);

      combinedRevenue += revenue;
      combinedOrders += orders;
      combinedCustomers += customers;

      if (rows.length > 0) {
        pass(`${store.name}: ${rows.length} aggregate rows, revenue=${revenue.toFixed(2)}`);
      } else {
        fail(`${store.name}: 0 aggregate rows in last 30 days — check sync pipeline`);
      }
    } catch (err) {
      fail(`${store.name} (${schema}): query failed`, err.message);
    }
  }

  console.log(`\n  --- COMBINED (all stores) ---`);
  console.log(`    Total Revenue:    ${combinedRevenue.toFixed(2)} EUR`);
  console.log(`    Total Orders:     ${combinedOrders}`);
  console.log(`    Unique Customers: ${combinedCustomers}`);
  if (combinedOrders > 0) {
    console.log(`    AOV:              ${(combinedRevenue / combinedOrders).toFixed(2)} EUR`);
  }
}

// ---------------------------------------------------------------------------
// TEST 3: GET /api/sales/top-products equivalent
// ---------------------------------------------------------------------------

async function test3_topProducts(stores) {
  printHeader(`TEST 3: GET /api/sales/top-products — Top 5 products (${FROM} to ${TO})`);

  if (stores.length === 0) {
    fail("Skipped — no stores available");
    return;
  }

  const byTitle = new Map();

  for (const store of stores) {
    const schema = `store_${store.market_code}`;
    try {
      const rows = await supabaseGet(
        `daily_aggregates?order_date=gte.${FROM}&order_date=lte.${TO}&select=top_products`,
        schema
      );

      for (const row of rows) {
        if (!row.top_products) continue;
        for (const p of row.top_products) {
          const existing = byTitle.get(p.title) || { quantity: 0, revenue: 0 };
          existing.quantity += Number(p.quantity);
          existing.revenue += Number(p.revenue);
          byTitle.set(p.title, existing);
        }
      }
    } catch (err) {
      fail(`${store.name}: top_products query failed`, err.message);
    }
  }

  const sorted = Array.from(byTitle.entries())
    .map(([title, vals]) => ({ title, ...vals }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  if (sorted.length === 0) {
    fail("No top_products data found in daily_aggregates for last 30 days");
  } else {
    console.log();
    console.log("  Rank | Revenue     | Qty  | Product");
    console.log("  " + "-".repeat(66));
    sorted.forEach((p, i) => {
      console.log(
        `  #${i + 1}   | ${p.revenue.toFixed(2).padStart(10)} | ${String(p.quantity).padStart(4)} | ${p.title}`
      );
    });
    pass(`Found ${byTitle.size} unique products, top 5 shown`);
  }
}

// ---------------------------------------------------------------------------
// TEST 4: GET /api/sales/store/store_bg/orders — Latest 5 orders
// ---------------------------------------------------------------------------

async function test4_orders() {
  printHeader("TEST 4: GET /api/sales/store/[storeId]/orders — Latest 5 from store_bg");

  try {
    const rows = await supabaseGet(
      `orders?select=shopify_order_id,shopify_order_number,email,financial_status,fulfillment_status,total_price,shopify_created_at,received_at&order=received_at.desc`,
      "store_bg"
    );

    // Deduplicate by shopify_order_id (keep latest received_at)
    const seen = new Set();
    const deduped = [];
    for (const r of rows) {
      if (seen.has(r.shopify_order_id)) continue;
      seen.add(r.shopify_order_id);
      deduped.push(r);
    }

    // Sort by shopify_created_at desc
    deduped.sort((a, b) => new Date(b.shopify_created_at) - new Date(a.shopify_created_at));
    const top5 = deduped.slice(0, 5);

    if (top5.length === 0) {
      fail("No orders found in store_bg.orders");
      return;
    }

    console.log();
    console.log(`  Total unique orders in store_bg: ${deduped.length}`);
    console.log();

    for (const o of top5) {
      const emailMasked = o.email ? o.email.replace(/(.{2}).*(@.*)/, "$1***$2") : "(no email)";
      console.log(`  Order #${o.shopify_order_number}`);
      console.log(`    Total Price:      ${Number(o.total_price).toFixed(2)} EUR`);
      console.log(`    Financial Status: ${o.financial_status}`);
      console.log(`    Email:            ${emailMasked}`);
      console.log(`    Created:          ${o.shopify_created_at}`);
      console.log();
    }

    pass(`Returned ${top5.length} latest orders (of ${deduped.length} total unique)`);
  } catch (err) {
    fail("store_bg.orders query failed", err.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 5: Connection test — decrypt token, call Shopify /shop.json
// ---------------------------------------------------------------------------

async function test5_connectionTest() {
  printHeader("TEST 5: Connection test — Shopify /admin/api/2024-10/shop.json");

  let tokenToUse = null;
  let tokenSource = "unknown";
  let domain = BG_STORE_DOMAIN;

  // Step 1: Try getting encrypted credentials from Supabase
  try {
    const stores = await supabaseGet("stores?market_code=eq.bg&is_active=eq.true");
    if (stores.length > 0) {
      const storeId = stores[0].id;
      console.log(`  BG Store ID: ${storeId}`);

      const creds = await supabaseGet(
        `store_credentials?store_id=eq.${storeId}&service=eq.shopify&select=credentials,status`
      );
      if (creds.length > 0) {
        const credData = creds[0].credentials;
        console.log(`  Credential status: ${creds[0].status}`);
        console.log(`  Store domain:      ${credData.store_domain}`);
        console.log(`  API version:       ${credData.api_version}`);
        console.log(`  Token (encrypted): ${mask(credData.access_token)}`);

        try {
          tokenToUse = decrypt(credData.access_token);
          tokenSource = "supabase+decrypted";
          console.log(`  Token (decrypted): ${mask(tokenToUse)}`);
          pass("AES-256-GCM decryption successful");
          domain = credData.store_domain || BG_STORE_DOMAIN;
        } catch (decErr) {
          fail("Decryption failed", decErr.message);
        }
      }
    }
  } catch (err) {
    console.log(`  [WARN] Supabase unavailable for credential lookup: ${err.message.slice(0, 80)}`);
    console.log(`  [WARN] Falling back to .env.local SHOPIFY_ACCESS_TOKEN`);
  }

  // Fallback to .env.local token (optional — only if SHOPIFY_ACCESS_TOKEN is set)
  if (!tokenToUse && SHOPIFY_FALLBACK_TOKEN) {
    tokenToUse = SHOPIFY_FALLBACK_TOKEN;
    tokenSource = ".env.local SHOPIFY_ACCESS_TOKEN";
    console.log(`  Using fallback token from .env.local: ${mask(tokenToUse)}`);
  }

  if (!tokenToUse) {
    fail("No Shopify token available — set SHOPIFY_ACCESS_TOKEN in .env.local or unpause Supabase");
    return;
  }

  // Step 2: Call Shopify
  const shopUrl = `https://${domain}/admin/api/${API_VERSION}/shop.json`;
  console.log(`  Token source: ${tokenSource}`);
  console.log(`  Calling: ${shopUrl}`);

  try {
    const res = await fetch(shopUrl, {
      headers: {
        "X-Shopify-Access-Token": tokenToUse,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      fail(`Shopify returned HTTP ${res.status}`, await res.text());
      return;
    }

    const data = await res.json();
    const shop = data.shop;

    console.log();
    console.log(`  Shop Name:   ${shop?.name || "Unknown"}`);
    console.log(`  Shop Email:  ${shop?.email || "N/A"}`);
    console.log(`  Plan:        ${shop?.plan_display_name || "N/A"}`);
    console.log(`  Domain:      ${shop?.myshopify_domain || domain}`);
    console.log(`  Country:     ${shop?.country_name || "N/A"}`);
    console.log(`  Currency:    ${shop?.currency || "N/A"}`);

    pass("Shopify connection test passed");
  } catch (err) {
    fail("Shopify API call failed", err.message);
  }
}

// ===========================================================================
// PRE-FLIGHT: Check if Supabase DB is awake
// ===========================================================================

async function checkSupabaseHealth() {
  printHeader("PRE-FLIGHT: Supabase Database Health Check");

  // Check auth (always on)
  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY },
    });
    const authData = await authRes.json();
    console.log(`  Auth service: OK (${authData.name} ${authData.version})`);
  } catch (e) {
    console.log(`  Auth service: UNREACHABLE (${e.message})`);
  }

  // Check PostgREST / database
  const restRes = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });

  if (restRes.ok) {
    console.log("  Database:     OK (PostgREST responding)");
    return true;
  }

  const body = await restRes.text();
  if (body.includes("PGRST002")) {
    console.log("  Database:     PAUSED / UNREACHABLE");
    console.log("  PostgREST error PGRST002: Cannot query database for schema cache.");
    console.log("  This typically means the Supabase project database is paused.");
    console.log("  ACTION NEEDED: Go to https://supabase.com/dashboard/project/qggrlwfphxyoslrqkajw");
    console.log("                 and click 'Restore project' to unpause the database.");
    console.log();
    console.log("  Tests 1-4 (Supabase queries) will be SKIPPED.");
    console.log("  Test 5 (Shopify connection) will use .env.local fallback token.");
    return false;
  }

  console.log(`  Database:     ERROR ${restRes.status}: ${body.slice(0, 120)}`);
  return false;
}

// ===========================================================================
// RUN ALL
// ===========================================================================

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║         ECOMMAND Platform — API Route QA Audit                     ║");
  console.log(`║         Date: ${new Date().toISOString().slice(0, 19)}                            ║`);
  console.log(`║         Supabase: ${mask(SUPABASE_SERVICE_ROLE_KEY).padEnd(48)}║`);
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  const dbAlive = await checkSupabaseHealth();

  if (dbAlive) {
    const stores = await test1_stores();
    await test2_kpis(stores);
    await test3_topProducts(stores);
    await test4_orders();
  } else {
    printHeader("TESTS 1-4: SKIPPED (Database paused)");
    console.log("  Tests 1-4 require a live Supabase database.");
    console.log("  Restore the project and re-run this script.");
    failCount += 4;
  }

  await test5_connectionTest();

  // Summary
  printHeader("SUMMARY");
  console.log(`  Passed: ${passCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log(`  Total:  ${passCount + failCount}`);
  console.log();

  if (failCount > 0) {
    if (!dbAlive) {
      console.log("  DATABASE PAUSED: 4 tests could not run. Restore Supabase project and re-run.");
    }
    console.log("  *** SOME TESTS FAILED — review output above ***");
  } else {
    console.log("  All tests passed.");
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
