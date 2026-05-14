/**
 * Seed Cvetita SK (full) + Cvetita HU (placeholder) stores + Meta bindings.
 *
 * Modelled on seed-stores-de-it-uk.mjs. Idempotent. --dry-run prints proposed
 * changes without writing.
 *
 * What it does:
 *   1. SELECT create_store_schema('store_sk' | 'store_hu')
 *   2. UPSERT public.stores (SK + HU, both is_active=true, platform='shopify')
 *   3. UPSERT public.store_credentials — SK ONLY (HU has no Shopify token yet)
 *   4. UPSERT public.integration_accounts — Meta SK + Meta HU
 *   5. UPSERT public.store_integration_bindings — SK primary, HU primary
 *
 * Plaintext SK Shopify token is hard-coded here (from the Slack screenshot)
 * because it's a one-off seed and the workfolder shopify.env doesn't yet
 * carry SK. After this script runs, the token lives encrypted in
 * store_credentials.credentials.access_token; rotate by re-running.
 *
 * Usage:
 *   node scripts/seed-store-sk.mjs --dry-run
 *   node scripts/seed-store-sk.mjs
 */

import { readFileSync, existsSync } from 'fs';
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

// ---- Shopify tokens — read from the workfolder shopify.env (gitignored).
// Same convention as seed-stores-de-it-uk.mjs. Override path with
// SHOPIFY_ENV_PATH if needed.
const DEFAULT_SHOPIFY_ENV = 'D:/Cvetitaherbal/analytics/website-translations/config/shopify.env';
const shopifyEnvPath = process.env.SHOPIFY_ENV_PATH || DEFAULT_SHOPIFY_ENV;
if (!existsSync(shopifyEnvPath)) {
  console.error(
    `Shopify env file not found at: ${shopifyEnvPath}\n` +
      'Set SHOPIFY_ENV_PATH or add SHOPIFY_ACCESS_TOKEN_SK to .env.local.'
  );
  process.exit(1);
}
for (const line of readFileSync(shopifyEnvPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
}

const dryRun = process.argv.includes('--dry-run');

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ENCRYPTION_KEY,
  META_ACCESS_TOKEN,
  SHOPIFY_ACCESS_TOKEN_SK,
} = process.env;

if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error('ENCRYPTION_KEY must be a 64-char hex string');
  process.exit(1);
}
if (!META_ACCESS_TOKEN) {
  console.error('META_ACCESS_TOKEN not set');
  process.exit(1);
}
if (!SHOPIFY_ACCESS_TOKEN_SK) {
  console.error(`Missing SHOPIFY_ACCESS_TOKEN_SK in ${shopifyEnvPath}`);
  process.exit(1);
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
// Market plan
// ============================================================
//
// SK is "full" — Shopify store is live (162 products, 0 orders so far) and
// the Meta ad account act_786040973159408 is owned by Cvetita Herbal BM.
// HU is "placeholder" — Meta ad account act_1208503709890038 exists and is
// likely already accruing spend, but the .hu Shopify store hasn't been
// connected to the platform yet (no token in hand). We provision an empty
// store_hu schema so SQL queries against it return 0 instead of erroring,
// and bind the Meta account as primary so Meta spend lands per-store.
const MARKETS = [
  {
    market_code: 'sk',
    name: 'Cvetita SK',
    domain: 'cvetita-herbal-sk.myshopify.com',
    shopify_access_token: SHOPIFY_ACCESS_TOKEN_SK,
    currency: 'EUR',
    meta_external_id: 'act_786040973159408',
    meta_display: 'Meta — Cvetita SK',
  },
  {
    market_code: 'hu',
    name: 'Cvetita HU',
    domain: 'cvetita-herbal-hu.myshopify.com', // placeholder — domain may change when shop launches
    shopify_access_token: null, // no token yet
    currency: 'EUR',
    meta_external_id: 'act_1208503709890038',
    meta_display: 'Meta — Cvetita HU',
  },
];

// ============================================================
// Resolve org id
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
// Provision per-store schema (orders/products/daily_aggregates + EUR cols)
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
    settings: market.shopify_access_token ? {} : { meta_only: true },
  };

  if (dryRun) {
    console.log(`  [dry-run] upsert store: ${JSON.stringify(row)}`);
    return { id: '00000000-0000-0000-0000-000000000000', __dry: true };
  }

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
// Upsert Shopify credentials (SK only — HU skipped)
// ============================================================
async function upsertShopifyCreds(storeId, market) {
  if (!market.shopify_access_token) {
    console.log(`  ✓ shopify creds skipped (${market.market_code} placeholder, no token yet)`);
    return;
  }

  const credentials = {
    store_domain: market.domain,
    access_token: encrypt(market.shopify_access_token),
    client_secret: null,
    api_version: '2024-10',
    encrypted_at: new Date().toISOString(),
  };

  if (dryRun) {
    console.log(`  [dry-run] upsert store_credentials for store ${storeId} (shopify)`);
    return;
  }

  const { error } = await sb
    .from('store_credentials')
    .upsert(
      { store_id: storeId, service: 'shopify', credentials, status: 'active' },
      { onConflict: 'store_id,service' }
    );
  if (error) {
    throw new Error(`Upsert credentials for ${market.market_code} failed: ${error.message}`);
  }
  console.log(`  ✓ shopify credentials saved (encrypted)`);
}

// ============================================================
// Fetch one Meta ad account's metadata (for currency, tz, business)
// ============================================================
async function fetchMetaAccount(externalId) {
  const url = new URL(`https://graph.facebook.com/v21.0/${externalId}`);
  url.searchParams.set('fields', 'id,account_id,name,account_status,currency,business_name,business,timezone_name');
  url.searchParams.set('access_token', META_ACCESS_TOKEN);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta API ${externalId} failed: ${res.status} ${body}`);
  }
  return res.json();
}

// ============================================================
// Upsert integration_accounts (Meta) + store_integration_bindings
// ============================================================
async function upsertMetaIntegrationAndBinding(organizationId, storeId, market) {
  const acct = await fetchMetaAccount(market.meta_external_id);

  const row = {
    organization_id: organizationId,
    service: 'meta_ads',
    external_id: market.meta_external_id,
    display_name: market.meta_display,
    currency: acct.currency || null,
    timezone: acct.timezone_name || null,
    credentials: {
      access_token: encrypt(META_ACCESS_TOKEN),
      encrypted_at: new Date().toISOString(),
    },
    status: 'active',
    metadata: {
      account_id_int: acct.account_id,
      business_id: acct.business?.id || null,
      business_name: acct.business_name || acct.business?.name || null,
      raw_name: acct.name,
      account_status: acct.account_status,
    },
  };

  if (dryRun) {
    console.log(`  [dry-run] upsert integration_account ${market.meta_external_id} (${market.meta_display})`);
    console.log(`  [dry-run] upsert binding store=${market.market_code} role=primary`);
    return;
  }

  const { data: iaRow, error: iaErr } = await sb
    .from('integration_accounts')
    .upsert(row, { onConflict: 'organization_id,service,external_id' })
    .select('id')
    .single();
  if (iaErr) {
    throw new Error(`Upsert integration_account ${market.meta_external_id} failed: ${iaErr.message}`);
  }
  console.log(`  ✓ integration_account ${market.meta_external_id} → ${iaRow.id}`);

  // Idempotent binding via delete-then-insert on (account, role) — matches
  // seed-integration-accounts.mjs pattern because the unique constraint is
  // a partial index that the upsert builder can't target directly.
  await sb
    .from('store_integration_bindings')
    .delete()
    .eq('integration_account_id', iaRow.id)
    .eq('role', 'primary');

  const { error: bindErr } = await sb.from('store_integration_bindings').insert({
    store_id: storeId,
    integration_account_id: iaRow.id,
    role: 'primary',
    weight: 1.0,
  });
  if (bindErr) {
    throw new Error(`Insert binding for ${market.market_code} failed: ${bindErr.message}`);
  }
  console.log(`  ✓ binding store=${market.market_code} role=primary`);
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log(`Seeding SK + HU stores${dryRun ? ' (DRY RUN)' : ''}\n`);

  const organizationId = await getOrganizationId();
  console.log(`Organization: ${organizationId}\n`);

  for (const m of MARKETS) {
    const schema = `store_${m.market_code}`;
    console.log(`[${m.market_code.toUpperCase()}] ${m.name}`);
    await provisionSchema(schema);
    const { id: storeId } = await upsertStore(organizationId, m);
    await upsertShopifyCreds(storeId, m);
    await upsertMetaIntegrationAndBinding(organizationId, storeId, m);
    console.log('');
  }

  console.log('Done.\n');
  if (!dryRun) {
    console.log('Next steps:');
    console.log('  1. node scripts/backfill-products.mjs --market sk');
    console.log('  2. node scripts/register-shopify-webhooks.mjs --base-url https://<your-prod-url>');
    console.log('  3. Trigger /api/cron/meta-sync (or wait for the next 15-min cycle)');
  }
}

main().catch((err) => {
  console.error('\nSeed failed:');
  console.error(err);
  process.exit(1);
});
