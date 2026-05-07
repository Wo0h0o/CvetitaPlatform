/**
 * One-shot customers backfill.
 * Reads existing orders from store_<market>.orders, groups by Shopify
 * customer_id (one rep payload per customer), normalizes phone in TS,
 * and calls public.upsert_customer_from_order once per unique customer.
 *
 * The SQL function does cross-customer-id phone merging on its side
 * (shopify_customer_ids array). So order of processing doesn't matter.
 *
 * Usage: node scripts/backfill-customers.mjs [market_code]
 *        node scripts/backfill-customers.mjs bg   (default)
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { parsePhoneNumberFromString } from "libphonenumber-js";

// ---- Load env ----
const envPath = resolve(import.meta.dirname, "..", ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[trimmed.slice(0, eq)]) {
    process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const MARKET = process.argv[2] || "bg";
const SCHEMA = `store_${MARKET}`;
const DEFAULT_COUNTRY = MARKET.toUpperCase();

// ---- Phone normalization (mirrors src/lib/phone.ts) ----
function normalizePhone(input, defaultCountry = DEFAULT_COUNTRY) {
  if (!input || typeof input !== "string") {
    return { e164: null, raw: "", isValid: false, country: null };
  }
  const raw = input.trim();
  if (!raw) return { e164: null, raw: input, isValid: false, country: null };
  const cleaned = raw.replace(/^00/, "+");
  try {
    const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
    if (!parsed) return { e164: null, raw, isValid: false, country: null };
    const valid = parsed.isValid();
    return {
      e164: valid ? parsed.number : null,
      raw,
      isValid: valid,
      country: valid ? (parsed.country ?? null) : null,
    };
  } catch {
    return { e164: null, raw, isValid: false, country: null };
  }
}

function pickPhone(payload) {
  const candidates = [
    payload?.customer?.phone,
    payload?.shipping_address?.phone,
    payload?.billing_address?.phone,
    payload?.phone,
  ];
  for (const c of candidates) {
    const n = normalizePhone(c);
    if (n.isValid) return n;
  }
  for (const c of candidates) {
    if (c) return { e164: null, raw: c, isValid: false, country: null };
  }
  return { e164: null, raw: "", isValid: false, country: null };
}

// ---- Main ----
async function main() {
  console.log(`Backfilling customers in schema: ${SCHEMA}`);

  // Pull distinct latest payload per shopify_order_id via SQL (RPC-safe path)
  // Using management API would be cleaner but service_role + raw query isn't
  // available through the JS client; we use a paginated select instead.
  // For 2700 rows this is fine.
  console.log("Fetching distinct latest orders...");

  const orderIds = await fetchDistinctOrderIds();
  console.log(`  Distinct shopify_order_ids: ${orderIds.length}`);

  // Group by shopify_customer_id, keep latest payload per customer
  const byCustomer = new Map(); // cid -> { payload, shopify_created_at }
  let noCustomerId = 0;

  // Fetch in batches — pull raw_payload + shopify_created_at for each distinct order
  const BATCH = 500;
  for (let i = 0; i < orderIds.length; i += BATCH) {
    const batch = orderIds.slice(i, i + BATCH);
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("orders")
      .select("shopify_order_id, raw_payload, shopify_created_at, received_at")
      .in("shopify_order_id", batch)
      .order("shopify_order_id", { ascending: true })
      .order("received_at", { ascending: false });

    if (error) throw error;

    // Dedupe to latest event per order
    const seen = new Set();
    for (const row of data) {
      if (seen.has(row.shopify_order_id)) continue;
      seen.add(row.shopify_order_id);

      const cid = row.raw_payload?.customer?.id;
      if (!cid) {
        noCustomerId++;
        continue;
      }
      const existing = byCustomer.get(cid);
      if (
        !existing ||
        new Date(row.shopify_created_at) > new Date(existing.shopify_created_at)
      ) {
        byCustomer.set(cid, {
          payload: row.raw_payload,
          shopify_created_at: row.shopify_created_at,
        });
      }
    }

    process.stdout.write(`  Processed batch ${i / BATCH + 1} (${i + batch.length}/${orderIds.length})\r`);
  }
  console.log("");
  console.log(`  Distinct customers: ${byCustomer.size}`);
  console.log(`  Orders with no customer_id: ${noCustomerId}`);

  // Process each unique customer
  let processed = 0;
  let skippedNoPhone = 0;
  let failed = 0;
  let i = 0;
  const total = byCustomer.size;

  for (const [, { payload }] of byCustomer) {
    i++;
    const phone = pickPhone(payload);
    if (!phone.isValid) {
      skippedNoPhone++;
      continue;
    }

    const { error } = await supabase.rpc("upsert_customer_from_order", {
      p_schema: SCHEMA,
      p_phone_e164: phone.e164,
      p_phone_raw: phone.raw,
      p_country: phone.country,
      p_payload: payload,
    });

    if (error) {
      failed++;
      if (failed <= 5) console.error(`  Upsert failed for ${phone.e164}: ${error.message}`);
    } else {
      processed++;
    }

    if (i % 100 === 0) {
      process.stdout.write(`  Upsert progress: ${i}/${total}\r`);
    }
  }
  console.log("");

  // ---- Audit ----
  console.log("\n--- Audit ---");
  const { count: customersCount } = await supabase
    .schema(SCHEMA)
    .from("customers")
    .select("*", { count: "exact", head: true });

  // Supabase JS caps responses at 1000 rows by default — paginate the audit read.
  let totalOrders = 0;
  let totalSpent = 0;
  let auditFrom = 0;
  const AUDIT_PAGE = 1000;
  while (true) {
    const { data: stats, error: e } = await supabase
      .schema(SCHEMA)
      .from("customers")
      .select("total_orders, total_spent")
      .range(auditFrom, auditFrom + AUDIT_PAGE - 1);
    if (e) throw e;
    if (!stats?.length) break;
    for (const r of stats) {
      totalOrders += r.total_orders || 0;
      totalSpent += Number(r.total_spent || 0);
    }
    if (stats.length < AUDIT_PAGE) break;
    auditFrom += AUDIT_PAGE;
  }

  console.log(`  Distinct customer_ids in orders:   ${byCustomer.size}`);
  console.log(`  Customers upserted:                 ${processed}`);
  console.log(`  Skipped (no valid phone):           ${skippedNoPhone}`);
  console.log(`  Failed:                             ${failed}`);
  console.log(`  Rows in customers table:            ${customersCount}`);
  console.log(`  Phone coverage:                     ${((processed / byCustomer.size) * 100).toFixed(1)}%`);
  console.log(`  Aggregated total orders (cached):   ${totalOrders}`);
  console.log(`  Aggregated total spent (cached):    €${totalSpent.toFixed(2)}`);
}

async function fetchDistinctOrderIds() {
  // Pull all distinct shopify_order_ids — paginate via supabase
  const ids = new Set();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("orders")
      .select("shopify_order_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) ids.add(r.shopify_order_id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return Array.from(ids);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
