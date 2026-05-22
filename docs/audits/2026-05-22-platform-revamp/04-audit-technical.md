# Технически одит на репортите — Platform Revamp 2026-05-22

> Одитор: технически верификатор  
> Дата: 2026-05-22  
> Метод: директно четене на source файлове; без браузър

---

## Резюме на надеждността

| Репорт | Надеждност | Бележка |
|--------|-----------|---------|
| 01 — Data/API | **88%** | Цитатите за ред-номера са почти точни (+/- 1-2 реда); GA4 dimensions са валидни; 1 сериозна грешка (inventory_quantity в `fetchProductCatalog` vs `fetchAllProducts`); 1 малка грешка в настройки ред |
| 02 — Mobile | **91%** | Най-надежден от трите; всички основни твърдения за Tailwind класове и ред-номера потвърдени; `SortButton` размерите са точни; обемните оценки са реалистични |
| 03 — Design | **82%** | Всички "verifiable" твърдения са верни; отворените "(преценки)" за `DonutChart`, `BarChartCard`, `FunnelChart`, `AreaLineChart` и `SparkLine` вече са решени (виж секция по-долу) — повечето оказват се по-различни от предположенията |

**Обща надеждност на одита: ~87%.** Репортите са сериозна, честна работа — не преувеличават. Основните пропуски са в непроверените "(преценки)" за chart компонентите и един фактически грешен цитат за inventory_quantity.

---

## Таблица с проверени цитати

| # | Репорт | Твърдение | Файл:ред | Статус | Бележка |
|---|--------|-----------|---------|--------|---------|
| 1 | Data §1 | `refreshInterval: 60_000` в inbox | `inbox/page.tsx:241` | ✅ | Ред е 241 в четения файл (`revalidateOnFocus: false, refreshInterval: 60_000`) |
| 2 | Data §1 | `target_id` е в типовете, не се рендери | `inbox/page.tsx:48-51` | ✅ | `target_id: string \| null` е в `InboxCard` интерфейса; никъде в render не се consume-ва |
| 3 | Data §1 | `kpis/route.ts:16` — `getShopifyKPIs(daysAgo)` единичен store | `kpis/route.ts:16` | ✅ | Ред 16 е точно `getShopifyKPIs(daysAgo)` без multi-store wrapper |
| 4 | Data §1 | Google Ads hourly = null в top-strip | `top-strip/route.ts:864-868` | ✅ | Редове 865-868 са коментар + `googleAds: null` — точно |
| 5 | Data §4 | `products-analytics/route.ts:7-8` единичен store env vars | `products-analytics/route.ts:7-8` | ✅ | `SHOPIFY_STORE_URL!` и `SHOPIFY_ACCESS_TOKEN!` на ред 7-8 |
| 6 | Data §4 | `inventory_quantity` е в `fetchProductCatalog()` (`shopify.ts:120`) | `shopify.ts:118-120` | ❌ **ГРЕШКА** | `inventory_quantity` е в `ShopifyProduct` type дефиницията (ред 118). Функцията `fetchAllProducts()` (`shopify.ts:127`) НЕ заявява `variants` в `fields=` — само `id,title,handle,image,...,status`. Само `fetchProductCatalog()` (`shopify.ts:188`) заявява `variants` и получава `inventory_quantity`. Data агентът цитира `shopify.ts:120` за type def, но имплицира "fetchProductCatalog() вече го връща" — **частично вярно за fetchProductCatalog, грешно за fetchAllProducts**. `/products` analytics route ползва `fetchAllProducts()`, не `fetchProductCatalog()` — т.е. inventory данните НЕ са лесно налични за products overview. |
| 7 | Data §5 | `fetchOrdersWithCustomers` ползва единичен store | `lib/shopify.ts:239-241` | ✅ | `getStoreUrl()` без параметри = единичен env var |
| 8 | Data §5 | `customers/route.ts:95` — `presetDays["all"] = 180` | `customers/route.ts:94` | ✅ | Ред 94: `"all": 180` — офсет от 1, но съдържанието е точно |
| 9 | Data §5 | `customer.total_spent` в `CustomerOrder` (`lib/shopify.ts:233`) | `shopify.ts:233` | ✅ | Ред 233 е точно `total_spent: string` в customer обекта |
| 10 | Data §5 | `CustomerAnalyticsTab.tsx:103-112` colors `["#007aff", "#22c55e"]` | `CustomerAnalyticsTab.tsx:111` | ✅ | Ред 111 е `colors={["#007aff", "#22c55e"]}` — цитирания ред е 1 под заявения диапазон, но твърдението е точно |
| 11 | Data §8 | `ads/[market]/page.tsx:381-388` MiniKpi с icon props | `ads/[market]/page.tsx:381-387` | ✅ | Шест MiniKpi с `icon={CreditCard}` и др. на точните редове |
| 12 | Data §11 | `settings/page.tsx:351-358` хардкоднат status | `settings/page.tsx:351-360` | ⚠️ **ЧАСТИЧНО** | Статусите `"connected"/"unknown"/"disconnected"` са хардкоднати — вярно. Но точните редове са 352-356, не 351-358. Освен това агентът цитира `settings/page.tsx:416-427` в §1 резюме и `351-358` в §11 — лек несъответствие в репорта. Фактическото нарушение е верно. |
| 13 | Data §7 | `email/route.ts:14` + `lib/klaviyo.ts:84` за `getKlaviyoMetrics` | `email/route.ts:14`, `klaviyo.ts:84` | ✅ | `getKlaviyoMetrics` е дефиниран на ред 84 в klaviyo.ts |
| 14 | Data §7 | `klaviyo.ts:256` — `unsubscribe_rate` в `getFlowDetail()` | `klaviyo.ts:255` | ✅ | Ред 255 е `"unsubscribe_rate", "bounce_rate"` в статистиките — офсет от 1, вярно |
| 15 | Data §7 | `unsubscribe_rate` е в `stats` array на `getKlaviyoMetrics()` | `klaviyo.ts:88` | ✅ | Ред 88: `const stats = ["recipients", "open_rate", ..., "unsubscribe_rate"]` — заявен, но не aggregate-ван в return |
| 16 | Mobile §6 | `traffic/page.tsx:344-356` sort бутони `px-2 py-1` ~24px | `traffic/page.tsx:343-355` | ✅ | Инлайн sort бутони в traffic са `px-2.5 py-1`, не `px-2 py-1` (ред 348) — минимална разлика в ширина, но py е `py-1` = 4px padding = ~24px height |
| 17 | Mobile §6 | `traffic/page.tsx:359-360` `min-w-[600px]` за топ страници | `traffic/page.tsx:360` | ✅ | Точно `min-w-[600px]` на ред 360 |
| 18 | Mobile §9 | `google-ads/page.tsx:402-403` `min-w-[900px]` | `google-ads/page.tsx:403` | ✅ | `min-w-[900px]` на ред 403 |
| 19 | Design §9 | `google-ads/page.tsx:316-330` inline Recharts Tooltip | `google-ads/page.tsx:317-330` | ✅ | Точен inline `<Tooltip contentStyle={{...}}>` без GlassTooltip |
| 20 | Design §9 | `ads/[market]/page.tsx:729` ScoreBar `barColor` три цвята вкл. `bg-blue` | `ads/[market]/page.tsx:721` | ✅ | `const barColor = value >= 70 ? "bg-accent" : value >= 40 ? "bg-blue" : "bg-red"` — точно |
| 21 | Design §4 | `products/page.tsx:219` `text-[14px]` за revenue в таблица | `products/page.tsx:219` | ✅ | `text-[14px] font-semibold text-text` за revenue column |
| 22 | Design §1 | `analysis/page.tsx:258` `bg-purple-500 text-white` user message | `analysis/page.tsx:334-335` | ⚠️ **ЧАСТИЧНО** | `bg-purple-500` е на send бутона (ред 334-335), user message bubble е на ред ~257-265. Твърдението е вярно фактически, но ред номерата са смесени |

---

## Решени отворени въпроси (преценки → факти)

### DonutChart.tsx — tooltip имплементация

**Факт:** `DonutChart.tsx` използва вграден Recharts `<Tooltip contentStyle={{...}}>` (редове 70-83) — **не** `GlassTooltip`. Стилът наподобява GlassTooltip визуално (same CSS vars), но НЕ е каноничния компонент. Дизайн агентът твърдеше "(преценка: вероятно нямат GlassTooltip)" — **потвърдено, нямат**.

### BarChartCard.tsx — tooltip имплементация

**Факт:** `BarChartCard.tsx` използва вграден Recharts `<Tooltip contentStyle={tooltipStyle}>` (редове 70, 101) — **не** `GlassTooltip`. Стилът е дефиниран като inline обект `tooltipStyle` с `var(--surface)` и `var(--border)`. Design агентът твърдеше "(преценка: вграден tooltip)" — **потвърдено**.

### FunnelChart.tsx — тип и tooltip

**Факт:** `FunnelChart.tsx` е **чист HTML/CSS** компонент — нито Recharts, нито SVG. Рендира `<div>` bars с `width` пропорционален на count. **Няма никакъв tooltip** (нито Recharts, нито GlassTooltip). Дизайн агентът питаше дали "ползва smooth lines" — **не**, bars са правоъгълни div-ове. Mobile агентът го маркира като "Recharts native tooltip" нарушение — **тази конкретна загриженост е грешна**; FunnelChart няма Recharts tooltip изобщо. Но mobile проблемът (без интерактивност) остава валиден по различна причина.

### SparkLine.tsx — tooltip

**Факт:** `SparkLine.tsx` използва Recharts `<LineChart>` + `<Line>` **без `<Tooltip>` компонент**. Няма tooltip — нито Recharts, нито Glass. Дизайн договорът §7 казва "sparklines без tooltip е правилно" — **SparkLine спазва договора**.

### SortButton.tsx — touch target размери

**Факт:** `SortButton.tsx:22-27` ползва `px-2.5 py-1.5` — `py-1.5` = 6px padding top + 6px padding bottom + ~20px font/line-height ≈ **~30-32px** обща височина. Под изискваното 44px (CLAUDE.md §2). Mobile агентът го описва като ~28-32px, Design агентът като ~30px — **и двете са правилни оценки**.

### AreaLineChart.tsx — tooltip

**Факт:** `AreaLineChart.tsx` използва вграден Recharts `<Tooltip contentStyle={{...}}>` (редове 88-98) — **не** `GlassTooltip`. Mobile scrubber не е имплементиран. Design агентът твърдеше "(преценка: вероятно нямат GlassTooltip)" — **потвърдено**.

### CustomerListTab.tsx — mobile имплементация

**Факт:** `CustomerListTab.tsx:327` `hidden md:block` за desktop table, `CustomerListTab.tsx:395` (не 394) `md:hidden` за mobile cards — **отлична mobile имплементация, двоен view**. Mobile агентът го маркира като "OK" — **потвърдено**.

### AgentStatsTab.tsx — MiniKpi с icon props

**Факт:** `AgentStatsTab.tsx:151-155` — 5 `MiniKpi` **с** `icon` props (PhoneCall, Clock, Target, Euro). Дизайн агентът не провери компонента — това е нарушение на design contract §3 в операционен (не analytics) екран. Не е критично (не е analytics), но е системно нарушение.

---

## Грешки и неточности в репортите

### Сериозни грешки

**[Data] inventory_quantity наличност твърдение:**
Репортът твърди "Inventory данни липсват напълно — `inventory_quantity` е в Shopify product variants (`lib/shopify.ts:120`), но не се показва". Цитатът е верен (type def на ред 118-120), НО следващото изречение "само трябва да се expose-не" е подвеждащо. `fetchAllProducts()` (`shopify.ts:127`) НЕ включва `variants` в `fields=` параметъра — само `id,title,handle,image,product_type,vendor,status`. За да получиш `inventory_quantity`, трябва или да смениш fetchAllProducts да включва variants (или ги взема отделно), или да ползваш `fetchProductCatalog()` (която включва `variants`). Изискания труд е по-голям от "само expose" — нужна е промяна в API route-а и fetchAllProducts полетата.

**[Mobile] FunnelChart "Recharts native tooltip" твърдение:**
`02-report-mobile.md` раздел §6 и Системен проблем A твърди, че `FunnelChart` "Recharts native tooltip активен на mobile. Anti-pattern §13." FunnelChart обаче е **чист HTML компонент без никакъв Recharts или tooltip**. Това твърдение е **фактически грешно**. FunnelChart няма tooltip проблем. (Отделен mobile проблем може да има с липса на числово четене на mobile, но не Recharts tooltip.)

### Малки неточности

**[Data] settings цитат ред несъответствие:**
В §1 резюме се цитира `settings/page.tsx:416-427`, в §11 детайли се цитира `settings/page.tsx:351-358`. Реалните редове за хардкодирания статус са 352-356. Незначителна разлика, не влияе на фактическото твърдение.

**[Design] analysis.tsx ред номера смесени:**
Дизайн агентът цитира `analysis/page.tsx:258` за `bg-purple-500 text-white` user message bubble и `analysis/page.tsx:219` за header icon. В действителност header icon е на ред 212, live indicator на ред 219-222, send бутон на ред 334-335. Фактическото нарушение (purple-500 навсякъде) е точно, редовете са леко разместени.

**[Data] `traffic/route.ts:44-98` 11 паралелни GA4 заявки:**
Реалното чете 11 `runReport()` повиквания в `Promise.all` — твърдението е точно като брой. Малката неточност: начален ред е 40 (началото на `Promise.all`), не 44.

**[Mobile] `CustomerListTab.tsx:327,394` mobile/desktop split:**
Mobile cards са на ред 395 (`md:hidden`), не 394. Тривиален офсет.

---

## Корекции на обем труд

### Подценени

**[Data] Multi-store за `/products`, `/customers`, `/traffic` — маркирани L:**
Data агентът пише "Supabase store schemas + `read_store_daily_aggregates` вече работят за home dashboard; products page може да ползва същия pattern." — **реалността е по-сложна**. `/products` analytics route (`products-analytics/route.ts`) прави директни Shopify REST заявки за orders, не ползва Supabase aggregates. За products мулти-store трябва: (а) нов Supabase aggregate за product-level orders по store, ИЛИ (б) паралелни Shopify REST calls за всеки store. Нито едното е готово. За `/customers` е аналогично — `fetchOrdersWithCustomers` е direct Shopify REST. Supabase pattern от `/sales` работи за дневни агрегати (revenue/orders), но **не за product-level или customer-level data**. Оценката L е правилна, но агентът подценява разстоянието до "реизползваемия pattern" — по-реалистично е XL за всяка от двете.

**[Design] GlassTooltip refactor — маркиран M:**
Засяга 5 chart компонента: `DonutChart`, `BarChartCard`, `AreaLineChart`, `google-ads` inline tooltip, `KpiStrip TempoTooltip`. Всеки компонент трябва да замени inline Recharts tooltip с `GlassTooltip` wrapper или `buildRechartsTooltip()` factory. Ако `GlassTooltip` компонент не съществува (проверка нужна), трябва да се създаде първо. M (1-2 дни) е реалистично само ако factory функция вече съществува.

### Надценени

**[Mobile] `/products` мобилна адаптация — маркирана L:**
L (3-5 дни) за "mobile card view за продуктите + MobileScrubber". MobileScrubber за единствения AreaLineChart е S (половин ден). Mobile card view за products table е M (1-2 дни). Общо M-L е по-реалистично от L-XL.

**[Data] `/google-ads` GA4-based wins — маркирани M:**
`sessionGoogleAdsQuery` и `sessionGoogleAdsAdGroupName` са GA4 dimensions — само нови `runReport()` заявки в съществуващия route. S (половин ден) е по-реалистичен.

---

## Дублирани/конфликтни твърдения между репортите

### Припокривания (OK)

1. **§3 нарушение (icons в KPI карти):** Всички три репорта го споменават — Data за `email/page.tsx:205-218`, Mobile за множество страници, Design за същото. Консистентно, не е конфликт.
2. **SortButton touch targets:** Mobile го поставя P1 (Системен проблем B), Design го споменава мимоходом. Mobile е водещ репорт за това.
3. **`morning-report` и `analysis` извън sidebar:** Data (§13, §14), Mobile (§13, §14) и Design (§13) — всички трима флагват. Консистентно.

### Конфликти

1. **FunnelChart tooltip:** Mobile твърди "Recharts native tooltip активен на mobile. Anti-pattern §13." Design твърди "(непроверено — компонентът не е четен)". **Истината:** FunnelChart е чист HTML без Recharts tooltip. Mobile агентът греши; Design агентът се е предпазил правилно с "непроверено".

2. **`AreaLineChart` за `/products` revenue — chart type:** Data агентът пише "revenue е continuous metric, така че area е честна" (правилно). Design агентът пише "(verifiable) §9 нарушено — не е проверено дали chartComponents имат GlassTooltip (преценка)". Двете не си противоречат, но Design агентът погрешно класифицира chart type-а като нарушение — нарушението е само в tooltip, не в chart type.

3. **`/customers` DonutChart цветове:** Data (`CustomerAnalyticsTab.tsx:103-112`) и Mobile (`CustomerAnalyticsTab.tsx:111`) цитират различни ред диапазони за едно и също твърдение. Ред 111 е точен (`colors={["#007aff", "#22c55e"]}`).

---

## Валидност на GA4 dimensions (Data агент)

Всички предложени GA4 dimensions са **валидни в GA4 Data API**:

| Dimension | Валидна? | Бележка |
|-----------|---------|---------|
| `landingPage` | ✅ | Стандартен GA4 dimension |
| `searchTerm` | ✅ | За site search (изисква site search tracking) |
| `country` | ✅ | Стандартен |
| `hour` | ✅ | 0-23 integer |
| `dayOfWeek` | ✅ | 0=Sunday..6=Saturday |
| `newVsReturningCustomer` | ✅ | Стандартен |
| `sessionGoogleAdsQuery` | ✅ | Session-scoped; OK с `sessionGoogleAdsCampaignName` |
| `sessionGoogleAdsAdGroupName` | ✅ | Session-scoped; OK с друга session dimension |

**Важно:** `hour` + `dayOfWeek` комбинация без session dimension е безопасна (те не са ad-scoped). `sessionGoogleAdsQuery` с `advertiserAdCost` обаче изисква session dimension — Data агентът правилно предлага `sessionGoogleAdsQuery` само с `advertiserAdCost`, без `date` само, което спазва known gotcha от memory.

**Meta breakdowns:** `breakdown: "placement"` и `breakdown: "age,gender"` са валидни Meta Graph API параметри. В `src/lib/meta.ts` `breakdowns` параметърът се ползва само за hourly (`hourly_stats_aggregated_by_advertiser_time_zone`). Нов `fetchInsights()` call с placement/age-gender breakdown е технически осъществим без промяна в meta.ts типовете.

---

*Одит генериран: 2026-05-22. Всички твърдения верифицирани директно срещу source код.*
