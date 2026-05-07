/**
 * Backfill products from Shopify Admin API for all 3 stores.
 *
 * Idempotent: upserts by shopify_product_id (UNIQUE constraint), so re-runs
 * just refresh the data. Useful any time the products table drifts (e.g.
 * after a webhook outage).
 *
 * Mirrors src/lib/webhook-handlers/shopify-products.ts normalization.
 *
 * Usage:
 *   node scripts/backfill-products.mjs                        # all stores
 *   node scripts/backfill-products.mjs --market bg            # one store
 *   node scripts/backfill-products.mjs --dry-run              # no writes
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

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
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

function parseTags(tags) {
  if (!tags) return [];
  return tags.split(',').map((t) => t.trim()).filter(Boolean);
}

function normalizeVariants(variants) {
  return (variants || []).map((v) => ({
    id: v.id,
    sku: v.sku || null,
    price: parseFloat(v.price) || 0,
    inventory_quantity: v.inventory_quantity || 0,
    title: v.title,
  }));
}

function normalizeImages(images) {
  return (images || []).map((img) => ({
    id: img.id,
    src: img.src,
    alt: img.alt || null,
  }));
}

function parseLinkHeader(h) {
  if (!h) return null;
  const m = h.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

async function fetchAllProducts(domain, token) {
  const products = [];
  let url = `https://${domain}/admin/api/2024-10/products.json?limit=250`;
  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Shopify ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = await res.json();
    products.push(...(j.products || []));
    url = parseLinkHeader(res.headers.get('link'));
    if (url) await new Promise((r) => setTimeout(r, 250));
  }
  return products;
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
    return { fetched: 0, upserted: 0, errors: 0 };
  }

  const token = decrypt(cred.credentials.access_token);
  const domain = cred.credentials.store_domain;
  const schema = `store_${store.market_code}`;

  console.log(`  Fetching products...`);
  const products = await fetchAllProducts(domain, token);
  console.log(`  Fetched ${products.length} products from Shopify`);

  if (dryRun) {
    if (products.length > 0) {
      const sample = products[0];
      console.log(`  Sample: "${sample.title}" status=${sample.status} variants=${sample.variants?.length ?? 0}`);
    }
    return { fetched: products.length, upserted: 0, errors: 0 };
  }

  let upserted = 0, errors = 0;
  for (const p of products) {
    const row = {
      shopify_product_id: p.id,
      title: p.title,
      handle: p.handle,
      vendor: p.vendor || null,
      product_type: p.product_type || null,
      status: p.status || 'active',
      tags: parseTags(p.tags),
      variants: normalizeVariants(p.variants),
      images: normalizeImages(p.images),
      shopify_created_at: p.created_at,
      shopify_updated_at: p.updated_at,
      synced_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .schema(schema)
      .from('products')
      .upsert(row, { onConflict: 'shopify_product_id' });

    if (error) {
      errors++;
      console.log(`    ERR upsert ${p.id}: ${error.message}`);
    } else {
      upserted++;
    }
  }

  console.log(`  Upserted: ${upserted}${errors ? ` (errors: ${errors})` : ''}`);
  return { fetched: products.length, upserted, errors };
}

const { data: stores } = await supabase
  .from('stores')
  .select('id, name, market_code, domain')
  .eq('is_active', true)
  .order('market_code');

const filtered = marketArg ? stores.filter((s) => s.market_code === marketArg) : stores;
console.log(`Backfilling products for ${filtered.length} store(s)${dryRun ? ' [dry-run]' : ''}`);

const totals = { fetched: 0, upserted: 0, errors: 0 };
for (const s of filtered) {
  const r = await backfillStore(s);
  totals.fetched += r.fetched;
  totals.upserted += r.upserted;
  totals.errors += r.errors;
}

console.log('\n=== TOTALS ===');
console.log(totals);
