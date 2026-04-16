# Пълен одит на Cvetita Command Center

**Дата:** 2026-04-15
**Обхват:** `D:/Cvetitaherbal/platform/cvetita-platform/cvetita-command-center/`
**Метод:** Код + Supabase Management API (SELECT-only) + HTTP probes към интеграции и dev server
**Повод:** В снимка от потребителя Sales Store Detail за RO показва 0 EUR, но таблицата с поръчки - 3 реални поръчки (€713.87). Трябва да разберем защо някои числа се ъпдейтват, а други - не.

---

## Резюме

- **P0 — Sales KPIs за RO показват 0 EUR, защото `daily_aggregates` е ПРАЗНА таблица.** `pg_cron` не е инсталиран в Supabase (`cron.job` relation не съществува), а Shopify webhooks не се получават (само 1 тестов webhook за всичките 3 магазина). BG/GR имат данни само от еднократен refresh при миграция (последен refresh 2026-04-07, 8 дни преди днес). RO никога не е имал ред в `daily_aggregates`.
- **P0 — `qa-api-test.mjs` все още съдържа plaintext SUPABASE_SERVICE_ROLE_KEY и Shopify access token** в repo root (untracked). W3 одитът прeди 2 седмици задължи да се изтрият и ротират ключовете. Нищо не е направено.
- **P1 — Meta token refresh cron пропуска multi-store** — обновява само legacy `META_ACCESS_TOKEN` env var, но не и 6-те токена в `integration_accounts`. Когато `data_access_expires_at` достигне **2026-07-11** (след ~3 месеца), всички 6 акаунта спират едновременно, без автоматичен refresh.
- **P1 — Webhook HMAC fail-open остава неотстранен** (W3 §3.1) — ако `client_secret` липсва, събитието се обработва без проверка. Към момента всички stores имат `client_secret`, но фал-отворената логика си остава.
- **P1 — `anomalyCount: 0` е хардкоднато** в `top-strip/route.ts:143` — камбанка за аномалии никога не се появява (коментарът казва "W4: wire into agent_briefs").

---

## Какво работи добре

1. **Типова проверка и lint са чисти.** `npm run typecheck` 0 грешки; `npm run lint` показва само 3-те известни pre-existing warnings от W3 одита.
2. **npm audit: 0 уязвимости.** Next.js CVE GHSA-q4gf-8mx6-v5v3 е фикснат (15.5.14 → 15.5.15).
3. **Всички външни интеграции работят.** HTTP probes показват 200 за Shopify BG, Klaviyo, GA4 OAuth refresh, Anthropic. Meta debug_token потвърждава `is_valid: true`, `data_access_expires_at: 2026-07-11`.
4. **Meta sync + agent-briefs cron-овете работят.** 5 активни акаунта са синхронизирани днес (2026-04-15 16:45), `agent_briefs` има 1 запис за днешна дата.
5. **Auth gate на API endpoints е ефективен** — всички dashboard endpoints връщат 401 без cookie, всички cron endpoints връщат 401 без `CRON_SECRET`.
6. **TopBarStoreSwitcher фиксове от W3 са приложени** — allowlist regex `(bg|gr|ro)`, `role="option"` на `<div>`, arrow/Home/End keyboard navigation.
7. **Action/scale route е добре защитен** — whitelist на factor (1.25, 1.5, 2.0), target/account verification, pending status check, retry-safe agent_briefs update.
8. **`resolveAllHomeMarkets` използва `Promise.allSettled`** — ако един пазар падне, Home не се blank-ва.

---

## Находки по приоритет

### P0 — Критични

#### P0.1 — `daily_aggregates` не се обновява никога автоматично — причина за 0 EUR в снимката
- **Където:** `supabase/migrations/003_materialized_views.sql:145-149` (функция `register_store_cron`), `src/app/api/webhooks/shopify/[storeId]/route.ts:129-133` (webhook refresh)
- **Доказателство:**
  - `SELECT extname FROM pg_extension` → **pg_cron НЕ е инсталиран** (само pg_graphql, pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp)
  - `SELECT ... FROM cron.job` → `ERROR: 42P01: relation "cron.job" does not exist`
  - `SELECT ... FROM store_*.daily_aggregates`:
    - `store_bg`: 51 реда, last refresh `2026-04-07 06:58` (8 дни преди днес)
    - `store_gr`: 5 реда, last refresh `2026-04-07 07:00` (8 дни преди днес)
    - `store_ro`: **0 реда** — никога не е изпълнявано
  - `SELECT topic, COUNT(*) FROM store_*.webhook_log` → само 1 webhook за магазин, и двата на `2026-04-08 06:41` (вероятно тестов event)
- **Какво е погрешно:** Трите пътя за refresh на `daily_aggregates` всеки поотделно е счупен:
  1. **pg_cron 15-мин job** — `register_store_cron()` опитва да извика `cron.schedule()`, но extension не е installed; командата ще гръмне тихо при първото изпълнение. Стойностите в `store_bg/gr` са останки от `SELECT refresh_daily_aggregates('store_bg')` в края на миграция 004.
  2. **Webhook-driven refresh** — webhook handler извиква `refresh_daily_aggregates` след всеки order event, НО webhooks не пристигат (0 новополучени за 8+ дни).
  3. **Vercel cron** — `vercel.json` няма запис за Shopify sync или aggregates refresh. Единствените cronove са за Meta.
- **Следствие:**
  - Store Detail за RO показва `Приходи: 0 EUR`, `Поръчки: 0`, `Среден чек: 0 EUR`, "Няма данни" в Trend и TopProducts.
  - Store Detail за BG/GR показва данни, но замразени преди 8 дни.
  - StoreOrdersTable чете директно от `.orders` (вижда 3-те RO voided поръчки, но те са `financial_status='voided'` → правилно изключени от `daily_aggregates`).
- **Посока за фикс:**
  1. **Най-бързо:** Добави Vercel cron в `vercel.json`:
     ```json
     {"path": "/api/cron/refresh-aggregates", "schedule": "7,22,37,52 * * * *"}
     ```
     + нов route `/api/cron/refresh-aggregates` който вика `supabaseAdmin.rpc("refresh_daily_aggregates", {p_schema})` за всички активни магазини.
  2. **Задай Shopify webhook endpoints** за всичките 3 магазина в Shopify admin → Settings → Notifications → Webhooks. URL: `https://<vercel>/api/webhooks/shopify/<storeId>`. Topics: `orders/create`, `orders/updated`, `orders/cancelled`, `refunds/create`.
  3. **Еднократно ръчно:** Извикай `SELECT refresh_daily_aggregates('store_ro')` + за другите, за да сееш данните назад.
  4. **Дългосрочно:** Добави Vercel cron за backfill на `orders` от Shopify (`/api/cron/shopify-sync`) за случай когато webhooks падат.
- **Как е потвърдено:** Поетапно изграждане на картата от snapshots на схемата, orders, daily_aggregates и webhook_log. 3-те RO поръчки в таблицата match-ват `MAX(shopify_created_at)` на `store_ro.orders = 2026-04-05`.

#### P0.2 — Untracked `qa-api-test.mjs` + `qa-audit.js` с plaintext secrets
- **Където:** `qa-api-test.mjs:15`, `qa-api-test.mjs:318`
- **Доказателство:**
  ```
  qa-api-test.mjs:15: const SUPABASE_SERVICE_ROLE_KEY = "<redacted — full service_role JWT>";
  qa-api-test.mjs:318: const FALLBACK_TOKEN = "<redacted — Shopify access token>";
  ```
  Това е пълният service_role JWT (66-year expiry; валиден до 2091) и валиден Shopify access token за BG.
- **Какво е погрешно:** W3 одитът §3.10 (преди 2 седмици) ясно написа "Delete the file. Then rotate both keys." Файловете не са изтрити, ключовете не са ротирани. Всеки, който получи физически достъп до машината (или случайно git-add тези файлове), ще има неограничен достъп до базата.
- **Посока:**
  1. `rm qa-api-test.mjs qa-audit.js` (или `git rm` ако се окажат в history).
  2. Supabase dashboard → Settings → API → "Roll service_role secret".
  3. Shopify admin → Apps → Custom app → Revoke token → Re-generate.
  4. **ВАЖНО:** Преди ротация на `ENCRYPTION_KEY` (ако се реши), планирай re-encryption миграция за `integration_accounts.credentials` — иначе всичките 6 Meta tokens стават невалидни.

#### P0.3 — Webhook HMAC fail-open при липсващ `client_secret`
- **Където:** `src/app/api/webhooks/shopify/[storeId]/route.ts:58-74`
- **Какво е погрешно:** Логиката е `if (config.credentials.client_secret) { verify } else { logger.warn(...); process anyway }`. Към днес всички 3 stores имат `client_secret` (потвърдено чрез query на `store_credentials`), така че рискът е нулев днес. Но когато се добави нов store без `client_secret`, неговият endpoint ще приема forged orders без проверка.
- **Посока за фикс:** W3 §3.1 даде конкретен пример — в `NODE_ENV === "production"` отхвърляй с 401, само в dev да warn-ва.

---

### P1 — Важни

#### P1.1 — Meta refresh cron не обновява multi-store tokens
- **Където:** `src/app/api/cron/refresh-meta-token/route.ts:11`, `src/lib/meta.ts:170-197`
- **Какво е погрешно:** `refreshToken()` чете `process.env.META_ACCESS_TOKEN` и ъпдейтва Vercel env var. Това е legacy single-store токенът. Шестте токена в `integration_accounts.credentials.access_token` (per-store, encrypted с ENCRYPTION_KEY) **никога не се refresh-ват**. Meta `data_access_expires_at` на системния токен е `1783932021` = `2026-07-11 13:40 UTC`. След тази дата Graph API ще отказва user-data заявки, и 6-те integration accounts ще спрат едновременно (въпреки че `is_valid` остава `true`).
- **Посока за фикс:** Разшири `/api/cron/refresh-meta-token` да обходи всички `integration_accounts WHERE service='meta_ads'`, refresh-не всеки credential с `fb_exchange_token`, и re-encrypt-не през `ENCRYPTION_KEY`. Актуализирай `token_expires_at` в таблицата. Добави ранно предупреждение в FreshnessDot, когато `token_expires_at < now + 14 days`.

#### P1.2 — `anomalyCount` е хардкоднато на 0
- **Където:** `src/app/api/dashboard/home/top-strip/route.ts:143`
- **Какво е погрешно:** Response винаги връща `anomalyCount: 0`. Коментарът казва `// W4: wire into agent_briefs / anomaly detector`. Bell-иконата в `KpiStrip.tsx:166-174` никога не се показва, въпреки че има pulse анимация и подготвен стил.
- **Посока:** `SELECT COUNT(*) FROM agent_briefs WHERE for_date = sofiaDate() AND severity = 'red' AND status = 'pending'` и върни резултата.

#### P1.3 — Legacy `/api/dashboard/kpis` + `lib/shopify.ts` са single-store
- **Където:** `src/lib/shopify.ts:7-8`, `src/app/api/dashboard/kpis/route.ts:15-18`
- **Какво е погрешно:** Функциите `getStoreUrl()` и `getAccessToken()` четат директно от `process.env.SHOPIFY_STORE_URL` и `process.env.SHOPIFY_ACCESS_TOKEN`. Това са legacy env vars от ерата преди `store_credentials` таблицата. Route-ът `/api/dashboard/kpis` се вика от:
  - `src/providers/DataProvider.tsx:13` — СВЕТВА при ВСЯКО зареждане, защото е в `CRITICAL_APIS`
  - `src/app/api/agents/chat/route.ts:155` — агентският чат контекст
  - `src/lib/agent-context.ts:74` — морнинг report контекст
  Резултат: Chat агентът винаги гледа само BG KPIs, независимо от коя пазарна страница го викаш. Loading screen предзарежда само BG данни.
- **Посока:** Мигрирай `getShopifyKPIs` да приема `storeId`, чете от `store_credentials`, или запази backward-compat + добави multi-store версия `/api/sales/kpis?storeId=...`. Махни `/api/dashboard/kpis` от `CRITICAL_APIS` в DataProvider.

#### P1.4 — Webhook няма freshness check, връща 200 при DB fail
- **Където:** `src/app/api/webhooks/shopify/[storeId]/route.ts:118-151`
- **Какво е погрешно:** W3 §3.2 (няма `x-shopify-triggered-at` age check) и §3.3 (`try/catch { logger + 200 }` винаги маска грешки в БД). При краткотраен проблем със Supabase, събитието се губи завинаги — единственият след тип е `webhook_log.error_message`, но няма replay job.
- **Посока:** Вижте конкретните кодови промени в `docs/audits/2026-04-15-w3-audit-findings.md:295-328` — не са приложени.

#### P1.5 — CSP `'unsafe-inline'` за scripts
- **Където:** `next.config.ts:5`
- **Какво е погрешно:** `script-src 'self' 'unsafe-inline'` прави CSP защитата от XSS безсмислена. Всяка XSS vulnerability в Next.js страницата може да изпълни injected скрипт.
- **Посока:** W3 §3.6 — минавай към nonce-based CSP. По-добре да се отложи до преди SaaS launch, но да не се забравя.

#### P1.6 — Vercel cron `?window=today` query string
- **Където:** `vercel.json:13`
- **Какво е погрешно:** `{"path": "/api/cron/meta-sync?window=today", "schedule": "*/15 * * * *"}`. W3 §1.3 предупреди, че Vercel може да стрипва query strings — тогава route-ът ще работи в `nightly` mode (3-day backfill) всеки 15 мин, което е ~3× BUC waste. Не е проверено.
- **Как да се провери:** Vercel dashboard → Functions → Logs → чакай следваща meta-sync invocation → виж `logger.info("meta-sync completed", { mode: ... })`. Ако `mode: "intraday"` — OK; ако `mode: "nightly"` — refactor.
- **Посока:** Ако стрипва — split на два route-а (виж W3 §1.3 за детайли).

#### P1.7 — OrdersTable показва английски financial_status/fulfillment_status
- **Където:** `src/components/sales/StoreOrdersTable.tsx:78-82, 88-92, 156-162`
- **Какво е погрешно:** Badge-овете директно рендират суровите стойности `paid`, `voided`, `unfulfilled`, `partial`, etc. Нарушение на BG UI rule ("All user-visible strings in Bulgarian Cyrillic").
- **Посока:** Мапинг:
  ```ts
  const FIN_LABEL_BG = { paid:"Платена", pending:"Чакаща", voided:"Анулирана",
    refunded:"Възстановена", partially_refunded:"Частично възстановена",
    authorized:"Авторизирана", partially_paid:"Частично платена" };
  const FUL_LABEL_BG = { fulfilled:"Изпратена", partial:"Частична", unfulfilled:"Неизпратена" };
  ```

#### P1.8 — Settings page + agent prompts говорят в "лв", не EUR
- **Където:** `src/app/(dashboard)/settings/page.tsx:44,142,145`, `src/app/api/agents/chat/route.ts:114`, `src/app/api/agents/ads-intel/route.ts:142`
- **Какво е погрешно:** Memory правилото: "Currency: EUR, never лева/BGN". Settings dropdown-ът показва `["Над 15 000 лв.", "5 000-15 000 лв.", "До 5 000 лв."]` и агентският system prompt казва `"Месечен рекламен бюджет: над 15 000 лв"`. Това тече към моделa → той дава съвети в грешна валута.
- **Посока:** Замени "лв." с "EUR" във всички 5 места.

#### P1.9 — StoreCard §4.4 keyboard, §4.17 tap target, §4.18 "медиана"
- **Където:** `src/components/dashboard/StoreCard.tsx:123-134, 162`
- **Какво е погрешно:** Все още неотстранени от W3:
  - Ред 125: `onClick={(e) => e.stopPropagation()}` на Link, но **няма** `onKeyDown={(e) => e.stopPropagation()}` → натискането на Enter върху "Виж реклами" стопира native click поради `e.preventDefault()` в outer `handleKey`.
  - Ред 128: `px-2 py-1` дава ~28px височина, под 44px minimum.
  - Ред 162: "медиана 14д" → препоръка от W3 беше "средно 14д".
- **Посока:** Всички 3 са документирани в W3 §4.4, §4.17, §4.18.

#### P1.10 — /ads/[market]: "Суб-бранд:" calque + legacy env vars error
- **Където:** `src/app/(dashboard)/ads/[market]/page.tsx:394, 332-335`
- **Какво е погрешно:**
  - Ред 394: "Суб-бранд:" е калка. W3 §4.15: "Подбранд:" или "Марка:".
  - Ред 332-335: Error message "Добави META_ACCESS_TOKEN и META_AD_ACCOUNT_ID в Vercel Environment Variables" — това са legacy single-store env vars. Multi-store е в `integration_accounts`. Това съобщение ще подведе при setup на нов магазин.
- **Посока:** Замени на "Подбранд:". Обнови error message за multi-store: "Свържи Meta акаунт в Настройки → Магазини → Интеграции".

#### P1.11 — Няма BUC rate limit на user-facing Meta paths
- **Където:** `src/lib/meta.ts:742` и read helpers наоколо
- **Какво е погрешно:** W3 §3.9 — `parseBucHeader` се вика само в cron-а `fetchDailyInsights`. Read paths (`getMetaOverview`, `getMetaCampaignInsights`, etc.) не четат BUC headers. Потребител refresh-ващ `/ads/bg` 10×/min → 30+ Graph calls/min × 3 BG accounts → възможност за 17h Meta ban.
- **Посока:** Extract shared `metaGraphFetch(url, client)` helper който parse-ва BUC + sleep-ва при >75%.

#### P1.12 — KpiStrip ROAS tile "още рано" не се изчиства
- **Където:** `src/components/dashboard/KpiStrip.tsx:197`
- **Какво е погрешно:** `vsTypical={null}` се подава постоянно → `deltaNode` постоянно показва "още рано". Потребителят си мисли, че tile-ът е broken.
- **Посока:** Махни delta row-а за ROAS tile, ИЛИ изчисли real ROAS-vs-typical сравнение.

---

### P2 — Полезни (polish / tech debt)

#### P2.1 — `next lint` е deprecated
- **Къде:** `package.json:7`
- **Бележка:** Ще бъде премахнато в Next.js 16. Трябва миграция към `eslint` CLI (вижте deprecation warning).

#### P2.2 — 3 pre-existing ESLint warnings
- **Къде:** `src/app/(dashboard)/ads/adsets/page.tsx:74` (2×), `src/app/(dashboard)/agents/ad-creator/page.tsx:690`
- **Бележка:** Всичките са `react-hooks/exhaustive-deps`. Не критични, но не-чист baseline.

#### P2.3 — Minor version bumps налични
- `@supabase/ssr` 0.10.0 → 0.10.2 (patch)
- `@supabase/supabase-js` 2.101.1 → 2.103.2 (minor)
- `lucide-react` 1.7.0 → 1.8.0 (minor)
- **Препоръка:** Безопасни update-и.

#### P2.4 — Competitor scanner пази BGN default
- **Къде:** `src/lib/competitor-scanner.ts:176, 206, 217, 225`
- **Бележка:** Hardcoded `"BGN"` fallback. Трябва да става market-aware (ако scraper-ът scan-ва GR-продукт, да default-ва на EUR).

#### P2.5 — SUPABASE_ANON_KEY / SERVICE_ROLE_KEY с 66-year expiry
- **Къде:** `.env.local:5, 19` (JWT exp: 2091-01-12)
- **Бележка:** Когато платформата стане SaaS, 66-годишен JWT е антипод на rotation. Supabase позволява ключова ротация от Settings → API.

#### P2.6 — Voided orders в таблицата, 0 в KPIs (UX несъответствие)
- **Къде:** `src/components/sales/StoreOrdersTable.tsx` vs `src/lib/sales-queries.ts:148-174`
- **Бележка:** Потребителят вижда 3 поръчки с €-суми в таблицата, но KPIs = 0, защото трите са `voided`. Правилно от финансова гл.т., но объркващо UX. Добави "от които 0 активни" подзаглавие или филтър.

#### P2.7 — ENCRYPTION_KEY в plaintext .env.local
- **Къде:** `.env.local:20`
- **Бележка:** Ако вместо ротация на service_role (P0.2) се реши ротация на `ENCRYPTION_KEY`, това ще invalidate-не всички encrypted tokens в `integration_accounts`. Трябва re-encryption migration план преди ротация.

#### P2.8 — Stale comment в top-strip route
- **Къде:** `src/app/api/dashboard/home/top-strip/route.ts:53-54`
- **Какво пише:** "at account level (one row per store-day per account — the view already blends all bindings per store)"
- **Какво е истината:** View-ът връща 1 row per `object_id`, не blended. Кодът правилно акумулира чрез `bucket.spend += num(r.spend)`. Коментарът подвежда.

#### P2.9 — `/api/webhooks/shopify/[storeId]` loadStoreConfig преди HMAC
- **Къде:** `src/app/api/webhooks/shopify/[storeId]/route.ts:48`
- **Какво е погрешно:** W3 §3.8 — позволява storeId enumeration през 404/401 timing difference.
- **Посока:** Verify HMAC първо (keyed by `x-shopify-shop-domain` header → stored secret lookup).

#### P2.10 — RLS theater (service_role навсякъде)
- **Къде:** `src/lib/supabase/admin.ts` се използва във всички dashboard routes
- **Бележка:** Org-scoped RLS policies в миграции 008-010 са декорации — всички заявки минават през `supabaseAdmin`. Това е ОК за single-tenant, но W3 §3.11 правилно отбелязва, че при SaaS launch трябва user-scoped client.

---

## Какво не можах да проверя

1. **Визуална работа на UI** — `/ads/bg`, `/ads/gr`, `/ads/ro`, `/sales/store/[id]`, Home — dev server изисква Supabase Auth cookie, нямам logins. Всички endpoints probe-нати върнаха 401. **Заобиколка:** Ръчно логни се и тествай:
   - `/ads/xxxxx` (fake market) → очаквам "Магазин не е намерен" empty state (код го поддържа).
   - Mobile 320px — responsive breakpoints са зададени (`md:`, `lg:`), но не можах да видя рендеринга.
   - Dark mode — `.dark` class + full палитра в `globals.css`, не е проверен визуално.
2. **Vercel cron actual behavior** — дали `?window=today` се стрипва или не. Иска достъп до Vercel dashboard logs.
3. **Webhook live delivery от Shopify** — само кодът + receipts в `webhook_log` таблицата. За да потвърдя че webhooks са конфигурирани правилно, трябва Shopify admin достъп.
4. **Real-time race condition при бързо switch между markets** — SWR `keepPreviousData` guard е на място, но може да се видят edge cases само в живо тестване.

---

## Положителни изненади

- **W3 одита е наполовина изпълнен.** Tier 1 находките (§2.1-2.8) са адресирани: правилна NaN guard, accumulate multi-binding, Sofia timezone, allowlist regex, "типична сряда" gender agreement, vsTypical clamp, preserve last_synced_at. Проверих git log-а — 16 post-W3 commit-а.
- **`resolveAllHomeMarkets` прави graceful degradation.** Ако един пазар е unseeded, Home рендира 2 cards + skip, не blank. Rare good practice за early-stage платформа.
- **Action-cards integration е генуиново end-to-end.** `agent_briefs` таблицата → Claude Sonnet 4.6 с forced tool-use → pending cards → scale/pause/dismiss mutation routes → status update. По-зряло от очакваното за W4.
- **MARKET_THRESHOLDS тунингът е добре мотивиран.** Коментарът на `src/app/api/cron/agent-briefs/route.ts:189-198` обяснява защо GR има higher spend floor (€50 vs BG €30) — проблемът с 2-purchase signal на €12.64 spend е реален и решен разумно.
- **Логърът е изцяло мигриран в `src/app/api/*`.** Няма нито един `console.error`/`console.log` в api route-овете.
- **TypeScript strict е чист.** `npm run typecheck` минава.
- **Meta rate-limit parseBucHeader в cron.** Core path-ът е защитен, дори user path да не е.

---

## Recommended attack order (моя препоръка — не изпълнявам)

1. **Спри P0.1 кървеенето** — Vercel cron route `/api/cron/refresh-aggregates` + еднократен ръчен `SELECT refresh_daily_aggregates('store_ro')` и за другите два. Timeframe: 1-2 часа.
2. **Ротирай секрети P0.2** — delete `qa-*` files, roll service_role ключа в Supabase dashboard, Shopify API token regenerate. Timeframe: 30 мин.
3. **Conf Shopify webhooks** за 3-те магазина (Shopify admin). Timeframe: 15 мин.
4. **P1.1 Meta multi-store refresh** — преди да е станал юли. Timeframe: 2-3 часа.
5. **P1.3 legacy Shopify KPIs** — mark endpoint-а като deprecated, мигрирай `DataProvider.tsx` + agent-context. Timeframe: 2-3 часа.
6. **P1.7 + P1.8** — mass replace "лв" → "EUR", английски статуси → български. Timeframe: 30 мин.
7. **P1.4** — webhook freshness + 5xx вместо 200 при DB fail. Timeframe: 1 час.
8. **Останалите P1-и** (CSP unsafe-inline, BUC rate limit, StoreCard §4.4/17/18) — в следващ sprint.
