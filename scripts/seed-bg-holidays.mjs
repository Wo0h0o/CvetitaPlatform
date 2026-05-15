/**
 * One-off seed of BG national holidays into hr_holidays for every existing
 * organization. Idempotent — uses ON CONFLICT (organization_id, holiday_date).
 *
 * Usage:
 *   node scripts/seed-bg-holidays.mjs                       # current + next year
 *   node scripts/seed-bg-holidays.mjs --years 2025,2026,2027 # custom set
 *
 * Reads SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF from .env.local and
 * pushes through the Mgmt API SQL endpoint (no PostgREST schema cache to
 * worry about).
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
  console.error('Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF');
  process.exit(1);
}

// ---- holiday computation (port of src/lib/bg-holidays.ts) ----
function pad(n) { return String(n).padStart(2, '0'); }
function toIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function orthodoxEaster(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(year, month - 1, day);
  julian.setDate(julian.getDate() + 13);
  return julian;
}
function bulgarianHolidays(year) {
  const fixed = [
    { date: `${year}-01-01`, label: 'Нова година', isCompensation: false },
    { date: `${year}-03-03`, label: 'Ден на Освобождението на България', isCompensation: false },
    { date: `${year}-05-01`, label: 'Ден на труда', isCompensation: false },
    { date: `${year}-05-06`, label: 'Гергьовден, Ден на храбростта и Българската армия', isCompensation: false },
    { date: `${year}-05-24`, label: 'Ден на българската просвета и култура и на славянската писменост', isCompensation: false },
    { date: `${year}-09-06`, label: 'Ден на Съединението', isCompensation: false },
    { date: `${year}-09-22`, label: 'Ден на Независимостта на България', isCompensation: false },
    { date: `${year}-12-24`, label: 'Бъдни вечер', isCompensation: false },
    { date: `${year}-12-25`, label: 'Рождество Христово', isCompensation: false },
    { date: `${year}-12-26`, label: 'Втори ден на Коледа', isCompensation: false },
  ];
  const easter = orthodoxEaster(year);
  const dayMs = 86400000;
  const ts = easter.getTime();
  fixed.push(
    { date: toIso(new Date(ts - 2 * dayMs)), label: 'Велики петък', isCompensation: false },
    { date: toIso(new Date(ts - 1 * dayMs)), label: 'Велика събота', isCompensation: false },
    { date: toIso(easter), label: 'Великден', isCompensation: false },
    { date: toIso(new Date(ts + 1 * dayMs)), label: 'Втори ден на Великден', isCompensation: false },
  );
  fixed.sort((a, b) => a.date.localeCompare(b.date));

  const taken = new Set(fixed.map((h) => h.date));
  const comps = [];
  for (const h of fixed) {
    const d = new Date(h.date + 'T00:00:00');
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) continue;
    if (h.label === 'Велика събота' || h.label === 'Великден') continue;
    const cur = new Date(d);
    for (let i = 0; i < 14; i++) {
      cur.setDate(cur.getDate() + 1);
      const wd = cur.getDay();
      if (wd === 0 || wd === 6) continue;
      const iso = toIso(cur);
      if (taken.has(iso)) continue;
      comps.push({
        date: iso,
        label: `Почивен ден за ${h.label.split(',')[0]}`,
        isCompensation: true,
      });
      taken.add(iso);
      break;
    }
  }
  // Merge duplicates (e.g. 2027: 1 May = Ден на труда + Велика събота).
  const byDate = new Map();
  for (const h of [...fixed, ...comps]) {
    const existing = byDate.get(h.date);
    if (existing) {
      existing.label = `${existing.label} / ${h.label}`;
      existing.isCompensation = existing.isCompensation && h.isCompensation;
    } else {
      byDate.set(h.date, { ...h });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ---- args ----
const args = process.argv.slice(2);
let years;
const yi = args.indexOf('--years');
if (yi !== -1) {
  years = args[yi + 1].split(',').map((y) => Number(y.trim()));
} else {
  const now = new Date().getFullYear();
  years = [now, now + 1];
}

// ---- run ----
async function runSql(query) {
  const res = await fetch(
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
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${body}`);
  return body ? JSON.parse(body) : [];
}

function esc(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

const orgs = await runSql("SELECT id, name FROM organizations ORDER BY created_at");
console.log(`Found ${orgs.length} organization(s):`);
for (const o of orgs) console.log(`  - ${o.id}  ${o.name}`);

for (const year of years) {
  const holidays = bulgarianHolidays(year);
  console.log(`\nYear ${year}: ${holidays.length} holidays`);
  for (const h of holidays) {
    console.log(`  ${h.date}  ${h.label}${h.isCompensation ? '  (компенсация)' : ''}`);
  }

  const values = orgs
    .flatMap((org) =>
      holidays.map(
        (h) =>
          `(${esc(org.id)}, ${esc(h.date)}, ${esc(h.label)}, TRUE, ${h.isCompensation ? 'TRUE' : 'FALSE'})`
      )
    )
    .join(',\n  ');

  // Upsert; do NOT overwrite is_official=false rows (custom company days).
  const sql = `
    INSERT INTO public.hr_holidays
      (organization_id, holiday_date, label, is_official, is_compensation)
    VALUES
      ${values}
    ON CONFLICT (organization_id, holiday_date) DO UPDATE
      SET label = EXCLUDED.label,
          is_compensation = EXCLUDED.is_compensation
      WHERE hr_holidays.is_official = TRUE
    RETURNING organization_id, holiday_date, label
  `;
  const inserted = await runSql(sql);
  console.log(`  → wrote ${inserted.length} rows for ${year}`);
}

console.log('\nDone.');
