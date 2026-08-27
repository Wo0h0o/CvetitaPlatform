/**
 * Inspect RO orders raw_payload to determine the correct currency strategy.
 * Reads top-level + price_set fields to see if presentment_money is EUR.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(import.meta.dirname, '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }, db: { schema: 'store_ro' } }
);

const { data, error } = await supabase
  .from('orders')
  .select('shopify_order_id, shopify_order_number, currency, total_price, raw_payload, shopify_created_at, event_type')
  .order('shopify_created_at', { ascending: false })
  .limit(3);

if (error) {
  console.error('Query error:', error);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.log('No RO orders found.');
  process.exit(0);
}

for (const row of data) {
  const p = row.raw_payload || {};
  console.log('='.repeat(80));
  console.log('Order:', row.shopify_order_number, '| ID:', row.shopify_order_id, '| Created:', row.shopify_created_at);
  console.log('DB stored:', { currency: row.currency, total_price: row.total_price });
  console.log('Payload top-level:', {
    currency: p.currency,
    presentment_currency: p.presentment_currency,
    total_price: p.total_price,
    subtotal_price: p.subtotal_price,
  });
  console.log('total_price_set:', JSON.stringify(p.total_price_set));
  console.log('subtotal_price_set:', JSON.stringify(p.subtotal_price_set));
  console.log('current_total_price_set:', JSON.stringify(p.current_total_price_set));
  console.log('total_discounts_set:', JSON.stringify(p.total_discounts_set));
  console.log('total_tax_set:', JSON.stringify(p.total_tax_set));
  if (p.line_items?.[0]) {
    const li = p.line_items[0];
    console.log('First line item:', {
      title: li.title,
      price: li.price,
      price_set: li.price_set,
    });
  }
}
