# 08 — Week 3 Handoff: Owner Home + `/ads/[market]`

_Concrete, file-level task list for a fresh session picking up Week 3. Assumes you've read `07-arbiter-final.md` (locked design + post-ruling corrections) and the memory entries it points to._

---

## Goal

Ship the `/` Owner Home page (top strip + 3-store small multiples + action-row stub) and per-market Meta drill-down routes (`/ads/bg`, `/ads/gr`, `/ads/ro`) — all reading from the materialized `meta_insights_daily` layer, all in Bulgarian, all mobile-first.

## What's already live (do not rebuild)

- **Tables** `integration_accounts`, `store_integration_bindings`, `meta_insights_daily` + view `meta_insights_by_store`
- **Seed** — 6 Meta accounts registered, 5 active (see final topology below)
- **`src/lib/meta.ts`** — `getMetaClient(integrationAccountId?)` + every function takes optional id, env-fallback
- **`/api/cron/meta-sync`** — daily 03:00 UTC, 5 accounts × 2 levels (account + campaign), ~100 rows/day, ~4s run
- **`src/lib/meta-rate-limit.ts`** — BUC header parser (`parseBucHeader`, `decide`, `sleepForThrottle`)
- **`src/components/shared/FreshnessDot.tsx`** — Bulgarian, ready to slot into cards
- **env** — `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `CRON_SECRET` all in `.env.local`

## Final binding topology (verified in prod 2026-04-15)

| Store | Binding | Ad Account | Role |
|---|---|---|---|
| Cvetita BG | primary | `act_280706744248197` | primary |
| Cvetita BG | secondary | `act_612864896675154` (ProteinBar) | secondary |
| Cvetita BG | legacy | `act_334527788845228` | legacy |
| Cvetita GR | primary | `act_3479233942353523` | primary |
| Cvetita RO | primary | `act_323746506828541` | primary |
| — | — | `act_2178567759636273` (USD personal) | disabled |

The `meta_insights_by_store` view automatically SUMs across all active bindings per store — for BG that means the sparkline and ROAS numbers already blend all three active accounts. No special handling needed in Week 3 code.

---

## Task list (in build order)

### 1. Utility: market → integration_account resolver

**File:** `src/lib/store-market-resolver.ts` (new)

```ts
// Resolves a market_code (e.g. 'bg') to:
//   - store_id
//   - list of active integration_account_ids (all roles)
//   - primary integration_account_id (for single-account callers)
export async function resolveMarket(marketCode: string): Promise<{
  storeId: string;
  primaryIntegrationAccountId: string;
  allIntegrationAccountIds: string[];  // primary + secondary + legacy
  bindings: { id: string; role: string; display_name: string }[];
}>
```

Caches results in-memory for ~60s. Used by both the home-page API routes and the `/ads/[market]` drill-downs.

### 2. Home page API routes

All under `src/app/api/dashboard/home/`. Each returns JSON, uses `requireAuth`, caches `s-maxage=60, stale-while-revalidate=30`.

#### 2a. `GET /api/dashboard/home/top-strip/route.ts`

Queries `meta_insights_by_store` for:
- Today's running totals (spend, revenue, purchases) across all 3 stores unioned
- Previous 4 same-weekdays' full-day totals → average = "typical [weekday]"
- Delta: today's running so far ÷ matched-hour portion of typical = tempo %
- Projected day total: running ÷ (hours elapsed / 24)

Response:
```jsonc
{
  "revenue": { "value": 4120, "vsTypical": 12, "projected": 11800 },
  "spend":   { "value": 1280, "vsTypical": 3,  "projected": 3700 },
  "roas":    { "value": 3.22 },
  "orders":  { "value": 142,  "vsTypical": 18, "projected": 410 },
  "anomalyCount": 2,
  "freshAsOf": "2026-04-15T11:47:00+03:00"
}
```

**Timezone gotcha:** use `(now() AT TIME ZONE 'Europe/Sofia')::date` for "today" — Postgres `CURRENT_DATE` returns UTC.

#### 2b. `GET /api/dashboard/home/stores/route.ts`

Per-store response with:
- 14-day sparkline (array of daily revenue)
- Last-24h rolling ROAS
- 14-day median ROAS
- Border level: `red | amber | green` based on today's/median ratio (red <70%, amber 70-90%, green ≥90% per arbiter ruling §8)
- Latest `last_synced_at` from bound integration_accounts

```jsonc
{
  "stores": [
    {
      "marketCode": "bg",
      "name": "Cvetita BG",
      "flag": "🇧🇬",
      "sparkline14d": [1244, 1390, ...],       // Shopify-blendable via bindings
      "roasLast24h": 3.40,
      "roasMedian14d": 3.12,
      "borderLevel": "green",
      "lastSyncedAt": "2026-04-15T07:51:40Z"
    },
    ...
  ]
}
```

NOTE: v1 sparkline uses Meta-reported revenue from `meta_insights_by_store` for consistency with the ROAS ratio. If Petar prefers Shopify-actual revenue (honest business signal) in W4/W5, swap to querying per-store Shopify `daily_aggregates` table. Decision deferred.

#### 2c. `GET /api/dashboard/home/action-cards/route.ts`

W3: return 2-4 **hardcoded stubs** with sample Bulgarian copy to validate the layout + read path. W4 replaces the body with a query against the new `agent_briefs` table. Response shape:

```jsonc
{
  "cards": [
    {
      "id": "stub-1",
      "severity": "red",              // red | amber | green
      "title": "Пауза на `BG - TOF - Video 3`",
      "why": "CPA €18.40, +140% за 7 дни",
      "target": { "type": "ad", "id": "...", "name": "..." },
      "actions": ["pause", "dismiss"]   // mapped to Bulgarian labels client-side
    }
  ]
}
```

### 3. Home page UI

**File:** `src/app/(dashboard)/page.tsx` (replace current homepage)

Layout (laptop):
```
<KpiStrip />              ← today's tempo, 4 tiles + anomaly pill
<StoreMultiples />        ← 3 cards side-by-side (vertical stack on mobile)
<ActionRow />             ← 2-4 stub cards (carousel on mobile)
```

#### Components to create in `src/components/dashboard/`:

- `KpiStrip.tsx` — 4 tiles (Приходи / Разход / ROAS / Поръчки), pulsing red anomaly tile
- `StoreMultiples.tsx` — grid wrapper that maps over stores
- `StoreCard.tsx` — single card (14-day sparkline via recharts, sparkline color derived from borderLevel, flag + name, "€X приходи (Shopify)", "ROAS X (Meta)", "Виж реклами →" link top-right, `<FreshnessDot/>` bottom-right)
- `ActionCard.tsx` — single action card with severity-colored left border, title, why-line, action buttons
- `ActionRow.tsx` — carousel on mobile, grid on desktop

All Bulgarian strings. Mobile-first (375px). Use existing shared primitives (`Card`, `Button`, `Badge` from `src/components/shared/`).

**Tap targets on StoreCard:**
- Whole card (excluding corner link) → `router.push('/sales/store/' + storeId)`
- "Виж реклами →" link → `router.push('/ads/' + marketCode)` — stopPropagation so it doesn't trigger card tap

### 4. TopBar store switcher

**File:** `src/components/layout/TopBarStoreSwitcher.tsx` (new)

- Detects current route (`/ads/[market]`, `/sales/store/[storeId]`) and highlights current store
- Dropdown: BG / GR / RO, each row shows colored dot + name + today's ROAS badge
- On click → replace just the market segment in the URL (`/ads/bg` → `/ads/gr`)
- Hide on the home page `/` — the cards ARE the switcher there
- Mobile: collapse to flag + dot + chevron, tap opens bottom sheet

Wire into `src/components/layout/TopBar.tsx` conditionally.

### 5. `/ads/[market]` drill-down

**File:** `src/app/(dashboard)/ads/[market]/page.tsx` (new)

Same layout/components as current `/ads/page.tsx`, but:
- Reads `market` from route params → `resolveMarket(market)` → gets `primaryIntegrationAccountId`
- All SWR keys include `market`: `['/api/dashboard/ads', market, preset]`
- API routes `/api/dashboard/ads/*` accept `?market=bg` query param → thread it as `integrationAccountId` to the Meta lib functions
- **On `/ads/bg` only**: add a sub-brand filter dropdown — `Всички | Cvetita | ProteinBar | Архив (legacy)` — filters the campaigns table client-side by matching against integration_account_id

**Redirect old URL:** `/ads` (no market) → `redirect('/ads/bg')` (the historical default). Keeps any existing bookmarks working.

### 6. 15-minute intraday sync cron

Add to `vercel.json`:
```jsonc
{ "path": "/api/cron/meta-sync?window=today", "schedule": "*/15 * * * *" }
```

Modify `src/app/api/cron/meta-sync/route.ts`:
- Accept `?window=today` query param
- When set, override `SYNC_DAYS_BACK` to 1 (fetch only today)
- Reduces call count 3× per tick; fits comfortably in the 15-min cadence

This gives the top strip and border colors a ≤15-min freshness guarantee without hammering Meta's rate limits.

### 7. Wire FreshnessDot

- On each `StoreCard`: `<FreshnessDot lastSyncedAt={store.lastSyncedAt} />` bottom-right corner
- On the home page top-right (outside any card): `<FreshnessDot lastSyncedAt={topStrip.freshAsOf} showLabel />` — shows "Данни преди X мин"

---

## Test criteria (Week 3 done when all pass)

- [ ] `GET /` renders home with 3 store cards + top strip + action-row stubs, all Bulgarian
- [ ] Network tab: no `graph.facebook.com` calls on home load (everything from Postgres)
- [ ] Top strip shows today's running numbers, delta label `▲+X% vs typичен [ден]`, projected day total
- [ ] Each store card's sparkline renders from `meta_insights_by_store`
- [ ] Tap card → `/sales/store/[id]` (existing, unchanged)
- [ ] Tap "Виж реклами →" → `/ads/[market]`, no card-tap propagation
- [ ] `/ads/bg` shows blended data from 3 accounts; sub-brand filter works
- [ ] `/ads/gr` and `/ads/ro` each show single-account data
- [ ] Old `/ads` URL → redirects to `/ads/bg`
- [ ] TopBar switcher appears on `/ads/*`, not on `/`, and hops stores without full reload
- [ ] 15-min cron writes today-only rows (check `meta_insights_daily` `fetched_at` timestamps)
- [ ] FreshnessDot shows correct Bulgarian age ("току-що", "преди 12 мин", "преди 1 ден", "преди 5 дни")
- [ ] Mobile 375px: cards stack vertically, switcher collapses, action row becomes swipeable
- [ ] All user-visible text Bulgarian; code/logs stay English
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` — no new warnings on touched files

---

## Gotchas to avoid

1. **Timezone in SQL.** `CURRENT_DATE` and `now()` default to UTC. For "today" in Sofia, use `(now() AT TIME ZONE 'Europe/Sofia')::date`. Meta's insights rows store `date` in the account's configured timezone (Europe/Sofia for all our accounts — check `integration_accounts.timezone`).

2. **Bulgarian pluralisation.** "преди 1 ден" (singular), "преди 5 дни" (plural 2+). See `FreshnessDot.tsx` `formatAgeBg` for the pattern.

3. **Em-dash in SQL via curl.** Mojibake risk when POSTing UTF-8 through `-d` inline. If you need to update strings that contain `—`, use the Node one-liner pattern in `reference_supabase_cli.md` (JSON.stringify handles encoding correctly).

4. **BG drill-down blends 3 accounts.** Don't hand-write SQL joins — always go through `meta_insights_by_store` which already does the summing. Inside `/ads/bg` UI the sub-brand filter is client-side (filter the response rows by their `integration_account_id`).

5. **Card tap vs link tap.** Card tap goes to Sales; "Виж реклами →" link goes to Ads. Use `e.stopPropagation()` on the link's onClick handler.

6. **Freshness dot source.** For a store card, use the **most recent** `last_synced_at` across all its bindings (not the min). Petar wants to see "is any of this data fresh?" not "is all of it fresh?"

7. **SWR keys must include market.** Otherwise BG data and GR data collide in the cache.

8. **"Viewing ads" copy is Bulgarian.** "Виж реклами" — not "View ads."

---

## References (in load order for a fresh session)

1. **Memory (auto-loaded):** `MEMORY.md` indexes to:
   - `project_platform_vision.md` — overall platform product context
   - `feedback_platform_ux.md` — 8 dev principles
   - `project_platform_multistore_v1.md` — locked W1-W6 decisions for this workstream
   - `feedback_platform_bulgarian_ui.md` — language rule
   - `reference_supabase_cli.md` — DDL via Management API
2. **In-repo:** `CLAUDE.md` (dev guide), `AGENTS.md` (Next.js warnings)
3. **Research trail:** `docs/ads-architecture-research/01-ux-store-switching.md` through `07-arbiter-final.md` — the full reasoning
4. **Existing code patterns to match:**
   - `src/app/(dashboard)/sales/store/[storeId]/page.tsx` — per-market dynamic route pattern
   - `src/app/api/sales/store/[storeId]/kpis/route.ts` — per-market API pattern
   - `src/components/sales/StoreKpiGrid.tsx` — grid component with SWR
   - `src/components/shared/Card.tsx`, `Badge.tsx` — Bulgarian-compatible primitives

## Rough sequence (solo-dev)

- **Day 1:** `store-market-resolver.ts` + 3 home API routes (with stubs for action-cards)
- **Day 2:** Home page UI (KpiStrip, StoreMultiples, StoreCard, ActionRow, ActionCard)
- **Day 3:** `/ads/[market]` route + sub-brand filter + TopBar switcher
- **Day 4:** 15-min cron + FreshnessDot wiring + mobile polish
- **Day 5:** End-to-end test pass, typecheck/lint cleanup, commit

Then Week 4 (agent_briefs nightly job) plugs into the action-row stub with zero UI rework.
