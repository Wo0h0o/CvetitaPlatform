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

async function postSql(query) {
  return fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SBP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );
}

const res = await postSql(sql);
const body = await res.text();
if (!res.ok) {
  console.error(`Failed (${res.status}):\n${body}`);
  process.exit(1);
}
console.log('[apply] OK');
console.log(body);

// Auto-register in the migration tracking table (introduced by
// migration 041). Parses `041_bootstrap_migration_tracking.sql` →
// version='041', name='bootstrap_migration_tracking'. Failures here
// are non-fatal — if the registry table doesn't exist yet (e.g. when
// migration 041 itself is being applied for the first time), the
// INSERT errors and we keep going. The 041 file already back-fills
// its own row, so the registry will catch up on next apply either way.
const basename = file.split(/[\\/]/).pop() ?? '';
const m = basename.match(/^(\d{3})_(.+?)\.sql$/);
if (m) {
  const [, version, name] = m;
  const regSql = `
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('${version}', '${name.replace(/'/g, "''")}')
    ON CONFLICT (version) DO NOTHING;
  `;
  const regRes = await postSql(regSql);
  if (regRes.ok) {
    console.log(`[register] ${version}_${name} → schema_migrations`);
  } else {
    const errBody = await regRes.text();
    // Registry table may not exist yet — treat as a soft warning.
    console.warn(`[register] skipped (${regRes.status}): ${errBody.slice(0, 120)}`);
  }
} else {
  console.warn(`[register] skipped: filename "${basename}" does not match NNN_name.sql`);
}
