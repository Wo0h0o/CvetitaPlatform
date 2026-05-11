/**
 * Backfill orders bypassing PostgREST schema cache.
 *
 * Why this exists: after seeding store_de / store_it / store_uk schemas,
 * Supabase's PostgREST instance kept the old schema list cached. Until it
 * reloads, every `supabase.schema('store_de').from('orders').insert()` call
 * returns PGRST106 "Invalid schema". The standard backfill-orders.mjs script
 * is therefore blocked.
 *
 * This script reaches the database through the Supabase Management API's
 * /v1/projects/{ref}/database/query endpoint, which executes raw SQL and is
 * independent of the PostgREST schema cache.
 *
 * Idempotent via UNIQUE (webhook_event_id) — same `backfill-{order_id}` pattern
 * as backfill-orders.mjs, so a later "official" backfill won't double-insert.
 *
 * Usage:
 *   node scripts/backfill-orders-via-mgmt-api.mjs --market de --since 2026-04-01
 *   node scripts/backfill-orders-via-mgmt-api.mjs --market it
 *   node scripts/backfill-orders-via-mgmt-api.mjs --market uk
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ---- .env.local ----
const envPath = resolve(import.meta.dirname, '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
}

// ---- workfolder shopify.env (for Shopify tokens per market) ----
const SHOPIFY_ENV = process.env.SHOPIFY_ENV_PATH
  || 'D:/Cvetitaherbal/analytics/website-translations/config/shopify.env';
if (!existsSync(SHOPIFY_ENV)) {
  console.error(`Shopify env not found: ${SHOPIFY_ENV}`);
  process.exit(1);
}
for (const line of readFileSync(SHOPIFY_ENV, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
}

const args = process.argv.slice(2);
const marketArg = args[args.indexOf('--market') + 1];
const sinceArg = args.indexOf('--since') !== -1
  ? args[args.indexOf('--since') + 1]
  : '2026-04-01';

if (!marketArg || !['de', 'it', 'uk', 'bg', 'gr', 'ro'].includes(marketArg)) {
  console.error('Usage: --market <bg|gr|ro|de|it|uk> [--since YYYY-MM-DD]');
  process.exit(1);
}

const SBP_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
if (!SBP_TOKEN || !PROJECT_REF) {
  console.error('Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env.local');
  process.exit(1);
}

// Map market → shopify creds (from shopify.env)
const MARKET_CONFIG = {
  de: { domain: 'cvetita-herbal-de.myshopify.com', token: process.env.SHOPIFY_ACCESS_TOKEN_DE },
  it: { domain: 'cvetita-herbal-it.myshopify.com', token: process.env.SHOPIFY_ACCESS_TOKEN_IT },
  uk: { domain: 'cvetita-herbal-uk.myshopify.com', token: process.env.SHOPIFY_ACCESS_TOKEN_UK },
};

const cfg = MARKET_CONFIG[marketArg];
if (!cfg?.token) {
  console.error(`Missing Shopify token for market=${marketArg}`);
  process.exit(1);
}
const schema = `store_${marketArg}`;

// ============================================================
// Supabase Management API SQL exec
// ============================================================

async function runSql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SBP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mgmt API SQL failed (${res.status}): ${body}`);
  }
  return res.json();
}

function escapeSqlString(s) {
  if (s === null || s === undefined) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

function escapeJsonb(obj) {
  if (obj === null || obj === undefined) return 'NULL';
  return `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
}

// ============================================================
// Fetch ECB rate for a given currency + date
// ============================================================

async function getRateToEur(currency, dateIso) {
  if (currency === 'EUR') return 1.0;
  const dateOnly = dateIso.slice(0, 10);
  // Use Mgmt API to query exchange_rates for the most recent rate ≤ dateOnly
  const result = await runSql(
    `SELECT rate_to_eur FROM public.exchange_rates ` +
    `WHERE currency = ${escapeSqlString(currency)} ` +
    `AND rate_date <= ${escapeSqlString(dateOnly)} ` +
    `ORDER BY rate_date DESC LIMIT 1;`
  );
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error(`No exchange rate for ${currency} on/before ${dateOnly}`);
  }
  return Number(result[0].rate_to_eur);
}

// ============================================================
// Shopify fetch
// ============================================================

async function fetchShopifyOrders(domain, token, sinceIso) {
  const orders = [];
  let url = new URL(`https://${domain}/admin/api/2024-10/orders.json`);
  url.searchParams.set('status', 'any');
  url.searchParams.set('updated_at_min', sinceIso);
  url.searchParams.set('limit', '250');

  for (let page = 0; page < 50; page++) {
    const res = await fetch(url.toString(), {
      headers: { 'X-Shopify-Access-Token': token },
    });
    if (!res.ok) {
      throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    }
    const body = await res.json();
    orders.push(...(body.orders || []));
    const link = res.headers.get('link');
    const nextMatch = link?.match(/<([^>]+)>;\s*rel="next"/);
    if (!nextMatch) break;
    url = new URL(nextMatch[1]);
  }
  return orders;
}

// ============================================================
// Build INSERT statement (one row)
// ============================================================

function buildInsertSql(o, rate) {
  const lineItems = (o.line_items || []).map((li) => ({
    shopify_line_item_id: li.id,
    product_id: li.product_id || null,
    variant_id: li.variant_id || null,
    title: li.title,
    quantity: li.quantity,
    price: parseFloat(li.price) || 0,
    sku: li.sku || null,
  }));
  const refundTotal = (o.refunds || []).reduce((sum, r) => {
    const tx = (r.transactions || []).reduce((a, t) => a + (parseFloat(t.amount) || 0), 0);
    return sum + tx;
  }, 0);

  const eventType = o.cancelled_at ? 'cancelled' : 'updated';
  const webhookEventId = `backfill-${o.id}`;

  return `
    INSERT INTO ${schema}.orders (
      shopify_order_id, shopify_order_number, webhook_event_id, event_type,
      email, financial_status, fulfillment_status, currency,
      total_price, subtotal_price, total_tax, total_discounts, total_refunded,
      line_items, raw_payload,
      shopify_created_at, shopify_updated_at, received_at, exchange_rate_to_eur
    ) VALUES (
      ${o.id}, ${escapeSqlString(o.order_number ? `#${o.order_number}` : null)},
      ${escapeSqlString(webhookEventId)}, ${escapeSqlString(eventType)},
      ${escapeSqlString(o.email)}, ${escapeSqlString(o.financial_status || 'pending')},
      ${escapeSqlString(o.fulfillment_status)}, ${escapeSqlString(o.currency || 'EUR')},
      ${parseFloat(o.total_price) || 0}, ${parseFloat(o.subtotal_price) || 0},
      ${parseFloat(o.total_tax) || 0}, ${parseFloat(o.total_discounts) || 0},
      ${refundTotal},
      ${escapeJsonb(lineItems)}, ${escapeJsonb(o)},
      ${escapeSqlString(o.created_at)}, ${escapeSqlString(o.updated_at)},
      now(), ${rate}
    )
    ON CONFLICT (webhook_event_id) DO NOTHING
    RETURNING shopify_order_id;
  `.trim();
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(`Backfilling ${schema} via Supabase Management API`);
  console.log(`  domain: ${cfg.domain}`);
  console.log(`  since:  ${sinceArg}T00:00:00Z\n`);

  const orders = await fetchShopifyOrders(cfg.domain, cfg.token, `${sinceArg}T00:00:00Z`);
  console.log(`  Fetched ${orders.length} orders from Shopify\n`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const o of orders) {
    try {
      const rate = await getRateToEur(o.currency || 'EUR', o.created_at);
      const sql = buildInsertSql(o, rate);
      const result = await runSql(sql);
      if (Array.isArray(result) && result.length > 0) {
        inserted++;
        console.log(`  ✓ inserted order ${o.id} (${o.total_price} ${o.currency}, rate=${rate})`);
      } else {
        skipped++;
        console.log(`  • skipped duplicate ${o.id}`);
      }
    } catch (err) {
      errors++;
      console.error(`  ✗ ERR order ${o.id}: ${err.message}`);
    }
  }

  console.log(`\n=== TOTALS ===`);
  console.log(`  fetched:  ${orders.length}`);
  console.log(`  inserted: ${inserted}`);
  console.log(`  skipped:  ${skipped}`);
  console.log(`  errors:   ${errors}`);

  if (inserted > 0) {
    console.log(`\nRefreshing daily_aggregates for ${schema}...`);
    await runSql(`SELECT public.refresh_daily_aggregates('${schema}');`);
    console.log(`  ✓ daily_aggregates refreshed`);
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
