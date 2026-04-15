# 02 — Data Architecture for Multi-Store, Multi-Ad-Account Reads

Scope: Shopify (3 stores today, more soon), Meta Ads (6 accounts, some orphaned from any Shopify store), GA4 and Klaviyo (single-account today, multi-account plausible). Platform: Next.js 15 App Router on Vercel Pro (60s serverless cap), Supabase Postgres, SWR on the client.

---

## 1. Data model proposal

Current `store_credentials(store_id, service, credentials)` is a 1:1 binding — a store has at most one credential per service. That breaks the moment a single Shopify store (BG) maps to two Meta ad accounts (old + new), or a Meta ad account (ProteinBar) has no Shopify store at all. The fix is to split the notion of a **data source** from the notion of a **store**.

Proposed foundation tables (additive, non-breaking):

```sql
-- Every external account we can read from, independent of store.
CREATE TABLE integration_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service         TEXT NOT NULL,               -- 'meta_ads' | 'google_ads' | 'ga4' | 'klaviyo' | 'shopify'
  external_id     TEXT NOT NULL,               -- e.g. act_123456789, G-XXXXXX, shop.myshopify.com
  display_name    TEXT NOT NULL,               -- "Meta — BG (new)", "ProteinBar"
  currency        TEXT,
  timezone        TEXT,
  credentials     JSONB NOT NULL DEFAULT '{}', -- encrypted, token + scope info
  status          TEXT NOT NULL DEFAULT 'active',
  token_expires_at TIMESTAMPTZ,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, service, external_id)
);

-- Many-to-many between business "stores" and integration accounts.
CREATE TABLE store_integration_bindings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id               UUID REFERENCES stores(id) ON DELETE CASCADE, -- nullable: orphan ad account
  integration_account_id UUID NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  role                   TEXT NOT NULL,        -- 'primary' | 'secondary' | 'legacy'
  weight                 NUMERIC DEFAULT 1.0,  -- for blended reporting (e.g. 80/20 split)
  active_from            DATE,
  active_until           DATE,                 -- lets old BG account decay gracefully
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, integration_account_id, role)
);
```

Why `store_id` is nullable: ProteinBar is a Meta ad account with no Shopify counterpart — it still has an org, still has reports, but doesn't join to an e-com store. Querying "all BG ads" becomes `bindings JOIN accounts WHERE store_id = $1 AND (active_until IS NULL OR active_until >= today)`. Querying "all ad accounts in org" doesn't care about stores.

`store_credentials` keeps its role for Shopify only (it's a 1:1 platform credential). New integrations (Meta, GA4, Klaviyo) live in `integration_accounts` and bind through `store_integration_bindings`. This is additive and the Shopify pipeline is untouched.

**Normalized ads data** goes into a shared schema, not per-store. A `store_` schema per Shopify tenant remains correct for orders/products (large row volumes, write-heavy from webhooks, clean isolation). But ads rows are modest (campaigns × days × 6 accounts = tens of thousands/year) and **must be blended cross-account**, which fights schema-per-tenant. Put it in `public`:

```sql
CREATE TABLE meta_insights_daily (
  integration_account_id UUID NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  date                   DATE NOT NULL,
  level                  TEXT NOT NULL,        -- 'account' | 'campaign' | 'adset' | 'ad'
  object_id              TEXT NOT NULL,        -- campaign_id / adset_id / ad_id / account-level sentinel
  spend                  NUMERIC(14,4) NOT NULL,
  impressions            BIGINT NOT NULL,
  clicks                 BIGINT NOT NULL,
  purchases              NUMERIC(14,4) NOT NULL DEFAULT 0,
  revenue                NUMERIC(14,4) NOT NULL DEFAULT 0,
  actions                JSONB NOT NULL DEFAULT '{}',  -- typed actions (add_to_cart, ic, etc.)
  currency               TEXT NOT NULL,
  fetched_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_account_id, date, level, object_id)
);
CREATE INDEX idx_meta_insights_account_date ON meta_insights_daily (integration_account_id, date DESC);
CREATE INDEX idx_meta_insights_date ON meta_insights_daily (date DESC);
```

A view `meta_insights_by_store` joins through `store_integration_bindings` and SUMs rows across legacy+new accounts per store-day. Currency conversion lives in a separate table (`fx_rates_daily`) and is applied in the view, not at write-time, so historical rates stay correct.

Dimensions (`meta_campaigns`, `meta_adsets`, `meta_ads`) are stored once per `integration_account_id` with a `last_seen_at` and `status` — creative assets, budgets, names. That's what turns `insights_daily` from raw rows into a queryable UI.

---

## 2. Fetch & cache strategy

Three read patterns, three strategies. Next.js 15.5 tag-based `revalidateTag` is the lever.

| View | Source | TTL | Cache tags |
|---|---|---|---|
| Per-store live ("BG last 7d") | Supabase `meta_insights_daily` + live patch for today | 5 min | `meta:acct:{id}`, `meta:store:{id}` |
| Cross-store aggregate ("Org today") | Supabase view `meta_insights_by_store` | 15 min | `meta:org:{orgId}`, `meta:date:{YYYY-MM-DD}` |
| Cross-store comparison (BG vs GR vs RO) | Same view, pivoted in SQL | 15 min | `meta:org:{orgId}:compare` |
| Campaign/ad drill-down | Supabase + live call for last 24h only | 2 min for today, 1h historic | `meta:acct:{id}:campaigns` |
| Creative assets (images, videos) | Supabase `meta_ads` + Vercel Blob mirror for URLs | 24 h | `meta:creative:{adId}` |

Live API hits only for **today's intraday data** (delta since last cron) and creative previews that miss the mirror. Everything ≥ 1 day old comes from Postgres, which survives the 60s Vercel cap and lets dashboards render in <500ms.

On the client, SWR stays as-is with `revalidateOnFocus: false`. The server side uses `unstable_cache` with the tags above; credential writes, sync completions, and manual "refresh" buttons call `revalidateTag()`. This gives us the Triple Whale / Polar pattern: "stale-by-default, fresh on demand."

Per-store in-memory LRU (the 5-min, 20-entry decrypted-config cache) stays, but keys move to `{org}:{integration_account_id}` so one org can hold multiple Meta configs simultaneously.

---

## 3. Meta Graph specifics

Six ad accounts, one app token (for now). The single biggest lever is the **batch endpoint**: `POST https://graph.facebook.com/v21.0/` with a `batch` array of up to 50 relative-URL sub-requests, executed in one HTTP call, billed as one rate-limit hit per sub-request but one TCP round-trip. We already do this for creative hydration; we should use it for all insights fan-outs too.

Strategy per account:

- **Nightly cron (`/api/cron/meta-sync`)** fans out 6 accounts in parallel with `Promise.allSettled` (partial failure is OK, per-account `last_sync_error` recorded). Per account, we issue one batch call with sub-requests for account-level, campaign-level, adset-level for the last 3 days (to catch late-attributed conversions). Upsert into `meta_insights_daily`.
- **Long windows (90d+ backfill, ad-level)** go through the **async insights report API**: `POST /{ad_account}/insights` returns a `report_run_id`, we poll `/{report_run_id}` for `async_status = 'Job Completed'`, then stream results via `/insights?report_run_id=…&limit=500`. This sidesteps the 60s Vercel cap — the kickoff is sync, the poll is a separate cron tick. Store `report_run_id` + state in a small `meta_async_jobs` table.
- **Rate limits** on Meta are three-tier: **BUC (Business Use Case)** per ad account, **app-level**, and **user-level**. `X-Business-Use-Case-Usage` header returns `call_count`, `total_cputime`, `total_time` — all percentages of the hour budget. Wrap every call in a helper that parses this header, sleeps if any dimension > 75%, and records the peak per account. The gotcha (see below) is that CPU time, not call count, is usually what trips the limit.
- **Backoff** on `error.code === 17` (rate limit reached), `error.code === 613` (calls per hour reached), or HTTP 429: exponential with jitter, max 3 retries, then mark the account `status='rate_limited'` and serve stale from Postgres. Graceful degradation (principle #8) means a rate-limited account shows its last-good snapshot with a freshness badge, not an error page.
- **Fan-out concurrency**: cap at 4 parallel accounts (not 6) when doing heavy per-ad queries, because creative thumbnails hit a different quota pool that's easy to exhaust.

---

## 4. Freshness model (proposed SLAs)

| View | Freshness SLA | Rationale |
|---|---|---|
| Today's spend + ROAS | 5 min | Enough for budget decisions; live API only when user clicks "refresh" |
| Yesterday's final numbers | 1 h | Meta's own late-attribution window is ~28 days; next-day numbers stabilise by mid-morning |
| ≥ 2 days old | 24 h (overnight cron) | No longer changing meaningfully; Postgres-only |
| Creative thumbnails | 24 h | Change rarely; refetch on ad-id cache miss |
| Cross-store aggregate | 15 min | Blends already-cached per-store data, no extra API cost |

Every card renders a small freshness dot: green (<5m), yellow (<1h), grey (cached from cron). This is how Triple Whale, Motion, and Polar present it — users trust the number more when they can see how fresh it is.

---

## 5. Migration path (no downtime)

1. **Add tables** (`integration_accounts`, `store_integration_bindings`, `meta_insights_daily`, `meta_async_jobs`, `fx_rates_daily`) with migrations 008-011. Additive only.
2. **Seed**: insert one row into `integration_accounts` for the current `META_AD_ACCOUNT_ID`, bind it to the BG store. Dual-write: new code path reads from Postgres for historicals; old env-var path still works for today's data.
3. **Refactor `src/lib/meta.ts`**: replace the module-level `getAccountId()`/`getToken()` with `getMetaClient(integrationAccountId)`. The new signature makes "which account?" a required parameter at every call site — the TS compiler will find them all. Old callers pass the seeded binding's id.
4. **Cron**: ship `/api/cron/meta-sync` that iterates `SELECT * FROM integration_accounts WHERE service = 'meta_ads' AND status = 'active'`. Single account day 1 (identical behavior), flip to all 6 once the UI is ready.
5. **UI**: add account picker in the top bar (Org → Store → Ad account). Default to the primary binding; "All" aggregates through the view.
6. **Delete env vars** last, after two weeks of dual-run confirms parity.

---

## 6. Risks

- **Rate limits** are per-(app, user, account) and non-obvious — the async jobs path is the escape valve but adds state. Budget for one full week of tuning after go-live.
- **Token scoping**: if the user grants the app access to only 4 of 6 accounts, silent 200-with-empty-data is common. Pre-flight `/me/adaccounts` and surface missing accounts in the UI.
- **Currency**: BG in BGN, GR in EUR, RO in RON. Never store converted values — store native + daily FX, convert in the view. Retrospective FX corrections otherwise rewrite history.
- **Storage**: at 6 accounts × ~50 campaigns × 365 days × 3 levels = ~330k rows/yr — trivial. Ad-level (5k ads × 365) is ~2M/yr — still fine, but partition by month if we go back 3+ years.
- **Complexity**: the many-to-many is the right model but easy to mis-query. Wrap with a `viewForStore(storeId, range)` helper so no feature code writes the JOIN by hand.
- **Schema-per-tenant vs shared**: we keep schema-per-tenant for **orders/products** (isolation, webhook volume, large joins stay local) and use **shared normalized tables** for **ads/GA4/Klaviyo** (cross-tenant blending is the whole point). The hybrid is the elegant answer; neither extreme alone fits.
