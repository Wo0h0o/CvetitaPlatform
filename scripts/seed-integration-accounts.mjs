/**
 * Seed integration_accounts + store_integration_bindings from Meta Graph /me/adaccounts.
 *
 * Run once after migrations 008-010 are applied:
 *   node scripts/seed-integration-accounts.mjs
 *
 * Idempotent: re-running updates the encrypted token copy and account metadata
 * without duplicating rows (ON CONFLICT on the unique constraint).
 *
 * Binding policy (locked in docs/ads-architecture-research/07-arbiter-final.md):
 *   act_280706744248197 → Cvetita BG, role=primary    (current prod account)
 *   act_334527788845228 → Cvetita BG, role=legacy     (historical continuity)
 *   act_3479233942353523 → Cvetita GR, role=primary
 *   act_323746506828541  → Cvetita RO, role=primary
 *   act_612864896675154  → orphan (ProteinBar — no Shopify store), role=primary
 *   act_2178567759636273 → disabled (personal USD, not a business account)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ---- Load .env.local ----
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

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ENCRYPTION_KEY,
  META_ACCESS_TOKEN,
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

// ---- Encryption (matches src/lib/encryption.ts) ----
function encrypt(plaintext) {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

// ---- Supabase admin client ----
const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- Binding policy ----
// Business reality: revenue from BG primary, BG legacy, AND ProteinBar all
// funnels into the Bulgarian Shopify store. Only GR and RO have their own
// Shopify storefronts. So ProteinBar binds to Cvetita BG as 'secondary'
// (a parallel active sub-brand), not as an orphan.
const BINDING_POLICY = {
  act_280706744248197:  { marketCode: 'bg',    role: 'primary',   display: 'Meta — Cvetita BG (primary)' },
  act_334527788845228:  { marketCode: 'bg',    role: 'legacy',    display: 'Meta — Cvetita BG (legacy)' },
  act_612864896675154:  { marketCode: 'bg',    role: 'secondary', display: 'Meta — ProteinBar (BG sub-brand)' },
  act_3479233942353523: { marketCode: 'gr',    role: 'primary',   display: 'Meta — Cvetita GR' },
  act_323746506828541:  { marketCode: 'ro',    role: 'primary',   display: 'Meta — Cvetita RO' },
  act_2178567759636273: { disabled: true,                         display: 'Meta — Personal (USD, disabled)' },
};

// ============================================================
// Step 1: fetch ad accounts from Meta
// ============================================================

async function fetchMetaAccounts() {
  const url = new URL('https://graph.facebook.com/v21.0/me/adaccounts');
  url.searchParams.set(
    'fields',
    'id,account_id,name,account_status,currency,business_name,business,timezone_name'
  );
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', META_ACCESS_TOKEN);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta API /me/adaccounts failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.data || [];
}

// ============================================================
// Step 2: resolve org + store ids
// ============================================================

async function getOrgAndStores() {
  const { data: orgs, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', 'cvetita')
    .limit(1);

  if (orgErr || !orgs?.length) {
    throw new Error(`No organization found with slug='cvetita': ${orgErr?.message}`);
  }
  const organizationId = orgs[0].id;

  const { data: stores, error: storeErr } = await supabase
    .from('stores')
    .select('id, name, market_code')
    .eq('organization_id', organizationId);

  if (storeErr) throw new Error(`Failed to load stores: ${storeErr.message}`);

  const storesByMarket = new Map(stores.map((s) => [s.market_code, s]));
  return { organizationId, storesByMarket };
}

// ============================================================
// Step 3: upsert integration_accounts
// ============================================================

async function upsertIntegrationAccount(organizationId, metaAccount, policy) {
  const externalId = metaAccount.id; // 'act_...'
  const credentials = {
    access_token: encrypt(META_ACCESS_TOKEN),
    encrypted_at: new Date().toISOString(),
  };

  const row = {
    organization_id: organizationId,
    service: 'meta_ads',
    external_id: externalId,
    display_name: policy.display,
    currency: metaAccount.currency || null,
    timezone: metaAccount.timezone_name || null,
    credentials,
    status: policy.disabled ? 'disabled' : 'active',
    metadata: {
      account_id_int: metaAccount.account_id,
      business_id: metaAccount.business?.id || null,
      business_name: metaAccount.business_name || metaAccount.business?.name || null,
      raw_name: metaAccount.name,
      account_status: metaAccount.account_status,
    },
  };

  const { data, error } = await supabase
    .from('integration_accounts')
    .upsert(row, { onConflict: 'organization_id,service,external_id' })
    .select('id, external_id')
    .single();

  if (error) {
    throw new Error(`Upsert integration_account ${externalId} failed: ${error.message}`);
  }
  return data.id;
}

// ============================================================
// Step 4: upsert store_integration_bindings
// ============================================================

async function upsertBinding({ storeId, integrationAccountId, role }) {
  // Can't do a simple upsert because our unique constraints are partial indexes
  // on different column sets. Delete-then-insert per (integrationAccountId, role)
  // is idempotent and simple.
  await supabase
    .from('store_integration_bindings')
    .delete()
    .eq('integration_account_id', integrationAccountId)
    .eq('role', role);

  const { error } = await supabase.from('store_integration_bindings').insert({
    store_id: storeId, // may be null for orphan bindings
    integration_account_id: integrationAccountId,
    role,
    weight: 1.0,
  });

  if (error) {
    throw new Error(`Insert binding failed: ${error.message}`);
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('Seeding integration_accounts + store_integration_bindings...\n');

  const metaAccounts = await fetchMetaAccounts();
  console.log(`Found ${metaAccounts.length} ad accounts via /me/adaccounts.\n`);

  const { organizationId, storesByMarket } = await getOrgAndStores();
  console.log(`Organization: ${organizationId}`);
  console.log(`Stores: ${[...storesByMarket.keys()].join(', ')}\n`);

  let seededAccounts = 0;
  let seededBindings = 0;
  const unknown = [];

  for (const metaAcct of metaAccounts) {
    const policy = BINDING_POLICY[metaAcct.id];
    if (!policy) {
      unknown.push(metaAcct.id);
      continue;
    }

    const integrationAccountId = await upsertIntegrationAccount(
      organizationId,
      metaAcct,
      policy
    );
    seededAccounts++;
    console.log(`  ✓ account   ${metaAcct.id} → ${integrationAccountId}  [${policy.display}]`);

    if (policy.disabled) {
      console.log(`    (disabled — no binding)`);
      continue;
    }

    let storeId = null;
    if (policy.marketCode) {
      const store = storesByMarket.get(policy.marketCode);
      if (!store) {
        console.warn(`    ! no store found for market '${policy.marketCode}' — skipping binding`);
        continue;
      }
      storeId = store.id;
    }

    await upsertBinding({
      storeId,
      integrationAccountId,
      role: policy.role,
    });
    seededBindings++;
    const storeLabel = storeId ? `store=${policy.marketCode}` : 'orphan';
    console.log(`  ✓ binding   ${storeLabel} role=${policy.role}`);
  }

  console.log(`\nDone. Seeded ${seededAccounts} accounts, ${seededBindings} bindings.`);
  if (unknown.length > 0) {
    console.log(`\nUnknown accounts not in BINDING_POLICY (add to the script):`);
    for (const id of unknown) console.log(`  - ${id}`);
  }
}

main().catch((err) => {
  console.error('\nSeed failed:');
  console.error(err);
  process.exit(1);
});
