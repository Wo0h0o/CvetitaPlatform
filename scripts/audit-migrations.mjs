/**
 * Audit drift between supabase/migrations/*.sql (filesystem) and the
 * `supabase_migrations.schema_migrations` registry (DB).
 *
 * Usage: node scripts/audit-migrations.mjs
 *
 * Exits non-zero when any drift exists, so this can be wired into CI
 * (e.g. a GitHub Actions step that runs before `vercel deploy`) to
 * catch the class of incident this script was born from — migration
 * 038 living in the repo for two days without ever reaching the prod
 * DB, with zero automated signal.
 *
 * Two drift modes:
 *   1. On disk, not in DB  → "PENDING — apply this".
 *   2. In DB, not on disk  → "ORPHAN — file was deleted but the DB
 *      still thinks it ran". Manual review required (file may have
 *      been renamed; squashed; or registry contains a typo).
 */

import { readdirSync, readFileSync } from 'fs';
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

// ----- Filesystem inventory -----
const migrationsDir = resolve(import.meta.dirname, '..', 'supabase', 'migrations');
const onDisk = new Map(); // version → name
for (const f of readdirSync(migrationsDir)) {
  const m = f.match(/^(\d{3})_(.+?)\.sql$/);
  if (m) onDisk.set(m[1], m[2]);
}

// ----- DB registry inventory -----
const res = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SBP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version',
    }),
  }
);

if (!res.ok) {
  console.error(`Registry query failed (${res.status}):\n${await res.text()}`);
  console.error('Is migration 041 (bootstrap_migration_tracking) applied?');
  process.exit(2);
}

const rows = JSON.parse(await res.text());
const inDb = new Map(rows.map((r) => [r.version, r.name]));

// ----- Diff -----
const pending = [];
const orphan = [];
const mismatchedNames = [];

for (const [version, name] of onDisk) {
  if (!inDb.has(version)) {
    pending.push(`${version}_${name}`);
  } else if (inDb.get(version) !== name) {
    mismatchedNames.push(`${version}: disk=${name} db=${inDb.get(version)}`);
  }
}
for (const [version, name] of inDb) {
  if (!onDisk.has(version)) {
    orphan.push(`${version}_${name}`);
  }
}

// ----- Report -----
console.log(`[audit] ${onDisk.size} on disk, ${inDb.size} in registry`);

if (pending.length === 0 && orphan.length === 0 && mismatchedNames.length === 0) {
  console.log('[audit] ✓ clean — disk and registry agree');
  process.exit(0);
}

if (pending.length > 0) {
  console.error(`\n[audit] PENDING (on disk, not applied — ${pending.length}):`);
  for (const p of pending) console.error(`  - ${p}`);
  console.error('  → apply via: node scripts/apply-migration.mjs supabase/migrations/<file>');
}
if (orphan.length > 0) {
  console.error(`\n[audit] ORPHAN (in DB, file missing — ${orphan.length}):`);
  for (const o of orphan) console.error(`  - ${o}`);
  console.error('  → file was renamed/deleted, or registry contains stale row');
}
if (mismatchedNames.length > 0) {
  console.error(`\n[audit] NAME MISMATCH (${mismatchedNames.length}):`);
  for (const m of mismatchedNames) console.error(`  - ${m}`);
}

process.exit(1);
