# W3 Audit Findings — Action Plan

**Date:** 2026-04-15
**Source:** Multi-agent audit (5 primary specialists × 5 peer reviewers = 10 reports) following W3 Day 1-4 ship.
**Scope:** `D:/Cvetitaherbal/platform/cvetita-platform/cvetita-command-center/`
**Status as of write:** Day 1-3 deployed (commits `9c8a25b` → `96fcbaa`); Day 4 (`0fdf283`) committed locally, NOT pushed.

---

## How to use this document

1. Read the **Pre-flight checks** below to verify the environment.
2. Resolve **Section 1: Decisions** — they gate scope/sequence of everything else.
3. Work through **Section 2-5** in order. Each finding has: `Where`, `What's wrong`, `Fix direction`, `Verification`, `Dependencies`.
4. Use the **Recommended attack order** at the bottom as a checklist.

---

## Pre-flight checks (run first in any new session)

```bash
cd D:/Cvetitaherbal/platform/cvetita-platform/cvetita-command-center

# 1. Confirm working tree state
git status --short
git log --oneline -8

# 2. Confirm typecheck + lint pass before ANY edits
npm run typecheck
npm run lint 2>&1 | tail -20

# 3. Confirm dev server reachable (user usually has it on :3000)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/

# 4. Live DB query helper — used by several verification steps
source <(grep -E "^(SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF)=" .env.local | sed 's/^/export /')
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT 1 AS ok"}'
```

**Expected baseline:** typecheck 0 errors, lint clean on touched files (3 pre-existing warnings in `ads/adsets/page.tsx`, `ads/page.tsx`, `agents/ad-creator/page.tsx` are unrelated and untouched).

**If working tree is NOT at `0fdf283`:** something diverged. Stop and reconcile before proceeding.

---

## Section 1: Decisions needed BEFORE coding (4 items)

These decisions change the scope or invalidate fixes elsewhere. Resolve all 4 before starting Tier 1.

### Decision 1.1 — BG StoreCard: blend ProteinBar + Cvetita + legacy, or Cvetita-only?

- **Status today:** BG view (`meta_insights_by_store`) sums all 3 active bindings into one row per date. Per arbiter ruling `docs/ads-architecture-research/07-arbiter-final.md` §96: *"ProteinBar in 'Today at a glance' — rolled into the totals."* This is **as-designed**, not a bug.
- **Live numbers (2026-04-15):** BG total €303.87 spend / €758.96 revenue / 15 purchases. Of which: Cvetita primary = €233.07/€558.56/11; ProteinBar = €70.80/€200.40/4; legacy = 0.
- **What changes if you say "keep blended":** Bug 2.1 (sum dup rows) is critical and must be fixed.
- **What changes if you say "unbind ProteinBar":** Run `UPDATE store_integration_bindings SET store_id = NULL WHERE integration_account_id = '7fc2bf74-…'`. Bug 2.1 becomes irrelevant (only 1 row per date). Sub-brand filter on `/ads/bg` should still work because it's based on bindings array, but verify ProteinBar still appears as a sub-brand option.

### Decision 1.2 — `Promise.all` vs `Promise.allSettled` on user-facing fan-out

- **Status today:** All 4 ads API routes (`route.ts:46`, `adsets/route.ts:56`, `individual/route.ts:115`, `home/stores/route.ts:120,197`) use `Promise.all`. Cron uses `Promise.allSettled`.
- **Edge-cases peer's argument for keeping `Promise.all`:** Read paths SHOULD fail-fast. Showing half-blended data that LOOKS correct is worse than an error the user can retry. Inconsistency with cron is intentional (cron is a write path that retries on its own schedule).
- **Integrations peer's argument for switching to `allSettled`:** Graceful degradation — show 5/6 stores when 1 token expires, don't blank the whole page.
- **Recommended default:** Keep `Promise.all`, add a comment in `lib/ads-market.ts` documenting the design choice. Switch only if you want partial-data UI.

### Decision 1.3 — Vercel cron `?window=today` query string

- **Status today (UNVERIFIED):** Day 4 added `vercel.json` entry `{"path": "/api/cron/meta-sync?window=today", "schedule": "*/15 * * * *"}`. Both peer reviewers couldn't fetch Vercel docs. **Concern:** Vercel's cron scheduler may strip query strings, in which case the route runs in nightly mode (3-day backfill) every 15 min instead of intraday — a 3× BUC budget waste with zero freshness benefit.
- **Verification (5-min, you):** Vercel dashboard → Project → Functions → Logs → wait for next `meta-sync` invocation → look at the response body or `logger.info("meta-sync completed", { mode: ... })` line. `mode: "intraday"` → query string works, all good. `mode: "nightly"` → query string was stripped, must refactor.
- **If broken — fix path:** Split into two routes: `/api/cron/meta-sync` (nightly default) and `/api/cron/meta-sync-today` (calls the same internal function with `daysBack=1`). Update `vercel.json` accordingly.

### Decision 1.4 — Sales subtree status

- **RESOLVED IN-DOC:** `Sidebar.tsx:48` shows `/sales` Продажби is in the active nav. **Sales is NOT dead.** Keep `KpiCard.tsx`, all `components/sales/*`, all `/api/sales/*` routes. Skip the orphan-Sales pruning the dead-code primary speculated about.

---

## Section 2: Tier 1 — Functional bugs (fix this week)

### 2.1 🔴 BG StoreCard silently undercounts (overwrites duplicate-date rows)

- **Where:** `src/app/api/dashboard/home/stores/route.ts:139-141`
- **Current code:**
  ```ts
  for (const r of rows) {
    byDate.set(r.date, { spend: num(r.spend), revenue: num(r.revenue) });
  }
  ```
- **What's wrong:** The view returns 2 rows per BG date at level=`account` (one per active binding's `object_id`). `byDate.set` overwrites instead of accumulating. The card shows EITHER ~€558 OR ~€200 (whichever Postgres returned last), NOT the €758 sum.
- **Why it matters:** Comment on line 118 promises "pre-blended by the view" — but the view groups by `object_id`, so the per-account split survives. The store card silently shows wrong numbers right now.
- **Fix direction:**
  ```ts
  for (const r of rows) {
    const existing = byDate.get(r.date) ?? { spend: 0, revenue: 0 };
    byDate.set(r.date, {
      spend: existing.spend + num(r.spend),
      revenue: existing.revenue + num(r.revenue),
    });
  }
  ```
- **Verification:**
  1. Re-run the live SQL: `SELECT date, level, object_id, SUM(spend) FROM meta_insights_by_store WHERE store_id = '<bg_store_id>' AND date = '2026-04-15' GROUP BY date, level, object_id`. Expect 2+ rows for BG account-level.
  2. After fix: in browser, hover the BG StoreCard sparkline, today's value should equal the sum. Compare against `SELECT SUM(revenue) FROM meta_insights_by_store WHERE store_id = '<bg_store_id>' AND date = '2026-04-15' AND level = 'account'`.
- **Dependencies:** Decision 1.1 — only relevant if "keep blended". If "unbind ProteinBar", skip this fix.

### 2.2 🔴 `updateMetaAdStatus` doesn't validate adId belongs to integrationAccountId

- **Where:** `src/app/api/dashboard/ads/[adId]/status/route.ts:38`
- **What's wrong:** Route accepts `{ status, integrationAccountId }` from POST body and passes them to `updateMetaAdStatus(adId, status, integrationAccountId)` without verifying that `adId` actually belongs to the passed account. With agency tokens that have multi-account access, a malicious or buggy client could toggle ads across any reachable account.
- **Why it matters:** Authorization gap. Severity = token scope.
- **Fix direction:** Before calling `updateMetaAdStatus`, lookup the ad in `meta_insights_daily` (or via Meta API single-ad fetch) and confirm its `integration_account_id` matches the body. Return 403 on mismatch.
  ```ts
  // Pseudo:
  const { data: ad } = await supabaseAdmin
    .from("meta_insights_daily")
    .select("integration_account_id")
    .eq("level", "ad")
    .eq("object_id", adId)
    .limit(1)
    .maybeSingle();
  if (ad && ad.integration_account_id !== integrationAccountId) {
    return NextResponse.json({ error: "ad-account mismatch" }, { status: 403 });
  }
  // (If ad row doesn't exist in DB, fall through and let Meta error)
  ```
- **Verification:** Manually POST to `/api/dashboard/ads/<bg_ad_id>/status` with `{integrationAccountId: <gr_account_id>}` and expect 403.
- **Dependencies:** None.

### 2.3 🔴 `meta-sync` wipes `last_synced_at` to NULL on any error

- **Where:** `src/app/api/cron/meta-sync/route.ts:206-215`
- **Current code:**
  ```ts
  .update({
    last_synced_at: result.error ? null : now,
    last_sync_error: result.error,
    ...
  })
  ```
- **What's wrong:** A single transient 502 nukes the timestamp. FreshnessDot then shows "никога не е обновявано" (red) even though yesterday's sync succeeded.
- **Fix direction:** Preserve prior value on error.
  ```ts
  .update({
    last_synced_at: result.error ? undefined : now, // undefined = no change
    last_sync_error: result.error,
    ...
  })
  ```
  (Confirm `supabase-js` upsert semantics for `undefined` → omitted from the update; if not, omit the field conditionally.)
- **Verification:**
  1. Pick an integration_account, note its `last_synced_at`.
  2. Force a sync error (temporarily break the token) and re-run the cron.
  3. After: `last_synced_at` should be unchanged; `last_sync_error` populated.
- **Dependencies:** None.

### 2.4 🔴 TopBar regex matches `/ads/campaigns` and `/ads/adsets`

- **Where:** `src/components/layout/TopBarStoreSwitcher.tsx:36`
- **Current code:**
  ```ts
  const ADS_PATH_RE = /^\/ads\/([a-z]{2,})(\/|$)/;
  ```
- **What's wrong:** "campaigns" and "adsets" both match `[a-z]{2,}`. On those legacy sub-routes, the switcher renders "🏬 ?" (because `byMarket.get("campaigns")` is undefined) and clicking BG/GR/RO replaces the URL to `/ads/bg`, dropping the user out of the campaigns/adsets page.
- **Fix direction:** Allowlist the 3 known markets:
  ```ts
  const ADS_PATH_RE = /^\/ads\/(bg|gr|ro)(\/|$)/;
  ```
  (Future markets: when adding `hu/hr/rs`, extend this regex AND `HOME_MARKET_CODES` in `lib/store-market-resolver.ts:160` AND `FLAG_BY_MARKET` in `home/stores/route.ts` AND `/ads/[market]/page.tsx`.)
- **Verification:**
  1. Manually visit `/ads/campaigns` in browser — switcher should NOT render (return null).
  2. Manually visit `/ads/bg` — switcher renders with BG active.
  3. Test `/ads/bg/something/deep` (when sub-routes exist in W6) — still matches.
- **Dependencies:** None.

### 2.5 🔴 Bulgarian gender wrong: "типичен сряда"

- **Where:** `src/components/dashboard/KpiStrip.tsx:127`
- **Current code:**
  ```ts
  const typicalLabel = `типичен ${weekdayBg}`;
  ```
- **What's wrong:** Bulgarian adjectives agree in gender with their noun. сряда (Wed), събота (Sat), неделя (Sun) are feminine — adjective form is "типична". Other days are masculine — "типичен" is correct.
- **Fix direction (option A — gender map):**
  ```ts
  const FEMININE_DAYS = new Set(["сряда", "събота", "неделя"]);
  const adjective = FEMININE_DAYS.has(weekdayBg) ? "типична" : "типичен";
  const typicalLabel = `${adjective} ${weekdayBg}`;
  ```
- **Fix direction (option B — sidestep with neutral phrasing):**
  ```ts
  const typicalLabel = "спрямо типичен ден";
  ```
  (Loses the weekday specificity but eliminates the agreement problem entirely.)
- **Recommendation:** Option A — keeps the weekday context which is the value of the comparison.
- **Verification:** Change system day to Wednesday (or just hardcode `weekdayBg = "сряда"` temporarily) and check the label reads "типична сряда".
- **Dependencies:** None.

### 2.6 🔴 vsTypical can return ~2300%+ near midnight Sofia

- **Where:** `src/app/api/dashboard/home/top-strip/route.ts:143-162`
- **What's wrong:** At `hoursElapsed ≈ 1`, `matchedSoFar = typ * (1/24)`. A stray late-attribution full-day prior row makes `value ≈ typ`, giving `vsTypical = (typ - typ/24) / (typ/24) * 100 ≈ 2300%`. Display is unbounded.
- **Fix direction (option A — clamp):**
  ```ts
  const vsTypicalRaw = Math.round(((value - matchedSoFar) / matchedSoFar) * 100);
  const vsTypical = Math.max(-999, Math.min(999, vsTypicalRaw));
  ```
- **Fix direction (option B — gate stricter):** Raise `tooEarly` threshold from 1h to 3h (`hoursElapsed < 3`).
- **Recommendation:** Both. Clamp catches the rare event; gate avoids noisy early-hour numbers.
- **Verification:** Mock `Date` to 01:01 Sofia and seed a prior weekday row at 100x typical — confirm display shows ≤999% not 10,000%.
- **Dependencies:** None.

### 2.7 🔴 NaN propagates through `num()` in stores route

- **Where:** `src/app/api/dashboard/home/stores/route.ts:108-109`, used at lines 150-160
- **Current code:**
  ```ts
  const num = (v: number | string | null | undefined): number =>
    v == null ? 0 : typeof v === "string" ? Number(v) : v;
  ```
- **What's wrong:** `Number("abc")` returns `NaN`, which then flows through sums and median calculations silently. One bad row corrupts the whole card.
- **Fix direction:**
  ```ts
  const num = (v: number | string | null | undefined): number => {
    if (v == null) return 0;
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : 0;
  };
  ```
  Same fix should be applied to the matching helper in `top-strip/route.ts` (line ~107).
- **Verification:** Unit-test mentally: `num("abc")` → 0; `num(null)` → 0; `num("123.45")` → 123.45.
- **Dependencies:** Best done with 2.1 (same file).

### 2.8 🔴 Cron uses UTC `today`, dashboard uses Sofia

- **Where:** `src/app/api/cron/meta-sync/route.ts:241-244`
- **Current code:**
  ```ts
  const today = new Date();
  const since = new Date(today.getTime() - (daysBack - 1) * 86_400_000);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = today.toISOString().slice(0, 10);
  ```
- **What's wrong:** `toISOString().slice(0, 10)` returns UTC date. Routes use Sofia date. Window mismatch creates 1-3h gaps near Sofia midnight.
- **Fix direction:** Extract a shared Sofia-date helper to `src/lib/sofia-date.ts` (currently duplicated in `top-strip/route.ts` and `stores/route.ts`):
  ```ts
  // src/lib/sofia-date.ts
  const SOFIA_TZ = "Europe/Sofia";
  export function sofiaDate(d: Date = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: SOFIA_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  }
  export function shiftDate(isoDate: string, days: number): string {
    const [y, m, d] = isoDate.split("-").map(Number);
    const t = Date.UTC(y, m - 1, d) - days * 86_400_000;
    const dt = new Date(t);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }
  ```
  Then in cron:
  ```ts
  import { sofiaDate, shiftDate } from "@/lib/sofia-date";
  const untilStr = sofiaDate();
  const sinceStr = shiftDate(untilStr, daysBack - 1);
  ```
- **Verification:** Run the cron at a controlled time near Sofia midnight and check the response body's `window: { since, until }` matches Sofia local date, not UTC.
- **Dependencies:** Refactor opportunity — also remove duplicates in `top-strip/route.ts:36-78` and `stores/route.ts:55-77`.

---

## Section 3: Tier 2 — Security & external-launch blockers

### 3.1 🔴 Shopify webhook HMAC fail-open when client_secret missing

- **Where:** `src/app/api/webhooks/shopify/[storeId]/route.ts:58-74`
- **What's wrong:** `if (config.credentials.client_secret) { verify HMAC }` else `logger.warn` and PROCESS the payload. Anyone with the URL can forge orders.
- **Fix direction:**
  ```ts
  if (!config.credentials.client_secret) {
    if (process.env.NODE_ENV === "production") {
      logger.error("Webhook rejected: no client_secret in store config", { storeId });
      return NextResponse.json({ error: "webhook not configured" }, { status: 401 });
    }
    logger.warn("Webhook HMAC verification SKIPPED (dev only) — no client_secret");
  } else {
    // existing HMAC verify
  }
  ```
- **Verification:** Set `NODE_ENV=production` locally, POST to webhook → expect 401. Unset → expect process-with-warn behavior.
- **Dependencies:** Verify production stores have `client_secret` populated in `store_credentials` table BEFORE deploying this fix, or production webhooks will start 401-ing.

### 3.2 🔴 No timestamp freshness check on webhooks

- **Where:** Same route
- **What's wrong:** Replay window is unbounded — only `webhook_log.webhook_id` uniqueness prevents replay, and old IDs that have been pruned (or never recorded) can be replayed.
- **Fix direction:** Reject events with `x-shopify-triggered-at` older than 5 minutes:
  ```ts
  const triggeredAt = req.headers.get("x-shopify-triggered-at");
  if (triggeredAt) {
    const ageMs = Date.now() - new Date(triggeredAt).getTime();
    if (ageMs > 5 * 60_000) {
      return NextResponse.json({ error: "stale webhook" }, { status: 401 });
    }
  }
  ```
- **Verification:** POST with a `x-shopify-triggered-at` header set to 10 min ago → expect 401.
- **Dependencies:** None.

### 3.3 🔴 Webhook returns 200 even on DB failure (silent data loss)

- **Where:** `src/app/api/webhooks/shopify/[storeId]/route.ts:118-151`
- **What's wrong:** Wrapped in try/catch that logs and returns 200 to "prevent Shopify retry storms". On a transient DB blip, the event is permanently lost — only traceable via `webhook_log.error_message` (which has no replay job).
- **Fix direction:** Distinguish payload errors (4xx, return 200 to prevent retry) from infrastructure errors (5xx, return 500 to trigger Shopify retry). Pseudo:
  ```ts
  try {
    await routeWebhook(...);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PayloadShapeError) return NextResponse.json({ ok: true });
    // Treat DB / network errors as transient
    logger.error("webhook DB failure", { error: String(err) });
    return NextResponse.json({ error: "transient" }, { status: 500 });
  }
  ```
  OR add a nightly job that replays `webhook_log` rows where `error_message IS NOT NULL AND processed = false`.
- **Verification:** Stop Supabase temporarily, POST a valid signed webhook → expect 500.
- **Dependencies:** None.

### 3.4 🔴 Next.js 15.5.14 has CVE GHSA-q4gf-8mx6-v5v3

- **Where:** `package.json:19`
- **What's wrong:** CVSS 7.5, "Denial of Service with Server Components", `npm audit` confirms `fixAvailable: true` at `next@15.5.15`.
- **Fix:** `npm install next@15.5.15` (patch-level, no breaking change).
- **Verification:**
  ```bash
  npm audit --json | python -c "import json,sys; d=json.load(sys.stdin); print(d['metadata']['vulnerabilities'])"
  npm run build  # confirm no regressions
  ```
- **Dependencies:** None. Do this first.

### 3.5 🔴 Meta access tokens in URL query strings

- **Where:** `src/lib/meta.ts` lines 248, 283, 429, 454, 491, 569, 604, 623, 754 (also `paging.next` URLs at 287, 433, 458, 501, 761)
- **What's wrong:** `?access_token=...` lands in Vercel logs, proxy logs, error pages, and any captured `paging.next` URLs leak the token verbatim.
- **Fix direction:** Use `Authorization: Bearer ${client.token}` header instead. Meta Graph API supports this since v2.3.
  ```ts
  // Replace:
  url.searchParams.set("access_token", client.token);
  await fetchWithTimeout(url, ..., 10_000);

  // With:
  await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${client.token}` },
    ...,
  }, 10_000);
  ```
  Also: when handling `paging.next`, strip `access_token` from the URL before re-fetching, then re-add as header.
- **Verification:** After change, `grep "access_token" src/lib/meta.ts` should return zero matches in URL construction.
- **Dependencies:** None. Test thoroughly — this touches every Meta call.

### 3.6 🔴 CSP allows `'unsafe-inline'` for scripts

- **Where:** `next.config.ts:5-6`
- **What's wrong:** Tailwind 4 needs inline styles, but `'unsafe-inline'` for scripts undermines the entire CSP — XSS via injected `<script>` becomes trivial.
- **Fix direction:** Switch to nonce-based CSP. Next.js 15 has built-in nonce support via `next.config.ts` + `cspHeader` middleware. Document needed:
  ```ts
  // Pseudo — refer to https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
  ```
- **Verification:** After fix, browser DevTools → Console → no CSP errors on dashboard load.
- **Dependencies:** Bigger change — defer to before SaaS launch unless XSS is an active concern.

### 3.7 🟠 Middleware excludes `/api` from auth

- **Where:** `src/middleware.ts:21` — matcher `"/((?!login|api|...).*)"`
- **What's wrong:** Every API route must self-call `requireAuth`. One forgotten call ships an open endpoint.
- **Fix direction:** Flip to protect-by-default + explicit opt-out for cron/webhooks:
  ```ts
  // matcher includes /api/*, with allowlist for unauth-needed paths
  matcher: ["/((?!login|api/cron|api/webhooks|api/auth|_next/static|_next/image|favicon.ico).*)"]
  ```
  Then remove `requireAuth` calls from every non-cron/webhook API route.
- **Verification:** Hit `/api/dashboard/ads?market=bg` without cookies → expect 401 from middleware (not from route).
- **Dependencies:** Audit every API route to ensure none WERE relying on auth-required behavior. Most will be cleaner without the explicit check.

### 3.8 🟠 `loadStoreConfig` runs BEFORE HMAC verification

- **Where:** `src/app/api/webhooks/shopify/[storeId]/route.ts:48`
- **What's wrong:** Allows storeId enumeration via 404 vs 401 timing differences.
- **Fix direction:** Verify HMAC FIRST using a stored secret keyed by `x-shopify-shop-domain` header, then load config.
- **Dependencies:** Requires schema for shop-domain → secret lookup that's HMAC-safe.

### 3.9 🟠 BUC rate-limit only on cron path

- **Where:** `src/lib/meta.ts` — `parseBucHeader` called only at line 742 (cron's `fetchDailyInsights`)
- **What's wrong:** User routes (`getMetaOverview`, `getMetaCampaignInsights`, etc.) don't read BUC headers. A user reloading `/ads/bg` 10×/min hits 30+ Graph calls/min on each of 3 BG accounts; one burst can walk into a 17h Meta ban.
- **Fix direction:** Extract a shared `metaGraphFetch(url, client)` helper that wraps `fetchWithTimeout`, parses BUC, and respects `decide()` / `sleepForThrottle`. Migrate all 8 helpers to use it.
- **Verification:** Force `peakUsagePct > 75` (mock the header) and confirm the helper sleeps before next call.
- **Dependencies:** None, but careful — touches the hot read path.

### 3.10 🟠 `qa-api-test.mjs` has plaintext SUPABASE_SERVICE_ROLE_KEY + ENCRYPTION_KEY

- **Where:** Repo root, untracked
- **Action:** **Delete the file. Then rotate both keys.**
  ```bash
  rm qa-api-test.mjs qa-audit.js  # if you don't need them
  ```
  Rotate Supabase service role key in Supabase dashboard → Settings → API → "Roll service_role secret".
  Rotate ENCRYPTION_KEY by generating a new 64-char hex via `openssl rand -hex 32`. WARNING: rotating ENCRYPTION_KEY invalidates all encrypted credentials in `integration_accounts.credentials`. Plan a re-encryption migration BEFORE rotating.
- **Verification:** `grep -r "eyJhbGc" .` returns nothing tracked; `git log --all --source -- qa-api-test.mjs` to confirm file was never committed (you commented earlier it's untracked — verify).
- **Dependencies:** Re-encryption plan if rotating ENCRYPTION_KEY.

### 3.11 🟠 RLS is theater — entire app uses service-role

- **Where:** `src/lib/supabase/admin.ts` — used by every dashboard route
- **What's wrong:** `supabaseAdmin` bypasses RLS. The org-scoped policies in migrations 008-010 are decoration.
- **Why it's currently OK:** Single-tenant phase. Auth is enforced at the Next.js layer via `requireAuth()`.
- **Fix direction (when going SaaS):** Replace `supabaseAdmin` calls in user routes with the user-scoped `createServerClient` from `@supabase/ssr`. Service-role only for crons + webhooks.
- **Dependencies:** Major refactor. Defer to SaaS-prep cycle.

---

## Section 4: Tier 3 — UX correctness & accessibility

### 4.1 🔴 Bulgarian UI leak (15+ spots in `/ads/[market]/page.tsx`)

- **Where:** `src/app/(dashboard)/ads/[market]/page.tsx`
- **Spots to translate:**
  | Line | English | Suggested Bulgarian |
  |---|---|---|
  | 76-85 (STATUS_MAP) | Active / Paused / Deleted / Archived / Processing / Issues | Активна / Пауза / Изтрита / Архивирана / Обработва се / С проблеми |
  | 87-93 (SCORE_LABELS) | Top / Good / Avg / Below / Poor | Топ / Добра / Средна / Под средната / Слаба |
  | 347-352 (MiniKpi) | Spend / Revenue | Разход / Приходи |
  | 376 (sort buttons) | Score / Spend | Резултат / Разход (ROAS, CTR stay) |
  | 401 (filter chips) | Active / Paused | Активни / На пауза |
  | 543-548 (MetricCell) | Spend / Revenue / ROAS / CTR / CPA | Разход / Приходи / ROAS / CTR / CPA |
  | 558 (button) | Pause / Resume | Пауза / Активирай |
  | 608-616 (StatRow) | Spend / Revenue / ROAS / Adj. ROAS / Покупки / CPA / CTR / Frequency / Confidence | Разход / Приходи / ROAS / Корекция ROAS / Покупки / CPA / CTR / Честота / Достоверност |
  | 638-639 | Campaign: / Ad Set: | Кампания: / Ad Set: |
  | 650 (button) | Pause Ad / Resume Ad | Спри рекламата / Активирай рекламата |
  | (TopBar burger) `TopBar.tsx:32` | Toggle menu | Отвори меню |
- **Verification:** `grep -nE '"(Active|Paused|Score|Spend|Revenue|Top|Good|Avg|Below|Poor|Pause|Resume|Toggle menu)"' src/app/(dashboard)/ads/[market]/page.tsx` returns zero results.
- **Dependencies:** None. Pure i18n.

### 4.2 🔴 `text-text-3` on `bg-surface` = 2.47:1 (fails WCAG AA)

- **Where:** Multiple — including `ads/[market]/page.tsx:364` (sub-brand inactive chips)
- **Fix:** Replace `text-text-3` with `text-text-2` for any inactive interactive label or labelled UI string. `text-text-3` should be reserved for hint text or visual disambiguation, not labels users need to read.
- **Verification:** Run any axe-core / Lighthouse pass on the dashboard.

### 4.3 🟠 Modal lacks focus trap + restoration

- **Where:** `src/app/(dashboard)/ads/[market]/page.tsx:167-173` (effect) + the inline AdModal
- **Fix:** Save `document.activeElement` on open, focus it on close. Add focus trap (option: install `focus-trap-react` or write a manual one).

### 4.4 🟠 StoreCard nested-interactive keyboard issue

- **Where:** `src/components/dashboard/StoreCard.tsx:81-86,121-128`
- **What's wrong:** Outer card has `role="button"` + `onKeyDown` that calls `e.preventDefault()` + `goToSales()`. Inner Link's Enter key triggers the outer keydown which preventDefaults, suppressing the link's native click. User pressing Enter on "Виж реклами →" goes to /sales instead of /ads.
- **Fix direction:** Add `onKeyDown={(e) => e.stopPropagation()}` to the Link AND change outer to use `onKeyDown={(e) => { if (e.target === e.currentTarget) ... }}` so it only fires when the card itself is focused.
  Better yet: restructure to use a `<Link>` for the whole card and a sibling `<button>` next to (not inside) the card for the secondary action.
- **Verification:** Tab to "Виж реклами →" link, press Enter → navigate to `/ads/<market>` not `/sales/store/<id>`.

### 4.5 🟠 Fresh-bound account shows red FreshnessDot

- **Where:** `src/components/shared/FreshnessDot.tsx:37`, `home/stores/route.ts:170`, `markets/[market]/route.ts` (after Day 4)
- **Fix direction:** Pass `accountCreatedAt` alongside `lastSyncedAt`. If `lastSyncedAt` is null AND `accountCreatedAt < 30 min ago`, show amber "очаква първа синхронизация" instead of red "никога не е обновявано".

### 4.6 🟠 ROAS unbounded display

- **Where:** `src/app/api/dashboard/home/top-strip/route.ts:167`
- **Fix:** `Math.min(roas, 99.99)` before formatting.

### 4.7 🟠 `?window=today` strict equality

- **Where:** `src/app/api/cron/meta-sync/route.ts:236-238`
- **Fix:**
  ```ts
  const windowParam = (url.searchParams.get("window") ?? "").trim().toLowerCase();
  const daysBack = windowParam === "today" ? SYNC_DAYS_BACK_INTRADAY : SYNC_DAYS_BACK_NIGHTLY;
  ```

### 4.8 🟠 `resolveAllHomeMarkets` Promise.all blanks home if any market unseeded

- **Where:** `src/lib/store-market-resolver.ts:169`
- **Fix direction:** Use `Promise.allSettled` here (this is the one place where graceful degradation IS warranted — home page should render 2 cards + 1 placeholder, not 0 cards). Distinct from Decision 1.2 because home page consumes "all 3 stores" semantically; missing one is degradation, not "wrong number". Update `home/stores/route.ts:197` to consume the result and emit placeholder cards.

### 4.9 🟡 FreshnessDot uses raw Tailwind palette

- **Where:** `src/components/shared/FreshnessDot.tsx:20-26`
- **Fix:** Replace `bg-emerald-500/yellow-400/orange-400/zinc-400/red-500` with design tokens:
  ```ts
  const COLOR_BY_LEVEL: Record<Level, string> = {
    fresh:  "bg-accent",
    recent: "bg-orange",   // (or define --yellow if needed)
    aging:  "bg-orange",
    stale:  "bg-text-3",
    none:   "bg-red",
  };
  ```

### 4.10 🟡 ActionCard onAction silent (only logger.info)

- **Where:** `src/components/dashboard/ActionRow.tsx:49-51`
- **Fix:** Add a toast via `useToast()` from `ToastProvider`:
  ```ts
  toast(`${ACTION_LABEL_BG[action]} (W4 ще активира това)`, "info");
  ```

### 4.11 🟡 SWR market switch may flash old data

- **Where:** `src/app/(dashboard)/ads/[market]/page.tsx`
- **Fix:** Either pass `keepPreviousData: false` explicitly to SWR (forces blank state on key change) OR add a transition guard checking `marketData.marketCode === market` before rendering.

### 4.12 🟡 Loading state hides page chrome on `/ads/[market]`

- **Where:** `src/app/(dashboard)/ads/[market]/page.tsx:302-314`
- **Fix:** Move the `ovLoading || !marketData` check INTO the body, render PageHeader + KPI skeleton inline instead of returning early.

### 4.13 🟡 Anomaly pill `animate-pulse` indefinite

- **Where:** `src/components/dashboard/KpiStrip.tsx:161`
- **Fix:** Wrap with `motion-safe:` modifier OR use a one-time animation.

### 4.14 🟡 ARIA gaps

- TopBar dark-mode toggle: add `aria-label`
- TopBar burger: change `aria-label="Toggle menu"` → `"Отвори меню"`
- Search input on /ads/[market]: add `aria-label="Търси реклами"`
- TopBarStoreSwitcher dropdown: change `<button role="option">` → `<div role="option" tabIndex={-1}>` (option must not be a button per ARIA spec)
- Add arrow-key navigation to TopBarStoreSwitcher dropdown

### 4.15 🟡 "Суб-бранд" calque

- **Where:** `src/app/(dashboard)/ads/[market]/page.tsx:358`
- **Fix:** "Подбранд:" or "Марка:".

### 4.16 🟡 ROAS tile "още рано" never clears

- **Where:** `src/components/dashboard/KpiStrip.tsx:190` — passes `vsTypical={null}` for ROAS tile permanently
- **Fix:** Remove the delta row entirely on ROAS tile (the value is the relevant signal), OR compute a real ROAS-vs-typical comparison.

### 4.17 🟡 "Виж реклами" link tap target ~28-30px (below 44px min)

- **Where:** `src/components/dashboard/StoreCard.tsx:124-128`
- **Fix:** `px-3 py-2` minimum.

### 4.18 🟡 `medianа 14д` jargon-y

- **Where:** `src/components/dashboard/StoreCard.tsx:160`
- **Fix:** "средно 14д" reads gentler.

---

## Section 5: Tier 4 — Cleanup (one PR, ~600 LOC)

### 5.1 Delete dead files

```bash
cd D:/Cvetitaherbal/platform/cvetita-platform/cvetita-command-center

# Confirmed orphans by 2 auditors (zero imports anywhere)
rm src/components/dashboard/KpiGrid.tsx
rm src/components/dashboard/TopProducts.tsx
rm src/components/dashboard/RevenueTrend.tsx
rm src/components/dashboard/ChannelBreakdown.tsx
rm src/components/dashboard/NewsFeed.tsx
rm src/components/charts/ScatterPlot.tsx
rm src/components/charts/StackedAreaChart.tsx
rm src/components/shared/Modal.tsx
rm src/components/shared/MiniKpi.tsx  # WAIT: see 5.4 first
rm src/components/shared/Tabs.tsx
# DO NOT delete Tooltip.tsx — FreshnessDot imports it via relative path
# qa-api-test.mjs + qa-audit.js: see Section 3.10 — delete + rotate keys

# Update charts barrel
# Edit src/components/charts/index.ts to remove ScatterPlot + StackedAreaChart exports
```

**Pre-deletion verification (per file):**
```bash
# Replace KpiGrid with each filename you intend to delete
grep -rn "from .*\(KpiGrid\|TopProducts\|RevenueTrend\|ChannelBreakdown\|NewsFeed\|ScatterPlot\|StackedAreaChart\|shared/Modal\|shared/Tabs\)" src/ | grep -v ".test.ts"
# Should return ZERO lines for each
```

**DO NOT delete (peer review caught primary errors):**
- `src/components/dashboard/KpiCard.tsx` — used by Sales (which is alive per Decision 1.4)
- `src/components/shared/Tooltip.tsx` — FreshnessDot imports via relative `./Tooltip`
- `src/components/shared/SortButton.tsx` — exports `FilterPill<T>` used in `email/page.tsx:11`
- `react-masonry-css`, `react-markdown` deps — each has 1 active consumer

### 5.2 Drop unused npm dependencies

```bash
npm uninstall @ai-sdk/anthropic ai
```

**Pre-removal verification:**
```bash
grep -rn "from ['\"]ai['\"]\|from ['\"]@ai-sdk\|require\(['\"]ai['\"]\|require\(['\"]@ai-sdk" src/
# Must return ZERO lines
```

**Post-removal:** `npm run build` to confirm nothing breaks.

### 5.3 Drop unused env vars

- Remove from `.env.local`: `NEXTAUTH_SECRET`, `AUTH_PASSWORD`
- Remove from Vercel dashboard → Project → Settings → Environment Variables: same two
- Remove from `.github/workflows/ci.yml:38-39` (dummy values for build)

**Pre-removal verification:**
```bash
grep -rn "NEXTAUTH_SECRET\|AUTH_PASSWORD" src/
# Must return ZERO lines
```

### 5.4 Consolidate `MiniKpi` (8 inline copies → import shared)

**Files to refactor (replace the inline `function MiniKpi(...)` with `import { MiniKpi } from "@/components/shared/MiniKpi"`):**
- `src/app/(dashboard)/traffic/page.tsx:205`
- `src/app/(dashboard)/email/page.tsx:385`
- `src/app/(dashboard)/email/flows/[flowId]/page.tsx:253`
- `src/app/(dashboard)/products/[handle]/page.tsx:326`
- `src/app/(dashboard)/customers/page.tsx:149`
- `src/app/(dashboard)/ads/[market]/page.tsx:662`
- `src/app/(dashboard)/ads/campaigns/page.tsx:271`
- `src/app/(dashboard)/ads/adsets/page.tsx:263`

**Caveat:** Signatures diverge slightly across files (some add `highlight`, some `sparkData`). Compare each to the shared component (`src/components/shared/MiniKpi.tsx`) and reconcile. The shared version supports both — but if any file passes a prop the shared doesn't accept, extend the shared first.

**This refactor changes 5.1**: do NOT delete `src/components/shared/MiniKpi.tsx`. It's no longer orphaned after this consolidation.

### 5.5 Consolidate type duplication

- `BorderLevel` — canonical: `src/components/dashboard/StoreCard.tsx:15`. Remove duplicates from:
  - `src/components/layout/TopBarStoreSwitcher.tsx:14`
  - `src/app/api/dashboard/home/stores/route.ts:15`
- `StoreCardData` — canonical: same. Remove from:
  - `src/components/layout/TopBarStoreSwitcher.tsx:16`
- `MarketBinding` — canonical: `src/lib/store-market-resolver.ts:10`. Remove from:
  - `src/app/(dashboard)/ads/[market]/page.tsx:56`

### 5.6 Replace `console.error` with `logger.error` across 14+ routes

```bash
grep -rln "console\.\(error\|log\|warn\)" src/app/api/ | head -20
```

For each file, swap to `logger` from `@/lib/logger`. Pattern:
```ts
// Before
console.error("Meta Ads API error:", error);

// After
logger.error("Meta Ads API error", { error: String(error) });
```

### 5.7 Stop forwarding error messages verbatim to HTTP responses

Pattern: anywhere `return NextResponse.json({ error: message }, { status: 500 })` where `message = err.message`. The error message can leak internal schema names, table names, SQL snippets.

```ts
// Before
const message = err instanceof Error ? err.message : "Unknown error";
return NextResponse.json({ error: message }, { status: 500 });

// After
const message = err instanceof Error ? err.message : "Unknown error";
logger.error("route X failed", { error: message });
return NextResponse.json({ error: "Internal error" }, { status: 500 });
```

Files to update (from primary): `sales/trend/route.ts:45`, `sales/top-products/route.ts:31`, `stores/[storeId]/route.ts:52`, `stores/[storeId]/sync/route.ts:114`, `sales/store-performance/route.ts:29`, `stores/route.ts:31,183`, `home/top-strip/route.ts:107,184`, `sales/store/[storeId]/trend/route.ts:40`, plus ~10 more.

### 5.8 Doc fixes

`CLAUDE.md:64` — "Auth: NextAuth with password-based login" → "Auth: Supabase SSR (cookie-based, `@supabase/ssr`)"

`CLAUDE.md:80` — Claude API row "@ai-sdk/anthropic — Active" → "raw fetch via lib/agent-context.ts (no SDK)"

---

## Section 6: Dismissed (peer review proved primary wrong — DO NOT FIX)

These came up as findings but were dismissed on validation. Don't regress and re-flag them later:

| Claim | Why dismissed |
|---|---|
| `PageHeader` overflows at 375px | Has `flex-wrap` on the container |
| Empty-state copy "Всичко е под контрол." needs change | Idiomatic Bulgarian |
| `FilterPill<T>` is dead | Used in `email/page.tsx:11,253,345,346` |
| `KpiCard.tsx` is dead | Used by Sales components which are alive |
| Missing index on `meta_insights_daily` for top-strip query | `EXPLAIN ANALYZE`: index scan, 0.312ms — no seq scan |
| `lastNDates` year-boundary breaks Jan 1 | UTC math is correct for whole-day arithmetic |
| `shiftDate` comment misleading | Comment is fine — code is correct |
| Bulgarian "преди 2 дни" plural wrong | Bulgarian has no 2-4 special form (different from Russian) |
| `FreshnessDot.classify()` `Date.now()` unmemoized = bug | Not actually a bug — no timer leak, classification is on-demand |
| `react-masonry-css`, `react-markdown` are unused | Each has 1 active consumer — keep |
| `Promise.all` in user-facing fan-out is a bug | DESIGN CHOICE per Decision 1.2 (peer's argument: read paths should fail-fast) |
| `aggregateOverview` returns `parts[0]` by reference is a bug | Theoretical — no caller mutates the result |
| `meta-sync` UTC-vs-Sofia is "wrong data" | Window shifts 1-3h, not "wrong data" — still worth fixing per 2.8 but downgraded severity |

---

## Recommended attack order (with checklist)

### Round 1 — Decisions (you, 30 min)
- [ ] Decision 1.1: BG blends ProteinBar yes/no
- [ ] Decision 1.2: Promise.all keep / switch
- [ ] Decision 1.3: Vercel Function logs check (`mode: intraday` vs `nightly`)
- [x] Decision 1.4: Sales subtree alive (already verified)

### Round 2 — Push Day 4
- [ ] Currently `0fdf283` is local. Push: `git push origin main`
- [ ] Confirm Vercel deploy succeeds (Vercel dashboard or `gh` CLI)

### Round 3 — Tier 1 bugs (~2 hours)
Each is a small commit. Order based on dependency:
- [ ] 3.4 (Next CVE) — `npm install next@15.5.15` first; rebuild
- [ ] 2.8 (Sofia date) — extract `lib/sofia-date.ts`, refactor 3 callers
- [ ] 2.1 (BG sum dup rows) — only if Decision 1.1 = blended
- [ ] 2.7 (NaN guard in num()) — same file as 2.1, batch together
- [ ] 2.3 (preserve last_synced_at)
- [ ] 2.5 (Bulgarian gender)
- [ ] 2.6 (vsTypical clamp)
- [ ] 2.4 (regex allowlist)
- [ ] 2.2 (mutation authz)

### Round 4 — Tier 2 security (~1 hour, plus ops)
- [ ] 3.10 (delete qa-* files, rotate keys — coordinate ops)
- [ ] 3.1 + 3.2 + 3.3 (webhook hardening — one PR)
- [ ] 3.5 (Bearer header migration) — separate PR, careful testing
- [ ] 3.7 (middleware default-deny) — separate PR, audit each route
- [ ] Defer: 3.6 (CSP), 3.8 (HMAC-first), 3.9 (BUC), 3.11 (RLS)

### Round 5 — Tier 3 UX (~2 hours)
- [ ] 4.1 (Bulgarian translations batch)
- [ ] 4.5 (fresh-bound FreshnessDot — touches markets API + FreshnessDot)
- [ ] 4.6 (ROAS clamp — same file as 2.6)
- [ ] 4.7 (window=today case fold)
- [ ] 4.8 (resolveAllHomeMarkets allSettled)
- [ ] 4.9 (FreshnessDot tokens)
- [ ] 4.10 (ActionCard toast)
- [ ] 4.11 (SWR market flicker)
- [ ] 4.12 (loading state)
- [ ] 4.14 (ARIA gaps)
- [ ] Defer: 4.2 (contrast — broader change), 4.3 (focus trap), 4.4 (nested interactive — needs structure rethink), 4.13, 4.15-4.18

### Round 6 — Cleanup (~1 hour, one PR)
- [ ] 5.1 (delete orphans, after pre-deletion grep verification)
- [ ] 5.2 (drop unused deps)
- [ ] 5.3 (drop unused env vars)
- [ ] 5.4 (consolidate MiniKpi — order matters: do this BEFORE deleting shared/MiniKpi)
- [ ] 5.5 (consolidate types)
- [ ] 5.6 (console.error → logger.error)
- [ ] 5.7 (don't forward error messages)
- [ ] 5.8 (CLAUDE.md doc updates)

### Total estimate
~7-8 hours of focused work across 4-5 sessions. Not "rewrite the world." Surgical fixes.

---

## Appendix: Active commits in the W3 stack

| Commit | What |
|---|---|
| `9c8a25b` | docs: ads architecture research trail + W3 plan |
| `8c74fec` | W1+W2: integration_accounts + daily sync |
| `89e5a8c` | W3 Day 1: market resolver + Owner Home APIs |
| `216a363` | W3 Day 2: Owner Home UI |
| `ac19e9a` | W3 Day 3 A+C: per-market ads APIs + markets resolver |
| `96fcbaa` | W3 Day 3 B+D: /ads/[market] + TopBar switcher |
| `0fdf283` | W3 Day 4: intraday cron + FreshnessDot on /ads/[market] (LOCAL ONLY) |

## Appendix: Audit agent output files (transient, do NOT read)

For reference if agents need to re-check primary findings — but they live in temp and may not survive the next session:
```
C:\Users\User\AppData\Local\Temp\claude\D--Cvetitaherbal\f313c919-2536-4550-9341-e0ef00e4d595\tasks\
  aaf2ff18036b371ad.output  # DB primary
  af5c776aa7e25ec1f.output  # Dead code primary
  adc68807423758a13.output  # UI/UX primary
  a6776aa52cf117747.output  # Integrations primary
  a3e5e339f1a8d15d3.output  # Edge cases primary
  a899e541d22ef7987.output  # DB peer
  ac255b63bb3783735.output  # Dead code peer
  a247094fc016929e9.output  # UI/UX peer
  a6a47ade32f0f2903.output  # Integrations peer
  abe62de3d9a156248.output  # Edge cases peer
```

Treat THIS document as the canonical synthesis. It supersedes the raw transcripts.
