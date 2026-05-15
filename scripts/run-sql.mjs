/**
 * One-off SQL query runner against the remote Supabase project via Mgmt API.
 *
 * Usage:
 *   node scripts/run-sql.mjs "SELECT * FROM hr_profiles LIMIT 1"
 *   node scripts/run-sql.mjs --file path/to/query.sql
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

const args = process.argv.slice(2);
let sql;
if (args[0] === '--file') {
  sql = readFileSync(resolve(args[1]), 'utf8');
} else {
  sql = args.join(' ');
}
if (!sql) {
  console.error('Usage: node scripts/run-sql.mjs "<sql>"  OR  --file <path>');
  process.exit(1);
}

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
console.log(body);
