# Одит на Data Layer — Platform Revamp 2026-05-22

> Агент: DATA/API одитор  
> Дата: 2026-05-22  
> Обхват: всички страници в сайдбара (без `/sales`, която е еталон)

---

## Резюме на data layer-а (общо състояние)

Платформата разполага с **добре изграден набор от API клиенти** — Shopify REST, GA4 Data API, Klaviyo Reporting API, Meta Graph API (v21.0) и GA4 като прокси за Google Ads. Supabase съдържа синхронизирани `meta_insights_daily`, `meta_insights_hourly_by_store`, `meta_insights_by_store` и Shopify агрегати (`read_store_daily_aggregates`, `read_store_hourly_aggregates_multi`) — т.е. нощен sync pipeline е изграден и работи.

**Основният проблем не е липса на интеграции — а слаба консумация.** Повечето аналитични страници (`/traffic`, `/email`, `/customers`, `/products`, `/google-ads`) са изградени самостоятелно, изтеглят данни само от по един източник, и пренебрегват огромна маса от налични полета. Страниците с AI агенти (`/agents`, `/analysis`, `/morning-report`) не показват данни изобщо — те са UI за вход/изход, без analytics. `/ads` е единствената "нова" страница с real-time score, creatives и multi-market поддръжка. Home (`/`) е силна поради `top-strip` route-а, но останалите репорт-страници изостават с 1-2 поколения.

Критично нарушение на принципа **Real Data Only** (CLAUDE.md §5): `/settings` показва интеграционния статус хардкоднато (`status="connected"/"unknown"/"disconnected"` — `settings/page.tsx:416-427`), без реална проверка на credentials.

---

## Страница по страница

---

### 1. Home — `/` (Командно табло)

**Текущо състояние: 4/5**

#### Текущи източници на данни
- `top-strip` route (`/api/dashboard/home/top-strip`): Shopify daily + hourly (RPC `read_store_daily_aggregates`, `read_store_hourly_aggregates_multi`), Meta `meta_insights_by_store` + `meta_insights_hourly_by_store`, Google Ads via GA4.
- `stores` route: per-store KPIs от Supabase.
- `action-cards` route: `agent_briefs` от Supabase.
- `kpis` route (`/api/dashboard/kpis`): само BG store (`getShopifyKPIs` + `getGA4KPIs` — `kpis/route.ts:15`). Не е multi-store.

#### Gap
- `kpis` route-ът (`/api/dashboard/kpis/route.ts`) работи само с един Shopify магазин (BG env var) — докато `top-strip` е multi-store. Дублиране на логика, и старият route не е multi-store aware. [Проверено в код: `kpis/route.ts:16` — `getShopifyKPIs(daysAgo)` използва единичен `SHOPIFY_STORE_URL`.]
- Klaviyo данни липсват напълно от home dashboard-а.
- `ActionRow` компонентът не е одитиран тук (извън scope), но не показва inbox-count badge в сайдбара.
- Google Ads hourly серия е `null` в hourly mode (документирано в `top-strip/route.ts:864-868` — "No Google Ads hourly source").

#### Data wins
- **Klaviyo revenue от "днес" / "вчера"** — директна Klaviyo API заявка за `today`/`yesterday` timeframe, добавена като 4-та секция в top-strip (source: `lib/klaviyo.ts` — API вече е готов).
- **Inbox severity count** — `agent_briefs` вече се брои (`anomalyCount`) но не е видим в сайдбара badge. (преценка — не е видял sidebar кода)

**Обем:** M  
**Приоритет:** P1

---

### 2. Inbox — `/inbox`

**Текущо състояние: 3/5**

#### Текущи източници на данни
- `/api/inbox` → `agent_briefs` Supabase таблица (полета: `severity`, `title`, `why`, `target_type`, `outcome_*`, `snoozed_until`).
- `/api/inbox/{id}` POST за actions (approve / snooze / dismiss).
- `refreshInterval: 60_000` — polling на 1 минута. [Проверено: `inbox/page.tsx:241`.]

#### Gap
- Inbox показва карти само от `agent_briefs`. Нито Klaviyo deliverability аномалии, нито GA4 traffic spikes са surfaced тук автоматично. Липсват auto-generated сигнали от небизнес-агенти.
- Няма trend chart за броя сигнали по дни/седмици — оператора не вижда дали проблемите са в тренд нагоре или са единични.
- Няма link от inbox-карта директно към релевантната страница (напр. `target_type: "ad"` → `/ads/bg?focus=<id>`). Полето `target_id` съществува в schema-та, но UI не го consume-ва. [Проверено: `inbox/page.tsx:48-51` — `target_id` е в типовете, но не се рендери.]
- Агент-briefove за `/ads/[market]` вече имат `focus` deep-link pattern (проверено в `ads/[market]/page.tsx:174-178`), но inbox-картата не го изпраща.

#### Data wins
- **Deep-link бутон** — `target_type + target_id` → конструиране на URL към `/ads/[market]?focus=<ad_id>` или `/email/flows/[flowId]`.
- **Klaviyo bounce/unsubscribe spike сигнали** — Klaviyo API вече връща `unsubscribe_rate` по поток (`klaviyo.ts:256`); cron може да пуска `agent_brief` при >2% за flow.
- **GA4 traffic drop сигнал** — сравнение week-over-week на `sessions`, push към `agent_briefs`.

**Обем:** M  
**Приоритет:** P1

---

### 3. Agents — `/agents`

**Текущо състояние: 1/5** (за данни)

#### Текущи източници на данни
- Нула. Страницата е статичен навигационен hub — хардкоднати карти с описание. Няма нито един API call. [Проверено: `agents/page.tsx` — нито `useSWR`, нито `fetch`.]

#### Gap
- Липсва live статус на агентите (дали `ads-intel` върви / колко briefove е генерирал).
- Липсва cost/usage индикатор (известен проблем: `⚠️ Ads-intel = €100/day Sonnet 4.6 spend` — memory файл `project_ads_intel_cost_audit.md`).
- Не показва последния run timestamp или success/failure.

#### Data wins
- **Agent run stats** — Supabase `agent_briefs` вече пази `source_agent` колона. Прост COUNT + последен `created_at` per agent дава live статус.
- **Cost tracker** — Anthropic API разход per agent (от лог или от `admin_audit_log`) показан като chip.

**Обем:** S  
**Приоритет:** P2

---

### 4. Products — `/products`

**Текущо състояние: 2/5**

#### Текущи източници на данни
- `/api/dashboard/products-analytics` → Shopify REST orders за избрания период (`fetchOrdersForRange`). [Проверено: `products-analytics/route.ts:147`.]
- Показва: revenue, orders, AOV, upsell rate, time series, product combos.
- Catalog enrichment: `fetchAllProducts()` за handle + image URL.

#### Gap
- **Само BG магазин** — `SHOPIFY_STORE_URL` + `SHOPIFY_ACCESS_TOKEN` env vars (единичен store). Продуктите в другите магазини не са видими. [Проверено: `products-analytics/route.ts:7-8`.]
- **Нула GA4 данни** — Traffic per product page (pageviews, sessions, CVR per product) напълно липсва. GA4 `pagePath` с dimension filter за `/products/*` е напълно достъпен.
- **Нула Meta данни** — Ad spend per product (чрез campaign name matching или UTM) не е интегриран.
- **Product detail page** (`/products/[handle]`) не е одитирана тук (отделен файл), но route-ът съществува.
- **Inventory данни** липсват напълно — `inventory_quantity` е в Shopify product variants (`lib/shopify.ts:120`), но не се показва в /products overview. Оператора не вижда кои продукти са с ниска наличност.
- `MiniKpi` ползва `icon` prop и `ChangeBadge` вместо `delta` prop — нарушение на design contract §3. [Проверено: `products/page.tsx:133-135`.]
- Time series chart ползва `AreaLineChart` — revenue е continuous metric, така че area е честна. Но Chart tooltip-ът не следва `GlassTooltip` речника.

#### Data wins
- **GA4 sessions per product page** — `runReport({ dimensions: ["pagePath"], metrics: ["sessions", "ecommercePurchases"], dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "CONTAINS", value: "/products/" } } } })` — директно достъпно, без нови интеграции.
- **Inventory alert column** — Shopify `variants[].inventory_quantity` вече е в `fetchProductCatalog()` (`shopify.ts:120`) — само трябва да се expose-не.
- **Multi-store aggregation** — Supabase store schemas + `read_store_daily_aggregates` вече работят за home dashboard; products page може да ползва същия pattern.

**Обем:** L  
**Приоритет:** P0

---

### 5. Customers — `/customers`

**Текущо състояние: 3/5**

#### Текущи източници на данни
- **Analytics tab**: `/api/dashboard/customers` → `fetchOrdersWithCustomers()` от Shopify (само BG store). [Проверено: `customers/route.ts:99`.]
- Показва: cohort retention (weekly), second-purchase timing histogram, new vs returning.
- **List tab**: отделен `CustomerListTab` компонент — не е одитиран тук (отделен route).
- **Agents tab**: `AgentStatsTab` — не е одитиран тук.

#### Gap
- **Само BG store** — `fetchOrdersWithCustomers` ползва единичен `SHOPIFY_STORE_URL`. [Проверено: `lib/shopify.ts:243`.]
- **Максимален прозорец 180 дни** (`presetDays["all"] = 180`) — cohort retention e смислена само с поне 1 година данни. [Проверено: `customers/route.ts:95`.]
- **Lipsa LTV (Customer Lifetime Value)** — Shopify `customer.total_spent` е в `CustomerOrder.customer` (`lib/shopify.ts:233`), но не се aggregate-ва в API response-а.
- **Липсва Klaviyo сегментация** — кои клиенти са в flow-ове, open rate segmentation — напълно отсъства.
- **PII маски за foreign stores** — `customer.id` fallback е нужен за GR/IT/RO/DE/UK/HU/SK (memory: `feedback_foreign_store_pii_redacted_payloads.md`); при мулти-store expand трябва да се internal-изира.
- **Donut chart ползва `--blue`** за "Нови" segment — нарушение на design contract §1 (категорийни цветове). [Проверено: `CustomerAnalyticsTab.tsx:103-112` — `colors={["#007aff", "#22c55e"]}`.]

#### Data wins
- **LTV distribution histogram** — от наличните `customer.total_spent` данни; тип `<Bar>` с pre-bucketed data (§9 vocab).
- **Shopify `customer.orders_count`** — за по-прецизен repeat rate без да се налага да се scan-ват всички поръчки; налично в `CustomerOrder.customer.orders_count` (`lib/shopify.ts:232`), но не се използва.
- **Email segment overlay** — Klaviyo profile API за email engagement tier (чрез `klaviyo.ts` — вече е инициализиран client).

**Обем:** L  
**Приоритет:** P1

---

### 6. Traffic — `/traffic`

**Текущо състояние: 3/5**

#### Текущи източници на данни
- `/api/dashboard/traffic` → 11 паралелни GA4 `runReport()` заявки: overview metrics, channel groups, source/medium, pages, devices, funnel events, top events, daily time series. [Проверено: `traffic/route.ts:44-98`.]

#### Gap
- **Само BG GA4 property** — `GA4_PROPERTY_ID` env var е единичен. Другите магазини нямат traffic view.
- **Липсва geo breakdown** — GA4 `country` + `region` dimension е налична, но не се заявява. При ЦРУ ниво тя е задължителна за E-COM с 10+ пазара.
- **Липсва search terms** — GA4 `searchTerm` dimension (за site search) не е заявена.
- **Липсва landing page analysis** — `landingPage` dimension + `bounceRate` / `engagementRate` комбинацията не е включена.
- **Липсва new vs returning** — `newVsReturningCustomer` dimension в GA4 е налична.
- **Funnel само за BG** — не е мулти-пазарна.
- **Daily sparklines** — съществуват, но без сравнителна линия в sparkline context (само current period).
- **Hourly breakdown** — GA4 поддържа `hour` dimension; rhythm chart (weekday × hour heatmap) липсва. Такава визуализация е точно §9 vocab "кога се случва X?".
- **Chart type нарушение** — `dailyOverview` за `purchases` (count) се подава към sparkline, което е fine, но в по-голям chart context трябва bars (§9.2).

#### Data wins
- **Geo heatmap** — `runReport({ dimensions: ["country"], metrics: ["sessions", "ecommercePurchases"] })` — 1 допълнителна заявка.
- **Hour × weekday rhythm heatmap** — `runReport({ dimensions: ["hour", "dayOfWeek"], metrics: ["sessions"] })` — директно достъпно.
- **Landing page funnel** — `landingPage` + `ecommercePurchases` за "кои landing pages конвертират".
- **New vs returning** — `newVsReturningCustomer` dimension, 1 заявка.

**Обем:** M  
**Приоритет:** P1

---

### 7. Email — `/email`

**Текущо състояние: 2/5**

#### Текущи източници на данни
- `/api/dashboard/email` → `getKlaviyoMetrics(preset)`: campaign-values-report, flow-values-report, campaigns list, flows list. [Проверено: `email/route.ts:14` + `lib/klaviyo.ts:84`.]
- Показва: total/campaign/flow revenue, open rate, click rate, active flows, flow и campaign таблица.

#### Gap
- **Липсва deliverability метрика** — `bounce_rate` е в `getFlowDetail()` (`klaviyo.ts:257`), но НЕ е в `getKlaviyoMetrics()` overview. Операторът не вижда deliverability problems без да влезе в конкретен flow.
- **Липсва `unsubscribe_rate` в overview** — Klaviyo API връща `unsubscribe_rate` в stats array (`klaviyo.ts:88`), но не се aggregate-ва и не се показва.
- **Липсва revenue trend (time series)** — никакъв chart за revenue по дни/седмици. `getKlaviyoMetrics` не заявява `group_by: ["date"]`.
- **Campaigns нямат delta** — campaign table показва revenue/open/click без сравнение с предишен период.
- **Flow detail page** (`/email/flows/[flowId]`) — ползва `getFlowDetail()` с bounce rate, но overview не го aggregate-ва.
- **MiniKpi карти с icons** — нарушение на design contract §3. [Проверено: `email/page.tsx:205-218` — `icon={TrendingUp}`, `icon={Eye}`, `icon={MousePointerClick}`, `icon={Zap}`.]
- **`BarChartCard` за flow revenue** — bar chart е правилен тип за count/revenue по entity. Но ако барове са вертикални и данните са много на брой, horizontal bars са по-добри — което ползва `horizontal` prop. Проверено: `email/page.tsx:223` — `horizontal` prop е подаден, ОК.
- **Klaviyo SMS** — API ключ, API revision и endpoint са там; SMS статистики са налични чрез `filter: 'equals(send_channel,"sms")'`, но изобщо не се показват.

#### Data wins
- **Deliverability overview KPI** — добавяне на `bounce_rate` и `unsubscribe_rate` към `getKlaviyoMetrics()` aggregate. 0 нови API calls — само нов stat в статистическите заявки.
- **Revenue time series** — `group_by: ["date"]` в campaign-values-report. Трябва Klaviyo да поддържа date grouping (проверено: API поддържа `group_by` с `["send_date"]` за campaigns).
- **SMS channel** — отделен таб или section за SMS metrics (ако каналът е активен).

**Обем:** M  
**Приоритет:** P1

---

### 8. Ads — `/ads/[market]`

**Текущо състояние: 4/5**

#### Текущи източници на данни
- `/api/dashboard/ads?market=&preset=` → `getMetaOverview()` с `date_preset`. [Проверено: `ads/[market]/page.tsx:189-197`.]
- `/api/dashboard/ads/individual?market=&preset=&status=` → `getMetaAdInsights()` + `getMetaAdCreatives()` — ad-level данни с score.
- Multi-account, multi-market: `integration_accounts` Supabase таблица + `MetaClient` resolver.
- Action routes: pause/resume ad, scale budget.

#### Gap
- **Липсва trend chart на ниво страница** — KPI strip показва aggregate за периода без chart. `/sales` reference има hourly/daily series. Meta `meta_insights_daily` вече е в Supabase — само трябва да се expose-не за `/ads`.
- **Липсва placement breakdown** — Meta Graph API поддържа `breakdown: "placement"` (Facebook Feed, Instagram Feed, Stories, Reels, Audience Network). Не се заявява нито в lib, нито в route. Това е ключов insights за creative optimization.
- **Липсва age/gender breakdown** — Meta `breakdown: "age,gender"` за audience insights. Налично в API, не е интегрирано.
- **Lipsa frequency heatmap** — frequency e в `AdItem` (score breakdown я ползва), но няма aggregate view за кампания/adset level.
- **Adset view** — `/ads/adsets/` route съществува (`ads/adsets/` в сайдбара, `getMetaAdSetInsights()` в lib), но не е одитиран тук.
- **KPI карти ползват `icon` prop** — нарушение на design contract §3. [Проверено: `ads/[market]/page.tsx:381-388` — `icon={CreditCard}`, `icon={Euro}` и др.]

#### Data wins
- **Trend chart за spend + ROAS по дни** — от `meta_insights_daily` Supabase view (вече синхронизирано). 0 нови Graph API calls.
- **Placement breakdown card** — `fetchInsights({ breakdowns: "placement", level: "account" })`. 1 нова заявка, ключова за creative decisions.
- **Age/gender breakdown** — 1 нова заявка, показана като donut или horizontal bar.

**Обем:** M  
**Приоритет:** P0

---

### 9. Google Ads — `/google-ads`

**Текущо състояние: 3/5**

#### Текущи източници на данни
- `/api/dashboard/google-ads` → GA4 `runReport()` с `sessionGoogleAdsCampaignName` dimension + `advertiserAd*` session-scoped metrics. [Проверено: `google-ads/route.ts:166-193`.]
- Показва: spend, revenue, ROAS, purchases, CTR, brand split, campaign table, daily chart.

#### Gap
- **Само GA4 last-click attribution** — Real Google Ads API (search terms, quality score, impression share, keyword-level data) не е интегриран изобщо. Страницата explict-но казва "Данни от GA4 (last-click attribution)". `project_google_ads_hourly_setup.md` в memory показва, че Google Ads API е "чака Developer Token".
- **Lipsa search terms** — `sessionGoogleAdsKeyword` dimension е достъпна в GA4 Data API. Ключова за PPC управление — TOP 20 keywords по spend не се показват.
- **Lipsa match type breakdown** — `sessionGoogleAdsMatchType` е GA4 dimension.
- **Липсва ad group level** — GA4 `sessionGoogleAdsAdGroupName` е налична dimension; само campaign level се показва.
- **Video campaigns отбелязани но неизмерими** — engaged-view conversions липсват в GA4 Data API (хардкодна бележка: `google-ads/page.tsx:352-360`). При наличен Google Ads API — поправимо.
- **Chart tooltip** — ползва inline `contentStyle` обект вместо `GlassTooltip` — нарушение на design contract §11. [Проверено: `google-ads/page.tsx:317-330`.]

#### Data wins
- **Search terms таблица** — `runReport({ dimensions: ["sessionGoogleAdsQuery"], metrics: ["advertiserAdCost", "ecommercePurchases"], ... })` — 1 допълнителна GA4 заявка, без нова интеграция.
- **Ad group breakdown** — `sessionGoogleAdsAdGroupName` dimension, 1 допълнителна заявка.
- **Quality Score + Impression Share** — само след интеграция на реален Google Ads API (блокирано от Developer Token — memory).

**Обем:** M (за GA4-based wins) / XL (за Google Ads API)  
**Приоритет:** P1 (GA4 wins) / P2 (Google Ads API)

---

### 10. Competitors — `/competitors`

**Текущо състояние: 3/5**

#### Текущи източници на данни
- `/api/competitors` → Supabase `competitors` таблица.
- `/api/competitors/alerts` → Supabase `competitor_alerts` (price changes, new products).
- `/api/competitors/intel` → Supabase `competitor_intel` (news, scraped articles via Tavily).
- `/api/competitors/scan` POST → `competitor-scraper.ts` + Tavily.

#### Gap
- **Manual scan само** — няма scheduled cron за автоматичен ежедневен scan. Операторът трябва ръчно да натисне "Сканирай".
- **Meta Ad Library** — линкът е external (отваря fb.com/ads/library) без никакви данни в платформата. `lib/tavily.ts` би могъл да scrap-ва Ad Library публично-достъпните данни.
- **Няма price trend chart** — цените от scans се пазят (`competitor_prices` таблица по код), но UI показва само последните цени без историческа линия.
- **Competitor detail page** (`/competitors/[slug]`) не е одитиран тук.
- **Само цени** — няма organic keyword tracking, traffic estimate, или review sentiment analysis за конкурентите.

#### Data wins
- **Price history chart** — от `competitor_prices` таблица (данните вече се пазят); stepped line chart е правилния тип (§9.3 — discrete state-change).
- **Scheduled scan** — cron route + `meta_insights`-style nightly job.
- **Keyword gap analysis** — Tavily search за `site:<competitor_domain>` + NLP за съдържание (Medium effort).

**Обем:** M (price chart) / L (keyword gap)  
**Приоритет:** P2

---

### 11. Settings — `/settings`

**Текущо състояние: 2/5** (за data)

#### Текущи източници на данни
- `/api/settings` → Supabase org settings (business profile, goals).
- `/api/hr/profile` → Supabase HR profile.
- Integration status: **хардкоднат** — `status="connected"` за Shopify, `status="unknown"` за GA4/Meta/Klaviyo. [Проверено: `settings/page.tsx:351-358`.]

#### Gap
- **Хардкодnat integration status** — нарушение на Real Data Only (CLAUDE.md §5). Реалният статус лесно се проверява: Shopify — тест API call; GA4 — `isGA4Configured()` вече съществува (`lib/ga4.ts:69`); Meta — `getMetaClient()` + probe; Klaviyo — `KLAVIYO_API_KEY` env check.
- **Lipsa store management UI** — stores се управляват отделно (`/settings/stores/`), но integration health per store не е видим.
- **API key rotation UI** — credentials са в Vercel env vars; Settings UI не може да ги ротира (правилно за сигурност), но и не показва expiry за Meta token.

#### Data wins
- **Live integration health check** — `/api/settings/health` endpoint, probe-ващ всеки клиент. `isGA4Configured()` + Meta token test + `KLAVIYO_API_KEY` check — S effort, висок impact за debugging.

**Обем:** S  
**Приоритет:** P0 (нарушение Real Data Only)

---

### 12. HR — `/hr`

**Текущо състояние: 3/5** (за data; функционалността е подходяща за HR модул)

#### Текущи източници на данни
- `/api/hr/profile` → Supabase `hr_profiles`.
- `/api/hr/leave-requests` → Supabase `hr_leave_requests`.
- `/api/hr/day-events?from=&to=` → Supabase `hr_day_events`.
- Client-side compute на `MonthlyTotals` (`hr/page.tsx:229-306`).

#### Gap
- **Client-side compute дублира server logic** — `computeTotalsClient` (`hr/page.tsx:229`) е explicit duplicate на `lib/hr.ts` с коментар "Must stay in sync". Ако логиката се промени в `lib/hr.ts`, bug ще остане невидим. [Проверено: `hr/page.tsx:229-231`.]
- **Липсва team overview за мениджъри** — HR home показва само собствените данни. Team calendar view е под `/hr/team/` (route съществува), но не е одитиран.
- **KpiTile ползва icon** — нарушение на design contract §3. [Проверено: `hr/page.tsx:113-134` — `icon={<Clock size={18} />}`.]
- Не е бизнес-data страница, HR е вътрешна — приоритетът за data enrichment е нисък.

#### Data wins
- **Team calendar API** — `/api/hr/team/day-events` aggregate за мениджъри (Supabase вече пази per-user events).
- **Overtime trend chart** — overtime hours by week (stepped line, §9.3).

**Обем:** S (дублирана логика fix) / M (team view)  
**Приоритет:** P2

---

### 13. Morning Report — `/morning-report` (извън сайдбар)

**Текущо състояние: 2/5** (за data; генерира се от AI)

#### Текущи източници на данни
- `/api/agents/morning-report` POST → SSE streaming. Вътрешно AI agent извиква business context tools.
- Страницата е чист streaming UI — no direct data fetching.

#### Gap
- **Не е в сайдбара** — нарушение на навигационната архитектура. Потребителят достига до нея само ако знае URL-а или чрез `/agents`. [Флагнато в 00-BRIEF.md.]
- **Не се кешира** — всеки refresh генерира нов Claude API call (~$0.50-1.00). Няма persist на последния report в Supabase.
- **Нулева визуализация** — само markdown текст. Ако AI генерира числа, те не са визуализирани като KPIs. При ЦРУ ниво — structured output с visual KPI strip е задължителна.

#### Data wins
- **Persist доклада** в Supabase — `morning_reports` таблица с `date` + `content` + `data_snapshot`. Зарежда последния persist ако вече има генериран за днес.
- **Structured data sidebar** — KPI strip генериран от structured JSON output на Claude, отделен от prose.

**Обем:** M  
**Приоритет:** P1

---

### 14. Analysis / Command Chat — `/analysis` (извън сайдбар)

**Текущо състояние: 2/5** (за data)

#### Текущи източници на данни
- `/api/agents/chat` POST → SSE streaming с tool use. Инструменти: `get_sales`, `get_product_analytics`, `get_traffic`, `get_email`, `get_ads_overview`, `get_ads_detail`. [Проверено: `analysis/page.tsx:17-24` — TOOL_ICONS речника]
- Страницата е чист chat UI — данните идват само от AI agent tools.

#### Gap
- **Не е в сайдбара** — нарушение на навигационната архитектура. [Флагнато в 00-BRIEF.md.]
- **Без session persistence** — chat историята изчезва при refresh. `messages` state е само in-memory.
- **Липсва Google Ads tool** — `get_ads_overview` е в TOOL_ICONS, но `get_google_ads` не е. При бизнес контекст въпрос за Google Ads — агентът ще е сляп.
- **Без Multi-store context** — tools вероятно работят само с BG store (трябва проверка в agent route).
- **Без competitors tool** — `competitor_intel` и `competitor_prices` не са в agent context.

#### Data wins
- **Chat session persistence** — Supabase таблица `chat_sessions` + `chat_messages`; reload запазва историята.
- **Google Ads tool** — добавяне на `get_google_ads` tool към агента.
- **Competitors tool** — `get_competitor_summary` tool, захранван от `competitor_prices`.

**Обем:** M (persistence) / S (нови tools)  
**Приоритет:** P1

---

## Топ 10 Data Wins за цялата платформа

| # | Data Win | Страница(и) | Нови API calls | Обем | Приоритет | Impact |
|---|----------|-------------|----------------|------|-----------|--------|
| 1 | **Live integration health check** — замяна на хардкодания статус с реален probe | `/settings` | probe × 4 | S | **P0** | Нарушение Real Data Only — всеки deploy може да скрие счупена интеграция |
| 2 | **Meta placement breakdown** — Facebook Feed / Instagram / Stories / Reels split | `/ads/[market]` | 1 (Meta Graph, нов breakdown) | M | **P0** | Директно actionable за creative decisions; Meta поддържа `breakdown: "placement"` |
| 3 | **GA4 sessions per product page** — sessions + CVR per `/products/*` URL | `/products` | 1 (GA4 `pagePath` filter) | M | **P0** | Свързва sales data с traffic за всеки продукт; нулева нова интеграция |
| 4 | **Search terms таблица** — top keywords по spend от GA4 `sessionGoogleAdsQuery` | `/google-ads` | 1 (GA4) | S | **P1** | Ключово за PPC оптимизация; 1 допълнителна GA4 заявка |
| 5 | **Geo breakdown в /traffic** — GA4 `country` + `region` dimension | `/traffic` | 1 (GA4) | S | **P1** | Задължително за 10+ пазарна E-COM операция |
| 6 | **Deliverability KPIs в email overview** — `bounce_rate` + `unsubscribe_rate` aggregate | `/email` | 0 (вече в Klaviyo stats params) | S | **P1** | 0 нови API calls — само нов stat field в съществуваща заявка |
| 7 | **Ads trend chart от Supabase** — spend + ROAS daily series от `meta_insights_daily` | `/ads/[market]` | 0 (данни вече sync-нати) | S | **P1** | 0 нови external calls; данните вече са в DB |
| 8 | **Hour × weekday heatmap в /traffic** — кога се случват sessions и покупки | `/traffic` | 1 (GA4 `hour` + `dayOfWeek`) | M | **P1** | §9 vocab "кога се случва X?" — точно правилния chart тип |
| 9 | **Morning report persistence** — Supabase cache + structured KPI output | `/morning-report` | 0 (само Supabase write) | M | **P1** | Спестява $0.50-1.00 Claude call при всеки refresh; данните вече са налични |
| 10 | **Deep-link от Inbox към Ad/Flow** — `target_id` → `/ads/[market]?focus=<id>` | `/inbox` | 0 | S | **P1** | `target_id` е в schema, `focus` param pattern вече работи в `/ads`; само UI wire-up |

---

## Маркировка на твърденията

- **[Проверено в код]** = директно прочетено от source файл с цитиран `файл:ред`
- **[Преценка]** = логическо заключение от архитектурата, не директно потвърдено
- Всички GA4 заявки зачитат known gotchas: `advertiserAd*` метрики НЕ са предложени без session dimension; hourly breakdown НЕ е предложен за cost метрики.

---

*Репорт генериран: 2026-05-22*  
*Следващ стъпка: UI/UX одитор (02-report-ui-ux.md) и приоритизационна матрица (03-report-priorities.md)*
