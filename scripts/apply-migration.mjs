/**
 * Apply a single .sql migration file to the remote Cvetita Supabase project
 * via the Management API (independent of PostgREST schema cache).
 *
 * Usage:
 *   node scripts/apply-migration.mjs supabase/migrations/030_hr_module.sql
 *
 * Notes:
 *   - Splits on `;` is dangerous for plpgsql bodies; we therefore send the
 *     entire file as ONE statement. Postgres handles multi-statement bodies
 *     fine via the Mgmt API.
 *   - `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction as
 *     references to the new value. Our migrations follow that rule.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(import.meta.dirname, '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
}

const SBP_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
if (!SBP_TOKEN || !PROJECT_REF) {
  console.error('Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env.local');
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-migration.mjs <path-to-sql-file>');
  process.exit(1);
}

const sql = readFileSync(resolve(file), 'utf8');
console.log(`[apply] ${file} → project ${PROJECT_REF} (${sql.length} bytes)`);

const res = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SBP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  }
);

const body = await res.text();
if (!res.ok) {
  console.error(`Failed (${res.status}):\n${body}`);
  process.exit(1);
}
console.log('[apply] OK');
console.log(body);
