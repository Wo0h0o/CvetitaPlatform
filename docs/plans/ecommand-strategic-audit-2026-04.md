# ECOMMAND — Стратегически Одит и Roadmap
## Април 2026 | Синтез от 7-агентен анализ

---

## I. Какво имаме (верифицирано от кода)

| Област | Статус | Детайли |
|--------|--------|---------|
| **Sales Hub** | ✅ Production | Multi-store KPIs, trend, top products, orders table, store detail pages. Чете от Supabase per-store schemas. |
| **Onboarding Wizard** | ✅ Production | 4-стъпков wizard: basics → credentials → test → sync. Автоматично създава schema + credentials. |
| **Data Pipeline** | ✅ Production | Shopify webhooks → append-only orders → aggregate refresh. Backfill sync за 90 дни. |
| **Ads (Meta)** | ⚠️ Live API only | Чете директно от Meta Ads API. Не съхранява в DB. Работи за 1 ad account. |
| **Traffic (GA4)** | ⚠️ Live API only | Чете директно от GA4. Не съхранява. 1 property. |
| **Email (Klaviyo)** | ⚠️ Live API only | Чете flows/campaigns. Не съхранява. 1 account. |
| **AI Agents** | ⚠️ Single-store | Morning report, ad creator, ads-intel, chat — всички виждат само BG данни. |
| **Products, Customers, Traffic pages** | 🔴 Single-store | Четат от Shopify GraphQL/REST за BG. Не са multi-store. |
| **Settings** | 🔴 Placeholder | Профил формата не записва. Stores page е нов и работи. |
| **HR Hub** | 🔴 Не съществува | Нищо изградено. |

### Инфраструктура
- **Supabase Free**: 3 per-store schemas (store_bg, store_gr, store_ro), ~70MB от 500MB
- **Vercel Hobby**: 60s timeout (sync-ът изисква локално пускане за >500 поръчки)
- **35 API routes**, 21 pages, 31 components, 5 SQL миграции
- **Security debt**: HMAC webhook verification disabled

---

## II. Какво казват агентите (консенсус + разногласия)

### Консенсус (5/5 агента се съгласяват)

1. **HMAC верификацията трябва да се включи ВЕДНАГА** — не заради хакери, а заради data integrity. Без нея не можеш да различиш истински Shopify webhook от garbage request. Цена: 30 минути (нужен е само client_secret от Shopify).

2. **AI агентите трябва да виждат multi-store данни** — `agent-context.ts` вика стари single-store dashboard routes. `sales-queries.ts` вече има multi-store функции, но не са свързани с AI-а.

3. **Meta Ads + GA4 данни трябва да се съхраняват в DB** — live API calls от dashboard удрят rate limits и са бавни. Daily snapshots решават и двата проблема.

4. **Vercel Hobby timeout е реален blocker** — 60s не стига за sync на магазин с >500 поръчки. Pro ($20/мес) дава 300s.

### Разногласия (adversarial агентите оспорват)

| Тема | Изследователски агенти | Adversarial агенти | Моята оценка |
|------|----------------------|-------------------|-------------|
| **Schema миграция** (per-store → store_id) | "Направете веднага, преди store #4" | "YAGNI при 3 магазина. Fan-out pattern работи. Миграцията е 5-7 седмици и рискована." | **Adversarial-ите са прави.** Текущата архитектура работи. Миграция при 6-8 магазина. |
| **Canonical product catalog** | "Направете Master SKU mapping table" | "Over-engineering за 160 продукта. Просто добавете `master_sku` колона." | **Adversarial-ите са прави.** Проста колона сега, пълен каталог при 1000+ SKU. |
| **Upgrade до Pro** | "При 3+ магазина" | "Реалният bottleneck е Vercel timeout, не storage. 70MB от 500MB." | **И двете страни имат точки.** Vercel Pro е нужен СЕГА за sync. Supabase Pro може да чака. |
| **DLQ + circuit breakers** | "Критични за resilience" | "YAGNI при 50 webhooks/ден. `webhook_log` вече е де факто DLQ." | **Adversarial-ите са прави.** Просто добавете retry бутон за failed webhooks. |
| **HR Hub** | "Един от ключовите модули" | "Използвайте Google Sheets. Фокус върху revenue." | **Adversarial-ите са прави.** HR Hub е луксозен, не критичен. |

---

## III. Systems Thinking анализ (Meadows framework)

### Stocks и Flows

```
INFLOWS                              STOCKS                          OUTFLOWS
────────                             ──────                          ────────
Shopify webhooks ──────────────────→ Orders DB (2,747 rows) ───────→ Daily Aggregates
Shopify API backfill ──────────────→ Products DB (476 rows) ───────→ AI Agent Context
Meta API (live, no storage) ───────→ (nothing stored) ─────────────→ Dashboard (stale)
GA4 API (live, no storage) ────────→ (nothing stored) ─────────────→ Dashboard (stale)
Klaviyo API (live, no storage) ────→ (nothing stored) ─────────────→ Dashboard (stale)
```

**Ключов проблем**: Meta, GA4 и Klaviyo данните "протичат" без да оставят следа. Няма исторически тренд, няма comparison, няма anomaly detection.

### Feedback Loops

**R1 (Reinforcing — растеж)**: Повече магазини → повече данни → по-богат AI контекст → по-добри решения → повече revenue → повече магазини.
*Статус: Прекъснат. AI-ът вижда само BG.*

**B1 (Balancing — ограничение)**: Vercel 60s timeout спира sync-а. Supabase free tier ще спре при ~25,000 поръчки с raw_payload.
*Статус: Активен. Вече пречи.*

**B2 (Balancing — silent failure)**: Meta token expire → cron refresh → но само 1 cron/ден на Hobby. Ако fail-не, утре няма Meta данни.
*Статус: Тиктакаща бомба.*

### Leverage Points (подредени по impact)

| # | Leverage Point | Effort | Impact | Meadows ниво |
|---|---------------|--------|--------|-------------|
| 1 | **HMAC fix** — client_secret от Shopify → включи верификация | 30 мин | 10/10 | Правила на системата |
| 2 | **AI ↔ multi-store** — свържи `sales-queries.ts` с `agent-context.ts` | 1-2 дни | 9/10 | Информационни потоци |
| 3 | **Vercel Pro** — 300s timeout, повече cron jobs | $20/мес | 8/10 | Параметри (buys time) |
| 4 | **Meta Ads daily ETL** — съхранявай в DB, не fetch live | 3-4 седмици | 8/10 | Stocks (нов stock) |
| 5 | **Health check + Slack alert** — `/api/cron/health` | 0.5 ден | 7/10 | Feedback loops |
| 6 | **Data freshness в UI** — покажи `refreshed_at` | 0.5 ден | 7/10 | Информационни потоци |
| 7 | **GA4 daily ETL** — съхранявай в DB | 2-3 седмици | 7/10 | Stocks (нов stock) |
| 8 | **Aggregate debounce** — batch refresh, не per-webhook | 2-3 дни | 6/10 | Flow регулиране |

---

## IV. Реалистичен Roadmap (6 месеца)

### Месец 1: Secure + Stabilize

| Седмица | Задача | Effort | Deliverable |
|---------|--------|--------|-------------|
| 1 | HMAC fix — вземи client_secret от всички 3 Shopify apps | 30 мин | Webhook integrity |
| 1 | Vercel Pro upgrade ($20/мес) | 1 час | 300s timeout, повече crons |
| 2 | Health check endpoint + Slack alert cron | 1 ден | `/api/cron/health` → Slack |
| 2 | Data freshness badge в Sales Hub UI | 0.5 ден | `refreshed_at` на всяка карта |
| 3-4 | AI агенти → multi-store: свържи `sales-queries.ts` с `agent-context.ts` | 1-2 седмици | Morning report вижда BG+GR+RO |

### Месец 2: Meta Ads в DB

| Седмица | Задача | Effort | Deliverable |
|---------|--------|--------|-------------|
| 5-6 | Таблица `ad_daily_metrics` + Meta ETL cron | 2 седмици | Daily ad spend/ROAS в DB |
| 7-8 | Ads Hub рефактор — чете от DB вместо live API | 1-2 седмици | Per-store ad performance |

### Месец 3: GA4 в DB + Products

| Седмица | Задача | Effort | Deliverable |
|---------|--------|--------|-------------|
| 9-10 | Таблица `ga4_daily_metrics` + GA4 ETL cron | 2 седмици | Sessions, traffic sources в DB |
| 11-12 | Добави `master_sku` колона в products + прост matching | 1 седмица | Cross-store product comparison |
| 12 | Traffic page рефактор — чете от DB | 1 седмица | Per-store traffic |

### Месец 4: Разширяване

| Седмица | Задача | Effort | Deliverable |
|---------|--------|--------|-------------|
| 13-14 | Per-store Meta/GA4 credentials в `store_credentials` (вместо env vars) | 1-2 седмици | Всеки магазин с отделен ad account + GA4 |
| 15-16 | Ads Hub: campaign management, budget tracking | 2 седмици | Пълен Ads Hub |

### Месец 5: Оценка + решение

| Точка | Въпрос | Действие |
|-------|--------|----------|
| Колко магазина имаме? | Ако <5 → продължи с per-store schemas | Ако ≥6 → планирай schema миграция |
| GR/RO генерират ли revenue? | Ако да → инвестирай в platform | Ако не → фокус върху бизнеса, не инженерството |
| Supabase storage >300MB? | Ако да → upgrade до Pro ($25/мес) | Ако не → остани на Free |

### Месец 6: Buffer

- Bug fixes от месеци 1-4
- Schema миграция planning (ако е нужна)
- Нови магазини (HU, HR, RS) ако бизнесът го изисква

---

## V. Какво НЕ правим (и защо)

| Идея | Защо не сега |
|------|-------------|
| Schema миграция (per-store → store_id) | Текущият fan-out pattern работи за 3-7 магазина. Миграцията е 5-7 седмици effort и рискована. Правим я при 6-8 активни магазина. |
| Canonical product catalog (full) | 160 продукта. `master_sku` колона е достатъчна. Пълен каталог при 1000+ SKU. |
| HR Hub | Не е core business need. Google Sheets/Notion е адекватен. |
| Message queue (Redis/BullMQ) | 50 webhooks/ден. Serverless + webhook_log е достатъчно. |
| Circuit breakers | `fetchWithTimeout` + `Promise.allSettled` вече покриват graceful degradation. |
| Analytics warehouse (ClickHouse/BigQuery) | PostgreSQL обслужва 2,700 поръчки за <100ms. YAGNI до 100K+ поръчки. |
| Supabase Pro | Storage е 70MB от 500MB. Upgrade когато Meta/GA4 ETL заема >300MB. |

---

## VI. Критични архитектурни правила (за всички бъдещи решения)

1. **Revenue води инженерството, не обратното.** Не строим за 10 магазина, докато 3-ят не е доказал product-market fit.

2. **Incremental > Big-bang.** Всяко изменение трябва да може да се deploy-не самостоятелно. Никога "спираме всичко за 5 седмици миграция."

3. **Всеки нов stock (DB таблица) изисква rollback план.** Какво правим ако ETL-ът се счупи? Кой го оправя?

4. **ETL scope трябва да е explicit.** "Съхранявай Meta данни в DB" не е spec. "Съхранявай daily spend/impressions/clicks/conversions per campaign per ad account" е spec.

5. **Per-store schemas остават докато не пречат.** `Promise.all(schemas.map(...))` fan-out pattern е чист и работи. Schema миграцията се прави само когато cross-store JOINs стават чести и болезнени.

6. **Системата трябва да дише.** Всяко ново парче (ETL, schema, endpoint) трябва да има: health check, error logging, graceful degradation, и ясен owner.
