/**
 * Seed Cvetita DE, IT, UK stores + Shopify credentials.
 *
 * Idempotent. Safe to re-run. Performs:
 *   1. SELECT create_store_schema('store_de'|'store_it'|'store_uk') — provisions
 *      per-store tables (orders, products, webhook_log, daily_aggregates +
 *      exchange-rate columns from migration 022).
 *   2. UPSERT into public.stores (one row per market, is_active=true).
 *   3. UPSERT into public.store_credentials (service='shopify', encrypted
 *      access_token via AES-256-GCM matching src/lib/encryption.ts).
 *
 * Tokens are read from the workfolder env file (default
 * `D:/Cvetitaherbal/analytics/website-translations/config/shopify.env`).
 * No secrets ever land in this script's source. Override with SHOPIFY_ENV_PATH
 * if the file lives elsewhere.
 *
 * After running this, also run:
 *   node scripts/seed-integration-accounts.mjs    # creates Meta bindings
 *   node scripts/backfill-exchange-rates.mjs --skip-rates=false   # ensures GBP rate in DB
 *
 * Usage:
 *   node scripts/seed-stores-de-it-uk.mjs            # full run
 *   node scripts/seed-stores-de-it-uk.mjs --dry-run  # print, no writes
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import crypto from 'crypto';
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

// ---- Shopify tokens — read from the multi-store env file in the workfolder.
// The file holds per-market Shopify access tokens (DE/IT/UK + others). It is
// NEVER committed; the path below is the canonical local location.
const DEFAULT_SHOPIFY_ENV = 'D:/Cvetitaherbal/analytics/website-translations/config/shopify.env';
const shopifyEnvPath = process.env.SHOPIFY_ENV_PATH || DEFAULT_SHOPIFY_ENV;
if (!existsSync(shopifyEnvPath)) {
  console.error(
    `Shopify env file not found at: ${shopifyEnvPath}\n` +
      'Set SHOPIFY_ENV_PATH to the file containing SHOPIFY_ACCESS_TOKEN_DE / _IT / _UK.'
  );
  process.exit(1);
}
for (const line of readFileSync(shopifyEnvPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  // Only overlay keys that aren't already set in process.env (.env.local wins).
  if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
}

const dryRun = process.argv.includes('--dry-run');

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ENCRYPTION_KEY,
  SHOPIFY_ACCESS_TOKEN_DE,
  SHOPIFY_ACCESS_TOKEN_IT,
  SHOPIFY_ACCESS_TOKEN_UK,
} = process.env;

if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error('ENCRYPTION_KEY must be a 64-char hex string');
  process.exit(1);
}
for (const [k, v] of Object.entries({
  SHOPIFY_ACCESS_TOKEN_DE,
  SHOPIFY_ACCESS_TOKEN_IT,
  SHOPIFY_ACCESS_TOKEN_UK,
})) {
  if (!v) {
    console.error(`Missing ${k} in ${shopifyEnvPath}`);
    process.exit(1);
  }
}

// ---- encryption (mirrors src/lib/encryption.ts) ----
function encrypt(plaintext) {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

const sb = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ============================================================
// New market plan
// ============================================================
//
// Access tokens are pulled from the workfolder shopify.env via the env loader
// above. The encrypted blob lives in store_credentials.credentials.access_token;
// the plaintext never lands in any DB column or this source file.
//
// Note: Shopify shop currency at time of seed (verified via /admin/api/shop.json):
//   DE → EUR, IT → EUR, UK → GBP. The exchange_rate_to_eur column on
//   store_uk.orders will be populated automatically by the ingest path using
//   public.exchange_rates (see migration 022). Run backfill-exchange-rates.mjs
//   once after seed to make sure GBP rates are in the cache before the first
//   UK order lands.
const NEW_MARKETS = [
  {
    market_code: 'de',
    name: 'Cvetita DE',
    domain: 'cvetita-herbal-de.myshopify.com',
    access_token: SHOPIFY_ACCESS_TOKEN_DE,
    currency: 'EUR',
  },
  {
    market_code: 'it',
    name: 'Cvetita IT',
    domain: 'cvetita-herbal-it.myshopify.com',
    access_token: SHOPIFY_ACCESS_TOKEN_IT,
    currency: 'EUR',
  },
  {
    market_code: 'uk',
    name: 'Cvetita UK',
    domain: 'cvetita-herbal-uk.myshopify.com',
    access_token: SHOPIFY_ACCESS_TOKEN_UK,
    currency: 'GBP',
  },
];

// ============================================================
// Resolve cvetita organization
// ============================================================

async function getOrganizationId() {
  const { data, error } = await sb
    .from('organizations')
    .select('id, slug')
    .eq('slug', 'cvetita')
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(`No organization with slug='cvetita': ${error?.message}`);
  }
  return data.id;
}

// ============================================================
// Provision per-store schema
// ============================================================

async function provisionSchema(schemaName) {
  if (dryRun) {
    console.log(`  [dry-run] SELECT create_store_schema('${schemaName}')`);
    return;
  }
  const { error } = await sb.rpc('create_store_schema', { p_schema: schemaName });
  if (error) {
    throw new Error(`create_store_schema('${schemaName}') failed: ${error.message}`);
  }
  console.log(`  ✓ schema ${schemaName} provisioned`);
}

// ============================================================
// Upsert store row
// ============================================================

async function upsertStore(organizationId, market) {
  const row = {
    organization_id: organizationId,
    name: market.name,
    market_code: market.market_code,
    platform: 'shopify',
    domain: market.domain,
    is_active: true,
    settings: {},
  };

  if (dryRun) {
    console.log(`  [dry-run] upsert store: ${JSON.stringify(row)}`);
    return { id: '00000000-0000-0000-0000-000000000000', __dry: true };
  }

  // No unique constraint on (organization_id, market_code), so emulate upsert:
  // look up first, insert if missing, else update.
  const { data: existing } = await sb
    .from('stores')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('market_code', market.market_code)
    .maybeSingle();

  if (existing) {
    const { error: updErr } = await sb
      .from('stores')
      .update({
        name: market.name,
        platform: 'shopify',
        domain: market.domain,
        is_active: true,
      })
      .eq('id', existing.id);
    if (updErr) throw new Error(`Update store ${market.market_code} failed: ${updErr.message}`);
    console.log(`  ✓ store ${market.market_code} updated (${existing.id})`);
    return { id: existing.id };
  }

  const { data: inserted, error: insErr } = await sb
    .from('stores')
    .insert(row)
    .select('id')
    .single();
  if (insErr) throw new Error(`Insert store ${market.market_code} failed: ${insErr.message}`);
  console.log(`  ✓ store ${market.market_code} inserted (${inserted.id})`);
  return { id: inserted.id };
}

// ============================================================
// Upsert Shopify credentials
// ============================================================

async function upsertShopifyCreds(storeId, market) {
  const credentials = {
    store_domain: market.domain,
    access_token: encrypt(market.access_token),
    client_secret: null, // matches BG/GR/RO; can be added later when needed
    api_version: '2024-10',
    encrypted_at: new Date().toISOString(),
  };

  if (dryRun) {
    console.log(`  [dry-run] upsert store_credentials for store ${storeId} (shopify)`);
    return;
  }

  // (store_id, service) is UNIQUE.
  const { error } = await sb
    .from('store_credentials')
    .upsert(
      {
        store_id: storeId,
        service: 'shopify',
        credentials,
        status: 'active',
      },
      { onConflict: 'store_id,service' }
    );
  if (error) {
    throw new Error(`Upsert credentials for ${market.market_code} failed: ${error.message}`);
  }
  console.log(`  ✓ shopify credentials saved (encrypted)`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(`Seeding DE / IT / UK stores${dryRun ? ' (DRY RUN)' : ''}\n`);

  const organizationId = await getOrganizationId();
  console.log(`Organization: ${organizationId}\n`);

  for (const m of NEW_MARKETS) {
    const schema = `store_${m.market_code}`;
    console.log(`[${m.market_code.toUpperCase()}] ${m.name}`);
    await provisionSchema(schema);
    const { id: storeId } = await upsertStore(organizationId, m);
    await upsertShopifyCreds(storeId, m);
    console.log('');
  }

  console.log('Done.\n');
  console.log('Next steps:');
  console.log('  1. node scripts/seed-integration-accounts.mjs   # Meta accounts + bindings');
  console.log('  2. node scripts/backfill-exchange-rates.mjs     # ensures GBP rate is cached');
  console.log('  3. Trigger /api/cron/refresh-aggregates manually to see 6/6 results');
}

main().catch((err) => {
  console.error('\nSeed failed:');
  console.error(err);
  process.exit(1);
});
