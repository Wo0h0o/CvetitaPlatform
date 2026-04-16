/**
 * Register Shopify webhooks for all active stores.
 *
 * Run once:
 *   node scripts/register-shopify-webhooks.mjs
 *
 * Idempotent: skips topics that already have a matching webhook registered.
 *
 * Prerequisites:
 *   - .env.local with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY
 *   - Each store must have a `shopify` credential in store_credentials
 *   - VERCEL_URL or --base-url flag for the webhook callback address
 *
 * Usage:
 *   node scripts/register-shopify-webhooks.mjs
 *   node scripts/register-shopify-webhooks.mjs --base-url https://my-app.vercel.app
 *   node scripts/register-shopify-webhooks.mjs --dry-run
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

// ---- Config ----
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const API_VERSION = '2024-10';

const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'refunds/create',
  'products/create',
  'products/update',
];

// ---- Parse CLI args ----
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
let baseUrl = '';
const baseUrlIdx = args.indexOf('--base-url');
if (baseUrlIdx !== -1 && args[baseUrlIdx + 1]) {
  baseUrl = args[baseUrlIdx + 1].replace(/\/$/, '');
}

if (!SUPABASE_URL || !SUPABASE_KEY || !ENCRYPTION_KEY) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or ENCRYPTION_KEY in .env.local');
  process.exit(1);
}

// ---- Encryption (mirrors src/lib/encryption.ts) ----
function decrypt(encrypted) {
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ---- Main ----
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // 1. Get all active stores + their Shopify credentials
  const { data: stores, error: storesErr } = await supabase
    .from('stores')
    .select('id, name, market_code, domain')
    .eq('is_active', true)
    .order('market_code');

  if (storesErr) {
    console.error('Failed to fetch stores:', storesErr.message);
    process.exit(1);
  }

  console.log(`Found ${stores.length} active stores\n`);

  // Determine base URL for webhook callbacks
  if (!baseUrl) {
    // Try Vercel production URL
    const vercelUrl = process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL;
    if (vercelUrl) {
      baseUrl = vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
    }
  }

  if (!baseUrl) {
    console.error('No base URL found. Pass --base-url <url> or set VERCEL_URL in .env.local');
    process.exit(1);
  }
  baseUrl = baseUrl.replace(/\/$/, '');
  console.log(`Webhook base URL: ${baseUrl}\n`);

  for (const store of stores) {
    console.log(`\n--- ${store.name} (${store.market_code}) ---`);

    // Get Shopify credentials
    const { data: creds, error: credsErr } = await supabase
      .from('store_credentials')
      .select('credentials')
      .eq('store_id', store.id)
      .eq('service', 'shopify')
      .single();

    if (credsErr || !creds) {
      console.log(`  SKIP: no Shopify credentials found`);
      continue;
    }

    const storeDomain = creds.credentials.store_domain;
    const apiVersion = creds.credentials.api_version || API_VERSION;
    let accessToken;
    try {
      accessToken = decrypt(creds.credentials.access_token);
    } catch (e) {
      console.log(`  SKIP: failed to decrypt access_token: ${e.message}`);
      continue;
    }

    // Get existing webhooks
    const existingRes = await fetch(
      `https://${storeDomain}/admin/api/${apiVersion}/webhooks.json`,
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );

    if (!existingRes.ok) {
      console.log(`  ERROR: Shopify API ${existingRes.status} when listing webhooks`);
      continue;
    }

    const { webhooks: existing } = await existingRes.json();
    const existingTopics = new Set(existing.map(w => w.topic));
    console.log(`  Existing webhooks: ${existing.length} (${[...existingTopics].join(', ') || 'none'})`);

    const callbackUrl = `${baseUrl}/api/webhooks/shopify/${store.id}`;

    for (const topic of WEBHOOK_TOPICS) {
      if (existingTopics.has(topic)) {
        console.log(`  [SKIP] ${topic} — already registered`);
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY-RUN] Would register ${topic} → ${callbackUrl}`);
        continue;
      }

      const regRes = await fetch(
        `https://${storeDomain}/admin/api/${apiVersion}/webhooks.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webhook: {
              topic,
              address: callbackUrl,
              format: 'json',
            },
          }),
        }
      );

      if (regRes.ok) {
        const { webhook } = await regRes.json();
        console.log(`  [OK] ${topic} → id=${webhook.id}`);
      } else {
        const err = await regRes.text();
        console.log(`  [FAIL] ${topic} — ${regRes.status}: ${err}`);
      }

      // Small delay to avoid Shopify rate limit
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
