/**
 * Backfill orders from Shopify Admin API for the gap window when webhooks
 * weren't reaching us. Inserts one event row per fetched order:
 *   event_type = 'cancelled' if order.cancelled_at, else 'updated'.
 *
 * Idempotent: webhook_event_id is `backfill-{shopify_order_id}` so re-runs
 * skip duplicates via the UNIQUE constraint.
 *
 * After insert, calls public.upsert_customer_from_order to refresh the
 * materialized customer cache (last_order_at, total_spent, etc.).
 *
 * Usage:
 *   node scripts/backfill-orders.mjs                        # since 2026-04-06
 *   node scripts/backfill-orders.mjs --since 2026-04-06     # explicit
 *   node scripts/backfill-orders.mjs --market bg            # one store
 *   node scripts/backfill-orders.mjs --dry-run              # no writes
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ---- Load .env.local ----
const envPath = resolve(import.meta.dirname, '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
}

// ---- CLI args ----
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sinceArg = args.indexOf('--since') !== -1 ? args[args.indexOf('--since') + 1] : '2026-04-06';
const marketArg = args.indexOf('--market') !== -1 ? args[args.indexOf('--market') + 1] : null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !ENCRYPTION_KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ENCRYPTION_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function decrypt(enc) {
  const p = enc.split(':');
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(p[0], 'base64');
  const tag = Buffer.from(p[1], 'base64');
  const ct = Buffer.from(p[2], 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

function normalizeLineItems(items) {
  return (items || []).map((item) => ({
    shopify_line_item_id: item.id,
    product_id: item.product_id || null,
    variant_id: item.variant_id || null,
    title: item.title,
    quantity: item.quantity,
    price: parseFloat(item.price) || 0,
    sku: item.sku || null,
  }));
}

function calculateRefundTotal(payload) {
  if (!payload.refunds?.length) return 0;
  return payload.refunds.reduce((sum, r) => {
    const tx = (r.transactions || []).reduce((acc, t) => acc + (parseFloat(t.amount) || 0), 0);
    return sum + tx;
  }, 0);
}

function parseLinkHeader(h) {
  if (!h) return null;
  const m = h.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

async function fetchAllOrders(domain, token, sinceISO) {
  const orders = [];
  let url =
    `https://${domain}/admin/api/2024-10/orders.json` +
    `?status=any&updated_at_min=${encodeURIComponent(sinceISO)}&limit=250`;

  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Shopify ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = await res.json();
    orders.push(...(j.orders || []));
    url = parseLinkHeader(res.headers.get('link'));
    if (url) await new Promise((r) => setTimeout(r, 250)); // gentle on rate limit
  }
  return orders;
}

async function backfillStore(store) {
  console.log(`\n=== ${store.name} (${store.market_code}) ===`);

  const { data: cred } = await supabase
    .from('store_credentials')
    .select('credentials')
    .eq('store_id', store.id)
    .eq('service', 'shopify')
    .single();

  if (!cred) {
    console.log('  no creds, skip');
    return { fetched: 0, inserted: 0, customerUpserts: 0 };
  }

  const token = decrypt(cred.credentials.access_token);
  const domain = cred.credentials.store_domain;
  const schema = `store_${store.market_code}`;
  const sinceISO = new Date(`${sinceArg}T00:00:00Z`).toISOString();

  console.log(`  Fetching orders updated since ${sinceISO}...`);
  const orders = await fetchAllOrders(domain, token, sinceISO);
  console.log(`  Fetched ${orders.length} orders from Shopify`);

  if (dryRun) {
    console.log('  [dry-run] would insert + upsert customer for each');
    if (orders.length > 0) {
      const sample = orders[0];
      console.log(`  Sample: #${sample.name} ${sample.financial_status} ${sample.total_price}`);
    }
    return { fetched: orders.length, inserted: 0, customerUpserts: 0 };
  }

  let inserted = 0, skipped = 0, errors = 0, customerUpserts = 0;
  for (const o of orders) {
    const eventType = o.cancelled_at ? 'cancelled' : 'updated';
    const totalRefunded = calculateRefundTotal(o);

    const row = {
      shopify_order_id: o.id,
      shopify_order_number: o.name || `#${o.order_number}`,
      webhook_event_id: `backfill-${o.id}-${eventType}`,
      event_type: eventType,
      email: o.email || null,
      financial_status: o.financial_status,
      fulfillment_status: o.fulfillment_status || null,
      currency: o.currency || 'EUR',
      total_price: parseFloat(o.total_price) || 0,
      subtotal_price: parseFloat(o.subtotal_price) || 0,
      total_tax: parseFloat(o.total_tax) || 0,
      total_discounts: parseFloat(o.total_discounts) || 0,
      total_refunded: totalRefunded,
      line_items: normalizeLineItems(o.line_items),
      raw_payload: o,
      shopify_created_at: o.created_at,
      shopify_updated_at: o.updated_at,
    };

    const { error } = await supabase.schema(schema).from('orders').insert(row);
    if (error) {
      if (error.code === '23505') {
        skipped++;
      } else {
        errors++;
        console.log(`    ERR insert ${o.id}: ${error.message}`);
        continue;
      }
    } else {
      inserted++;
    }

    // Refresh the materialized customer profile (idempotent).
    const { error: cuErr } = await supabase.rpc('upsert_customer_from_order', {
      p_schema: schema,
      p_phone_e164: pickPhone(o)?.e164 ?? null,
      p_phone_raw: pickPhone(o)?.raw ?? null,
      p_country: pickPhone(o)?.country ?? null,
      p_payload: o,
    });
    if (cuErr) {
      // Customer upsert is best-effort. Log but don't bail.
      if (!cuErr.message.includes('p_phone_e164') || cuErr.message.includes('NULL')) {
        // Skipping silent — phone-less orders are expected.
      }
    } else {
      customerUpserts++;
    }
  }

  console.log(
    `  Inserted: ${inserted}, skipped (duplicate): ${skipped}, errors: ${errors}, customer upserts: ${customerUpserts}`
  );
  return { fetched: orders.length, inserted, skipped, errors, customerUpserts };
}

// Phone extraction (mirrors src/lib/phone.ts simplified — for unit-less script).
// We use libphonenumber-js if available; otherwise the SQL function will be a no-op
// when phone is null and the customer cache won't update for that one order.
let parsePhone;
try {
  const mod = await import('libphonenumber-js');
  parsePhone = mod.parsePhoneNumberFromString;
} catch {
  console.warn('libphonenumber-js not available — phone enrichment will be skipped per order');
  parsePhone = () => null;
}

function pickPhone(o) {
  const candidates = [
    o.customer?.phone,
    o.shipping_address?.phone,
    o.billing_address?.phone,
    o.phone,
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const p = parsePhone(c.replace(/^00/, '+'), 'BG');
      if (p && p.isValid()) {
        return { e164: p.number, raw: c, country: p.country ?? null };
      }
    } catch { /* ignore */ }
  }
  return null;
}

// ---- Main ----
const { data: stores } = await supabase
  .from('stores')
  .select('id, name, market_code, domain')
  .eq('is_active', true)
  .order('market_code');

const filtered = marketArg ? stores.filter((s) => s.market_code === marketArg) : stores;
console.log(`Backfilling ${filtered.length} stores since ${sinceArg}${dryRun ? ' [dry-run]' : ''}`);

const totals = { fetched: 0, inserted: 0, skipped: 0, errors: 0, customerUpserts: 0 };
for (const s of filtered) {
  const r = await backfillStore(s);
  totals.fetched += r.fetched;
  totals.inserted += r.inserted;
  totals.skipped += r.skipped || 0;
  totals.errors += r.errors || 0;
  totals.customerUpserts += r.customerUpserts || 0;
}

console.log('\n=== TOTALS ===');
console.log(totals);
