const fs = require('fs');
const path = require('path');

// Read .env.local
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Helper for REST API calls with Accept-Profile header
async function restQuery(schema, table, params = '', preferCount = true) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const headers = {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (schema) headers['Accept-Profile'] = schema;
  if (preferCount) headers['Prefer'] = 'count=exact';
  const res = await fetch(url, { headers });
  const contentRange = res.headers.get('content-range');
  const count = contentRange ? contentRange.split('/')[1] : null;
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, count, ok: res.ok };
}

async function main() {
  console.log('='.repeat(70));
  console.log('  SUPABASE QA AUDIT');
  console.log('  Project: ' + SUPABASE_URL);
  console.log('  Date: ' + new Date().toISOString());
  console.log('='.repeat(70));

  // ── 0. Connectivity check ──
  console.log('\n' + '─'.repeat(70));
  console.log('  0. CONNECTIVITY CHECK');
  console.log('─'.repeat(70));

  // Auth health
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
    headers: { 'apikey': SERVICE_ROLE_KEY }
  });
  const authData = await authRes.json();
  console.log(`  GoTrue (Auth):  ${authRes.status} ${authRes.ok ? 'OK' : 'FAIL'} - ${authData.name || 'unknown'} ${authData.version || ''}`);

  // REST/PostgREST check
  const restRes = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    }
  });
  let restData;
  try { restData = await restRes.json(); } catch { restData = {}; }
  console.log(`  PostgREST:      ${restRes.status} ${restRes.ok ? 'OK' : 'FAIL'}${restData.code ? ' - ' + restData.code + ': ' + restData.message : ''}`);

  // Storage health
  const storageRes = await fetch(`${SUPABASE_URL}/storage/v1/health`, {
    headers: { 'apikey': SERVICE_ROLE_KEY }
  });
  console.log(`  Storage:        ${storageRes.status} ${storageRes.ok ? 'OK' : 'FAIL'}`);

  // Realtime
  const realtimeRes = await fetch(`${SUPABASE_URL}/realtime/v1/api/tenants`, {
    headers: { 'apikey': SERVICE_ROLE_KEY }
  });
  console.log(`  Realtime:       ${realtimeRes.status} (${realtimeRes.ok ? 'OK' : 'responded'})`);

  const dbAlive = restRes.ok;

  if (!dbAlive) {
    console.log('\n  *** DATABASE IS UNREACHABLE ***');
    console.log('  PostgREST error PGRST002 = cannot connect to the Postgres database.');
    console.log('  Most likely cause: the Supabase project is PAUSED (free-tier auto-pause).');
    console.log('  Action required: Go to https://supabase.com/dashboard/project/qggrlwfphxyoslrqkajw');
    console.log('  and click "Restore project" to unpause it.');
    console.log('\n  Proceeding with checks anyway to document behavior...\n');
  }

  // ── 1. Stores ──
  console.log('─'.repeat(70));
  console.log('  1. PUBLIC.STORES');
  console.log('─'.repeat(70));

  const storesResult = await restQuery(null, 'stores', 'select=id,name,market_code,is_active,domain,created_at');
  if (storesResult.ok) {
    const stores = storesResult.data;
    console.log(`  Found ${stores.length} store(s):\n`);
    stores.forEach(s => {
      console.log(`  [${s.id}] ${s.name}`);
      console.log(`    market_code: ${s.market_code}`);
      console.log(`    is_active:   ${s.is_active}`);
      console.log(`    domain:      ${s.domain}`);
      console.log(`    created_at:  ${s.created_at}\n`);
    });

    // ── 2. Store credentials ──
    console.log('─'.repeat(70));
    console.log('  2. STORE CREDENTIALS (no secrets shown)');
    console.log('─'.repeat(70));

    for (const store of stores) {
      const credsResult = await restQuery(null, 'store_credentials',
        `select=id,store_id,service,status,connected_at&store_id=eq.${store.id}`);
      console.log(`\n  Store: ${store.name} (${store.id})`);
      if (credsResult.ok) {
        if (credsResult.data.length === 0) {
          console.log('    No credentials found');
        } else {
          credsResult.data.forEach(c => {
            console.log(`    [${c.service}] status=${c.status}, connected_at=${c.connected_at}`);
          });
        }
      } else {
        console.log(`    ERROR: ${JSON.stringify(credsResult.data)}`);
      }
    }
  } else {
    console.log(`  ERROR (${storesResult.status}): ${storesResult.data?.code} - ${storesResult.data?.message}`);
  }

  // ── 3. Per-schema data counts ──
  console.log('\n' + '─'.repeat(70));
  console.log('  3. PER-SCHEMA DATA (store_bg, store_gr, store_ro)');
  console.log('─'.repeat(70));

  const storeSchemas = ['store_bg', 'store_gr', 'store_ro'];

  for (const schema of storeSchemas) {
    console.log(`\n  Schema: ${schema}`);
    console.log('  ' + '-'.repeat(40));

    // Products count
    const products = await restQuery(schema, 'products', 'select=id&limit=0');
    if (products.ok) {
      console.log(`    Products count: ${products.count}`);
    } else {
      console.log(`    Products: ${products.status} - ${products.data?.code || 'error'}`);
    }

    // Orders count
    const orders = await restQuery(schema, 'orders', 'select=id&limit=0');
    if (orders.ok) {
      console.log(`    Orders count: ${orders.count}`);
    } else {
      console.log(`    Orders: ${orders.status} - ${orders.data?.code || 'error'}`);
    }

    // Daily aggregates count + latest 3
    const aggCount = await restQuery(schema, 'daily_aggregates', 'select=id&limit=0');
    if (aggCount.ok) {
      console.log(`    Daily aggregates count: ${aggCount.count}`);
      const aggLatest = await restQuery(schema, 'daily_aggregates',
        'select=order_date,total_revenue,total_orders&order=order_date.desc&limit=3', false);
      if (aggLatest.ok && aggLatest.data.length > 0) {
        console.log('    Latest 3 daily_aggregates:');
        aggLatest.data.forEach(row => {
          console.log(`      ${row.order_date}  revenue=${row.total_revenue}  orders=${row.total_orders}`);
        });
      } else {
        console.log('    No daily_aggregates rows');
      }
    } else {
      console.log(`    Daily aggregates: ${aggCount.status} - ${aggCount.data?.code || 'error'}`);
    }
  }

  // ── 4. PostgREST schema accessibility ──
  console.log('\n' + '─'.repeat(70));
  console.log('  4. POSTGREST SCHEMA ACCESSIBILITY');
  console.log('─'.repeat(70));

  const allSchemas = ['store_bg', 'store_gr', 'store_ro', 'store_hu', 'store_hr', 'store_rs'];

  for (const schema of allSchemas) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Accept-Profile': schema
      }
    });
    let detail = '';
    if (!res.ok) {
      try {
        const body = await res.json();
        detail = body.code || body.message || res.statusText;
      } catch { detail = res.statusText; }
    }
    const icon = res.ok ? 'ACCESSIBLE' : 'BLOCKED';
    console.log(`  ${schema.padEnd(12)} -> ${res.status} ${icon}${detail ? ' (' + detail + ')' : ''}`);
  }

  // ── 5. Organizations ──
  console.log('\n' + '─'.repeat(70));
  console.log('  5. ORGANIZATIONS');
  console.log('─'.repeat(70));

  const orgsResult = await restQuery(null, 'organizations', 'select=id,name,slug');
  if (orgsResult.ok) {
    if (orgsResult.data.length === 0) {
      console.log('  No organizations found');
    } else {
      orgsResult.data.forEach(o => {
        console.log(`  [${o.id}] ${o.name} (slug: ${o.slug})`);
      });
    }
  } else {
    console.log(`  ERROR (${orgsResult.status}): ${orgsResult.data?.code} - ${orgsResult.data?.message}`);
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(70));
  if (!dbAlive) {
    console.log('  AUDIT RESULT: DATABASE UNREACHABLE (PAUSED)');
    console.log('  All data queries failed with PGRST002.');
    console.log('  Auth service is healthy. PostgREST proxy is up but DB is down.');
    console.log('');
    console.log('  REQUIRED ACTION:');
    console.log('  1. Open https://supabase.com/dashboard/project/qggrlwfphxyoslrqkajw');
    console.log('  2. Click "Restore project" to unpause');
    console.log('  3. Re-run this audit after the DB comes back online');
  } else {
    console.log('  AUDIT COMPLETE - Database is online');
  }
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
