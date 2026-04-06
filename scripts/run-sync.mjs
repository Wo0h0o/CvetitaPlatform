/**
 * Direct sync test — bypasses the API route and runs sync logic directly.
 * Usage: node scripts/run-sync.mjs
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually (no dotenv dependency)
const envPath = resolve(import.meta.dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const val = trimmed.slice(eqIdx + 1);
  if (!process.env[key]) process.env[key] = val;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// ---- Minimal Supabase client ----
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- Minimal encryption (matching src/lib/encryption.ts) ----
import crypto from 'crypto';

function decrypt(encrypted) {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const [ivB64, tagB64, ctB64] = encrypted.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ---- Load store config ----
const STORE_ID = 'ae0db575-6da7-4c19-8d11-76a357247826';

async function loadConfig() {
  const { data: store } = await supabase.from('stores').select('*').eq('id', STORE_ID).single();
  const { data: cred } = await supabase.from('store_credentials').select('*').eq('store_id', STORE_ID).eq('service', 'shopify').single();

  return {
    store,
    schemaName: `store_${store.market_code}`,
    credentials: {
      store_domain: cred.credentials.store_domain,
      access_token: decrypt(cred.credentials.access_token),
      client_secret: null,
      api_version: cred.credentials.api_version || '2024-10',
    },
  };
}

// ---- Shopify fetch helpers ----
function buildFetch(config) {
  const { store_domain, access_token, api_version } = config.credentials;
  const base = `https://${store_domain}/admin/api/${api_version}`;
  return (path) => fetch(`${base}${path}`, {
    headers: { 'X-Shopify-Access-Token': access_token, 'Content-Type': 'application/json' },
  });
}

function getNextPage(linkHeader) {
  if (!linkHeader) return null;
  const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

// ---- Product sync ----
async function syncProducts(config, shopify) {
  const schema = config.schemaName;
  let url = '/products.json?limit=250&status=active';
  let total = 0;
  let page = 0;

  while (url) {
    const res = await shopify(url);
    if (!res.ok) { console.error(`Products API ${res.status}`); break; }
    const data = await res.json();
    const products = data.products || [];

    if (products.length > 0) {
      const rows = products.map(p => ({
        shopify_product_id: p.id,
        title: p.title,
        handle: p.handle,
        vendor: p.vendor || null,
        product_type: p.product_type || null,
        status: p.status || 'active',
        tags: p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        variants: (p.variants || []).map(v => ({ id: v.id, sku: v.sku || null, price: parseFloat(v.price) || 0, inventory_quantity: v.inventory_quantity || 0, title: v.title })),
        images: (p.images || []).map(i => ({ id: i.id, src: i.src, alt: i.alt || null })),
        shopify_created_at: p.created_at,
        shopify_updated_at: p.updated_at,
        synced_at: new Date().toISOString(),
      }));

      const { error } = await supabase.schema(schema).from('products').upsert(rows, { onConflict: 'shopify_product_id' });
      if (error) console.error(`  Product insert error:`, error.message);
      else total += products.length;
    }

    page++;
    console.log(`  Products page ${page}: ${products.length} items (total: ${total})`);

    const next = getNextPage(res.headers.get('link'));
    if (next) {
      const parsed = new URL(next);
      url = parsed.pathname.replace(`/admin/api/${config.credentials.api_version}`, '') + parsed.search;
      await new Promise(r => setTimeout(r, 500));
    } else {
      url = null;
    }
  }

  return total;
}

// ---- Order sync ----
async function syncOrders(config, shopify, daysBack = 90) {
  const schema = config.schemaName;
  const dateMin = new Date(Date.now() - daysBack * 86400000).toISOString();
  const params = new URLSearchParams({ created_at_min: dateMin, status: 'any', limit: '250' });
  let url = `/orders.json?${params}`;
  let total = 0;
  let page = 0;

  while (url) {
    const res = await shopify(url);
    if (!res.ok) {
      if (res.status === 429) {
        const wait = parseInt(res.headers.get('Retry-After') || '2', 10);
        console.log(`  Rate limited, waiting ${wait}s...`);
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      console.error(`Orders API ${res.status}`);
      break;
    }
    const data = await res.json();
    const orders = data.orders || [];

    if (orders.length > 0) {
      const rows = orders.map(o => ({
        shopify_order_id: o.id,
        shopify_order_number: o.name || `#${o.order_number}`,
        webhook_event_id: `backfill_${o.id}`,
        event_type: o.cancelled_at ? 'cancelled' : 'created',
        email: o.email || null,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status || null,
        currency: o.currency || 'BGN',
        total_price: parseFloat(o.total_price) || 0,
        subtotal_price: parseFloat(o.subtotal_price) || 0,
        total_tax: parseFloat(o.total_tax) || 0,
        total_discounts: parseFloat(o.total_discounts) || 0,
        total_refunded: 0,
        line_items: (o.line_items || []).map(li => ({
          shopify_line_item_id: li.id, product_id: li.product_id, variant_id: li.variant_id,
          title: li.title, quantity: li.quantity, price: parseFloat(li.price) || 0, sku: li.sku || null,
        })),
        raw_payload: o,
        shopify_created_at: o.created_at,
        shopify_updated_at: o.updated_at,
      }));

      const { error } = await supabase.schema(schema).from('orders').upsert(rows, { onConflict: 'webhook_event_id', ignoreDuplicates: true });
      if (error) console.error(`  Order insert error:`, error.message);
      else total += orders.length;
    }

    page++;
    console.log(`  Orders page ${page}: ${orders.length} items (total: ${total})`);

    const next = getNextPage(res.headers.get('link'));
    if (next) {
      const parsed = new URL(next);
      url = parsed.pathname.replace(`/admin/api/${config.credentials.api_version}`, '') + parsed.search;
      await new Promise(r => setTimeout(r, 500));
    } else {
      url = null;
    }
  }

  return total;
}

// ---- Main ----
async function main() {
  console.log('Loading store config...');
  const config = await loadConfig();
  console.log(`Store: ${config.store.name} (${config.schemaName})`);
  console.log(`Domain: ${config.credentials.store_domain}`);

  const shopify = buildFetch(config);

  console.log('\n--- Product Sync ---');
  const products = await syncProducts(config, shopify);
  console.log(`Products synced: ${products}`);

  console.log('\n--- Order Sync (90 days) ---');
  const orders = await syncOrders(config, shopify);
  console.log(`Orders synced: ${orders}`);

  console.log('\n--- Refreshing daily aggregates ---');
  const { error: rpcErr } = await supabase.rpc('refresh_daily_aggregates', { p_schema: config.schemaName });
  if (rpcErr) console.error('Aggregate refresh error:', rpcErr.message);
  else console.log('Aggregates refreshed!');

  // Verify
  console.log('\n--- Verification ---');
  const { data: prodCount } = await supabase.schema(config.schemaName).from('products').select('id', { count: 'exact', head: true });
  const { data: orderCount } = await supabase.schema(config.schemaName).from('orders').select('id', { count: 'exact', head: true });
  const { data: aggCount } = await supabase.schema(config.schemaName).from('daily_aggregates').select('id', { count: 'exact', head: true });

  const { count: pc } = await supabase.schema(config.schemaName).from('products').select('*', { count: 'exact', head: true });
  const { count: oc } = await supabase.schema(config.schemaName).from('orders').select('*', { count: 'exact', head: true });
  const { count: ac } = await supabase.schema(config.schemaName).from('daily_aggregates').select('*', { count: 'exact', head: true });

  console.log(`Products in DB: ${pc}`);
  console.log(`Orders in DB: ${oc}`);
  console.log(`Aggregate days: ${ac}`);

  // Sample aggregate
  const { data: sample } = await supabase.schema(config.schemaName).from('daily_aggregates').select('*').order('order_date', { ascending: false }).limit(3);
  if (sample) {
    console.log('\nLatest aggregates:');
    for (const row of sample) {
      console.log(`  ${row.order_date}: revenue=${row.total_revenue}, orders=${row.total_orders}, aov=${row.avg_order_value}`);
    }
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
