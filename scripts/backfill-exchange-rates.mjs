/**
 * Backfill exchange rates for existing orders.
 *
 *   1. Pull the last 90 days of ECB reference rates and upsert into
 *      public.exchange_rates.
 *   2. For each non-EUR store schema, look up every order's currency +
 *      shopify_created_at date and write the historical rate into
 *      orders.exchange_rate_to_eur. The STORED generated *_eur columns
 *      recompute automatically.
 *   3. Refresh daily_aggregates so dashboard widgets reflect EUR-normalised
 *      values immediately.
 *   4. Re-upsert customers (RO is BG-style customers table-less today, but
 *      BG customers' total_spent is also rebuilt from orders.total_price
 *      → now total_price_eur, so a refresh is needed).
 *
 * Safe to re-run. ECB rates are upserted on (rate_date, currency).
 *
 * Usage:
 *   node scripts/backfill-exchange-rates.mjs                 # full run
 *   node scripts/backfill-exchange-rates.mjs --dry-run       # no DB writes
 *   node scripts/backfill-exchange-rates.mjs --skip-rates    # rates already loaded
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// ---- env ----
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
const skipRates = args.includes('--skip-rates');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ============================================================
// 1. ECB rates
// ============================================================

const ECB_HIST_FULL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';

function parseEcbXml(xml) {
  const days = [];
  const dayRe = /<Cube\s+time="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/Cube>/g;
  const rateRe = /<Cube\s+currency="([A-Z]{3})"\s+rate="([\d.]+)"\s*\/>/g;
  let dm;
  while ((dm = dayRe.exec(xml)) !== null) {
    const date = dm[1];
    const inner = dm[2];
    const rates = {};
    let rm;
    while ((rm = rateRe.exec(inner)) !== null) {
      const v = parseFloat(rm[2]);
      if (Number.isFinite(v) && v > 0) rates[rm[1]] = v;
    }
    if (Object.keys(rates).length) days.push({ date, rates });
  }
  return days;
}

async function loadEcbRates() {
  console.log('→ Fetching ECB historical rates (full history) ...');
  const res = await fetch(ECB_HIST_FULL, { headers: { Accept: 'application/xml' } });
  if (!res.ok) throw new Error(`ECB returned ${res.status}`);
  const xml = await res.text();
  const days = parseEcbXml(xml);
  console.log(`  parsed ${days.length} days of rates`);

  const rows = [];
  for (const d of days) {
    for (const [currency, rate_to_eur] of Object.entries(d.rates)) {
      rows.push({ rate_date: d.date, currency, rate_to_eur, source: 'ecb' });
    }
  }
  console.log(`  ${rows.length} (date, currency) rows to upsert`);

  if (dryRun) {
    console.log('  [dry-run] skipping insert');
    return;
  }

  // Upsert in chunks (Supabase JS POSTs the whole array; chunk to keep < 1MB)
  const CHUNK = 2000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await sb
      .from('exchange_rates')
      .upsert(chunk, { onConflict: 'rate_date,currency' });
    if (error) throw new Error(`exchange_rates upsert failed: ${error.message}`);
    inserted += chunk.length;
    process.stdout.write(`  upserted ${inserted}/${rows.length}\r`);
  }
  console.log(`\n  ✓ ECB rates loaded`);
}

// ============================================================
// 2. Per-order rate backfill (RO + any future non-EUR store)
// ============================================================

const NON_EUR_SCHEMAS = ['store_ro']; // BG/GR are EUR → exchange_rate_to_eur stays 1.0

async function rateForDate(currency, dateStr) {
  // Get most recent rate at-or-before dateStr
  const { data, error } = await sb
    .from('exchange_rates')
    .select('rate_date, rate_to_eur')
    .eq('currency', currency)
    .lte('rate_date', dateStr)
    .order('rate_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`rate lookup failed: ${error.message}`);
  if (!data) throw new Error(`no rate for ${currency} on or before ${dateStr}`);
  return Number(data.rate_to_eur);
}

async function backfillSchema(schema) {
  console.log(`→ Backfilling exchange_rate_to_eur in ${schema}.orders ...`);
  const sbStore = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema },
  });

  const { data: orders, error } = await sbStore
    .from('orders')
    .select('id, currency, shopify_created_at, exchange_rate_to_eur, total_price')
    .order('id');
  if (error) throw new Error(`fetch failed: ${error.message}`);

  console.log(`  ${orders.length} rows`);
  let updated = 0;
  let skipped = 0;
  for (const o of orders) {
    const cur = o.currency || 'EUR';
    if (cur === 'EUR') { skipped++; continue; }
    const dateStr = o.shopify_created_at.slice(0, 10);
    const rate = await rateForDate(cur, dateStr);

    // Skip if already correct (avoids re-triggering generated columns)
    if (Math.abs(Number(o.exchange_rate_to_eur) - rate) < 1e-7) { skipped++; continue; }

    if (dryRun) {
      console.log(`    [dry-run] order id=${o.id} ${cur} ${dateStr} ${o.total_price} → rate ${rate} (was ${o.exchange_rate_to_eur})`);
      updated++;
      continue;
    }

    const { error: upErr } = await sbStore
      .from('orders')
      .update({ exchange_rate_to_eur: rate })
      .eq('id', o.id);
    if (upErr) throw new Error(`update id=${o.id}: ${upErr.message}`);
    updated++;
  }
  console.log(`  ✓ ${schema}: updated ${updated}, skipped ${skipped}`);
}

// ============================================================
// 3. Refresh daily aggregates so dashboard reflects EUR
// ============================================================

async function refreshAggregates() {
  for (const schema of ['store_bg', 'store_gr', 'store_ro']) {
    console.log(`→ refresh_daily_aggregates(${schema}) ...`);
    if (dryRun) { console.log('  [dry-run]'); continue; }
    const { error } = await sb.rpc('refresh_daily_aggregates', { p_schema: schema });
    if (error) throw new Error(`refresh failed: ${error.message}`);
    console.log('  ✓');
  }
}

// ============================================================
// 4. Re-upsert customers from latest order so total_spent recomputes in EUR
// ============================================================

async function refreshCustomerTotals() {
  for (const schema of ['store_bg', 'store_gr', 'store_ro']) {
    const sbStore = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema },
    });
    // Pick the latest order per customer that has a phone, then call upsert
    // for it — the function recomputes total_spent from the full history.
    const { data: latest, error } = await sbStore
      .from('orders')
      .select('raw_payload, shopify_created_at')
      .order('shopify_created_at', { ascending: false })
      .limit(20000);
    if (error) throw new Error(`fetch ${schema}: ${error.message}`);

    // Dedup by customer.id keeping the newest order
    const seen = new Set();
    const picks = [];
    for (const r of latest || []) {
      const cid = r.raw_payload?.customer?.id;
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      picks.push(r.raw_payload);
    }
    console.log(`→ ${schema}: ${picks.length} unique customers to refresh`);

    if (dryRun) { console.log('  [dry-run]'); continue; }

    let ok = 0, fail = 0;
    for (const payload of picks) {
      const phoneRaw =
        payload?.customer?.phone ||
        payload?.shipping_address?.phone ||
        payload?.billing_address?.phone ||
        null;
      if (!phoneRaw) continue;
      // Use loose canonical: keep digits + leading +. The DB function trusts
      // its caller's normalisation; for backfill we rely on the value already
      // stored in customers (we're only triggering a recompute).
      const e164 = canonicalPhone(phoneRaw);
      if (!e164) continue;

      const country = (payload?.shipping_address?.country_code || schema.slice(-2).toUpperCase());

      const { error: rpcErr } = await sb.rpc('upsert_customer_from_order', {
        p_schema: schema,
        p_phone_e164: e164,
        p_phone_raw: phoneRaw,
        p_country: country,
        p_payload: payload,
      });
      if (rpcErr) { fail++; if (fail < 5) console.warn('  warn:', rpcErr.message); }
      else ok++;
    }
    console.log(`  ✓ ${schema}: refreshed ${ok}, failed ${fail}`);
  }
}

function canonicalPhone(raw) {
  if (!raw) return null;
  const trimmed = String(raw).replace(/[\s\-().]/g, '');
  if (trimmed.startsWith('+') && /^\+\d{8,15}$/.test(trimmed)) return trimmed;
  // BG-only fallback so we don't crash; mostly the DB row already has the
  // correct phone_e164 keyed and we just need the function to fire.
  if (/^359\d{8,9}$/.test(trimmed)) return '+' + trimmed;
  if (/^0\d{9}$/.test(trimmed)) return '+359' + trimmed.slice(1);
  return null;
}

// ============================================================
// main
// ============================================================

(async () => {
  console.log(dryRun ? 'DRY RUN' : 'LIVE');
  if (!skipRates) await loadEcbRates();
  for (const s of NON_EUR_SCHEMAS) await backfillSchema(s);
  await refreshAggregates();
  await refreshCustomerTotals();
  console.log('Done.');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
