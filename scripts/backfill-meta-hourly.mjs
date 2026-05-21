/**
 * Backfill account-level hourly Meta insights for the last N days, across
 * all active meta_ads integration accounts. Mirrors the logic in
 * /api/cron/meta-sync-hourly but runs as a standalone Node script so we
 * can seed the table before the cron's first natural tick (and not wait
 * 28 days for the typical-baseline window to fill in).
 *
 * Default 30 days — matches the cron's retention horizon and covers all
 * 4 priors that the home dashboard's "Днес"/"Вчера" typical baseline
 * averages (oldest = 28 days back).
 *
 * Usage:
 *   node scripts/backfill-meta-hourly.mjs                 # last 30 days
 *   node scripts/backfill-meta-hourly.mjs --days 7        # last 7 days
 *   node scripts/backfill-meta-hourly.mjs --dry-run       # no DB writes
 *
 * Safe to re-run — upsert on (integration_account_id, date, hour, level, object_id).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ---- env loader (same pattern as other backfill scripts) ----
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
const daysArg = args.indexOf('--days');
// Cap matches RETENTION_DAYS in /api/cron/meta-sync-hourly — writing rows
// older than retention is wasteful because the next cron tick deletes them.
const days = daysArg >= 0 ? Math.min(30, Math.max(1, parseInt(args[daysArg + 1], 10) || 30)) : 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ---- AES-256-GCM decrypt — same algorithm as src/lib/encryption.ts ----
function decrypt(encrypted) {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('ENCRYPTION_KEY missing/invalid');
  const key = Buffer.from(hex, 'hex');
  const [ivB64, tagB64, ctB64] = encrypted.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// ---- date helpers (Sofia-anchored, same as src/lib/sofia-date.ts) ----
function sofiaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function shiftDate(iso, daysBack) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function parseMetaHour(s) {
  if (!s) return null;
  const m = /^(\d{1,2}):/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  return h >= 0 && h <= 23 ? h : null;
}

function actionVal(actions, type) {
  if (!actions || !Array.isArray(actions)) return 0;
  const a = actions.find(x => x.action_type === type);
  return a ? parseFloat(a.value || '0') : 0;
}

const API_VERSION = 'v21.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

async function fetchHourlyForAccount(accountExternalId, token, since, until) {
  // time_increment=1 is REQUIRED — see src/lib/meta.ts fetchHourlyInsights
  // for the full explanation. Without it Meta collapses all days into
  // a single 24-row aggregate.
  const params = new URLSearchParams({
    fields: 'spend,impressions,clicks,actions,action_values',
    level: 'account',
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
    limit: '500',
    access_token: token,
  });
  let url = `${BASE}/${accountExternalId}/insights?${params}`;
  const rows = [];
  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    rows.push(...(json.data || []));
    url = json.paging?.next || null;
  }
  return rows;
}

async function main() {
  const untilStr = sofiaToday();
  const sinceStr = shiftDate(untilStr, days - 1);

  console.log(`[backfill-meta-hourly] window: ${sinceStr} → ${untilStr} (${days} days)`);
  if (dryRun) console.log('[backfill-meta-hourly] DRY RUN — no DB writes');

  const { data: accounts, error: accErr } = await supabase
    .from('integration_accounts')
    .select('id, external_id, display_name, currency, credentials, status')
    .eq('service', 'meta_ads')
    .eq('status', 'active');

  if (accErr) {
    console.error('Failed to load accounts:', accErr.message);
    process.exit(1);
  }
  if (!accounts || accounts.length === 0) {
    console.log('No active meta_ads accounts.');
    return;
  }

  let totalUpserted = 0;
  for (const acc of accounts) {
    process.stdout.write(`  ${acc.display_name} (${acc.external_id}) ... `);
    try {
      const encrypted = acc.credentials?.access_token;
      if (!encrypted) {
        console.log('skipped (no access_token in credentials)');
        continue;
      }
      const token = decrypt(encrypted);
      const rows = await fetchHourlyForAccount(acc.external_id, token, sinceStr, untilStr);
      const upsertRows = [];
      for (const r of rows) {
        const hour = parseMetaHour(r.hourly_stats_aggregated_by_advertiser_time_zone);
        if (hour === null) continue;
        upsertRows.push({
          integration_account_id: acc.id,
          date: r.date_start,
          hour,
          level: 'account',
          object_id: acc.external_id,
          spend: parseFloat(r.spend || '0'),
          impressions: parseInt(r.impressions || '0', 10),
          clicks: parseInt(r.clicks || '0', 10),
          link_clicks: actionVal(r.actions, 'link_click'),
          purchases: actionVal(r.actions, 'omni_purchase'),
          revenue: actionVal(r.action_values, 'omni_purchase'),
          currency: acc.currency || 'EUR',
          fetched_at: new Date().toISOString(),
        });
      }

      if (!dryRun && upsertRows.length > 0) {
        const { error: upErr } = await supabase
          .from('meta_insights_hourly')
          .upsert(upsertRows, {
            onConflict: 'integration_account_id,date,hour,level,object_id',
          });
        if (upErr) throw new Error(`Upsert failed: ${upErr.message}`);
      }
      totalUpserted += upsertRows.length;
      console.log(`${upsertRows.length} rows`);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }

  console.log(`[backfill-meta-hourly] done — ${totalUpserted} rows ${dryRun ? '(dry-run, not written)' : 'upserted'}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
