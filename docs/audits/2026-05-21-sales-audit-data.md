# Data Interoperability Audit — /sales

> Read-only audit срещу днешния overhaul (2026-05-21). Фокус: SWR cache hygiene, Sofia-tz / dedup convention consistency, Ритъм averaging math, RPC surface за бъдеща reuse на `/traffic`, `/products`, `/ads`, `/email`, `/customers`.

## Executive summary

`/sales` като цяло вдиша добре — API contract-ът е централизиран в `src/lib/sales-queries.ts`, всички routes минават през `requireAuth` + `resolveStoreSchemas`, всички RPC-та използват един и същ `DISTINCT ON (shopify_order_id) ... ORDER BY received_at DESC` dedup pattern и един и същ `(shopify_created_at AT TIME ZONE 'Europe/Sofia')::DATE` bucketing. Това е реална основа за reuse. Самите routes са плоски и предсказуеми — eднакъв shape (`{payload, dateRange, stores}`), еднакви Cache-Control headers, еднаква error shape. KPI бордът, тренда, рутъма и географията се хранят от един и същ store-schema разрешител, така че single-store / all-stores switching не изисква специален код в всеки компонент.

Кървят основно три неща. **(1) SWR cache keys не са string-identical** между `SalesTrend` и `SalesHeroStrip` за comparison fetch-а в hourly mode — granularity-suffix-ът се append-ва на различни позиции в query string-а, така че SWR не познава, че двата request-а са за същия dataset. Това е бил commit-ът „cache shared", но низовата им конкатенация го разваля. Двойно мрежово натоварване на „Днес"/„Вчера". **(2) Несъответствие в buyer-identity cascade-а** между geography RPC-тата (v3, email→customer.id) и `period_unique_customers` (още само email). За foreign-store schemas това означава, че hero strip-ът показва „Уникални клиенти: 0/малко", докато География-та показва истинския брой. Числата не могат да се обясняват с обикновен store filter — за operator-а изглежда като bug, защото е. **(3) Ритъм averaging бие в правилната посока, но today-инклузия в divisor-а лъже по подразбиране** — днешният Thu се брои като пълен Thursday в occurrencesCur, докато данните са до сега. „Typical Thursday" е изкуствено занижен с ~50% при middle-of-day гледане.

Останалото: 13 дублирани `fetcher`-а, всеки swallow-ва network errors → SWR `error` flag нагло остава undefined; почти никой component не surface-ва грешки; `useStoreSelection` чете localStorage в useMemo при render → hydration drift и double-fetch при първа навигация; `top_products_for_period` няма Sofia-tz comment в file 020 (фиксиран е в 029, но първоначалният файл остава мисляcho-misleading); `fetchTopProducts` raw merge by lowercased-or-not title може да дублира edge-case продукти. Това са findings по-долу.

Преди да копираш този pattern на `/traffic` / `/products` / `/ads` / `/email` / `/customers` — изваж SWR fetcher-а, грешковата surface-а и `useStoreSelection`-а в shared слой; gravitate `period_unique_customers` към същия cascade като `read_store_sales_by_country` v3.

---

## Findings

### 1. SWR comparison cache miss: granularity suffix позициониран различно

- **Severity**: important
- **Where**: `src/components/sales/SalesTrend.tsx:138-141` vs `src/components/sales/SalesHeroStrip.tsx:510-513`
- **Evidence**:

  ```ts
  // SalesHeroStrip
  const compQs = `preset=custom&from=${compFrom}&to=${compTo}${granularitySuffix}`;
  // → `/api/sales/trend?${compQs}&${storeParam}`
  //   = ...?preset=custom&from=X&to=Y&granularity=hour&stores=Z

  // SalesTrend
  const compQs = `preset=custom&from=${compFrom}&to=${compTo}`;
  // → `/api/sales/trend?${compQs}&${storeParam}${granularitySuffix}`
  //   = ...?preset=custom&from=X&to=Y&stores=Z&granularity=hour
  ```

  SWR keys са string-identical compared. `&granularity=hour&stores=Z` ≠ `&stores=Z&granularity=hour` → две различни keys → два отделни fetch-а за същия dataset, същия server response. Comment-ите в `SalesHeroStrip.tsx:492-494, 509` и `SalesTrend.tsx:137` твърдят, че „keys match" — невярно за hourly mode.

  Първичните (не-comparison) keys съвпадат — `${queryString}&${storeParam}${granularitySuffix}` пише едно и също в трите component-а. Само comparison-ът се разминава.

- **Why it matters for reuse**: Същият copy-paste pattern на `/traffic` ще hit-не GA4 за същия comparison window два пъти. Cost-ът там не е тривиален (GA4 quota + latency). Договорът „един URL = един cache entry" не може да живее в комменти — трябва да живее в utility, който builds-ва URL-а.
- **Recommendation**: Изтегли `buildSalesUrl({ path, queryString, storeParam, granularity, comp })` helper в `src/lib/analytics/urls.ts` с deterministic param order (alpha-sort). Всеки SWR consumer го вика → string-identical keys гарантирани. Бонус: можеш да добавиш `assertSwrKeyConsistency` dev-mode check, който логира warning ако два различни callsite-а builds-ват eднаква payload-а с различни strings.

---

### 2. `period_unique_customers` използва само email — hero strip undercount-ва foreign stores

- **Severity**: critical
- **Where**: `supabase/migrations/029_sofia_tz_bucketing.sql:204-216`, called from `src/lib/sales-queries.ts:153-167`
- **Evidence**: RPC-то прави:

  ```sql
  SELECT COUNT(DISTINCT email)::INTEGER
  FROM latest
  WHERE email IS NOT NULL
    AND event_type != 'cancelled'
    AND financial_status IN (...)
  ```

  Сравни с `read_store_sales_by_country` v3 (migration 039:95-103) който прави:

  ```sql
  COALESCE(
    LOWER(NULLIF(TRIM(COALESCE(
      email,
      raw_payload->'customer'->>'email',
      raw_payload->>'email',
      raw_payload->>'contact_email'
    )), '')),
    NULLIF('cust:' || (raw_payload->'customer'->>'id'), 'cust:')
  ) AS buyer_identity
  ```

  По memory `feedback_foreign_store_pii_redacted_payloads.md`: store_gr/it/ro/de/uk/hu/sk нямат email в payload-а. Migration 039 explicitly fix-ва това за geography RPC-тата но **не докосва `period_unique_customers`**. Hero strip-ът (`SalesHeroStrip.tsx`) и сигнал-strip-ът (`SalesSignalStrip.tsx:255` „Уникални клиенти") консумират `kpis.customers.value`, който идва от тук.

- **Why it matters for reuse**: Operator-ът ще види „Гърция: 1 240 клиенти" в География-та и „Уникални клиенти: 380" в hero-то за същия period when stores=store_gr. Това директно нарушава Principle 5 (Real Data Only) и подкопава доверието в всички downstream числа. „Стойност / клиент" в Signal Strip се дели на същата фалшива стойност → distorted. На `/customers` страница същият RPC ще се преизползва.
- **Recommendation**: Migration 044 — пренапиши `period_unique_customers` с same v3 buyer-identity cascade като migration 039. Eднаква semantic между „брой клиенти на цяла страна" и „брой клиенти на цялата организация" е non-negotiable. После провери hero strip-а ръчно за всеки foreign store на 30d window.

---

### 3. Ритъм averaging: today included in divisor дава underestimate

- **Severity**: important
- **Where**: `src/lib/dates.ts:139-167` (helpers), `src/components/sales/SalesRhythm.tsx:374-386, 459-461` (callsite)
- **Evidence**: `countWeekdaysInRange(from, to)` итерира всички дни inclusive и брои всеки ISO weekday веднъж независимо колко orders / hours са изтекли в текущия ден.

  ```ts
  // dates.ts:158-167
  for (let i = 0; i < total; i++) {
    const d = new Date(fromTs + i * 86_400_000);
    const jsDay = d.getUTCDay();
    const iso = jsDay === 0 ? 7 : jsDay;
    counts.set(iso, (counts.get(iso) ?? 0) + 1);
  }
  ```

  Когато operator-ът гледа 30d preset в 12:00 Sofia time на Четвъртък, divisor-ът за Thu е 4 (включително днешния Thursday), но числителят за Thu 12:00..23:59 = 0 (orders още не са направени). „Typical Thursday" е разводнен.

  Същото за `daysInRange` ползван в `foldByHour` (`SalesRhythm.tsx:418-421`). Hour strip-ът показва per-day average orders, но числителят за днешните hours `>now` е zero, числителят за hours `<now` е реален, divisor е 30 (вкл. half-day today). Двойна биас.

- **Why it matters for reuse**: GA4 / Meta-ads daily aggregates имат същата проблема. Ако reuse-ваш `countWeekdaysInRange` за heatmap-и на `/traffic`, „typical Wednesday session count" ще се занижи в начало на деня. Operator-ът няма как да познае дали се е разпаднала кампанията или просто sample-ът е partial.
- **Recommendation**: Опции в ред на елегантност:
  1. **Exclude today**: Когато `to === today_sofia`, drop today from counts AND from RPC date filter — само "completed days" averaging. Honest, but loses live signal.
  2. **Partial-today scaling**: Брой today like a fractional day = `hour_of_now / 24`. Числителят и divisor-ът се движат заедно. Mathy, но коректно.
  3. **Surface the bias**: Запази current behavior, но добави badge в card header-а „Включва текущ ден (частично)" когато `to === today` and we're mid-day.

  Препоръчвам (1) за `/sales` Ритъм (analytical view), (3) за `/traffic` (live view). Дискусия с operator коя му трябва.

---

### 4. Дублиран fetcher × 13, swallow всички network errors

- **Severity**: important
- **Where**: 13 файла в `src/components/sales/*.tsx` (виж grep `const fetcher = (url: string) => fetch(url).then((r) => r.json())`)
- **Evidence**: Всеки component декларира собствен:

  ```ts
  const fetcher = (url: string) => fetch(url).then((r) => r.json());
  ```

  Без `r.ok` check. Сървърът на 500 връща `{error: "Internal error"}` (`/api/sales/trend/route.ts:54`), което fetcher-ът щастливо обработва като успешен JSON. SWR-ът никога не вижда грешка — `kpisError` и `error` flag-овете остават undefined.

  Само 2 от 13 component-а проверяват `data.error`:
  - `SalesHeroStrip.tsx:566`: `if (kpisError || kpis.error)`
  - `StoreKpiGrid.tsx:39`: `if (error || data.error)`

  Останалите 11 default-ват към `?? []` / `?? 0` и тихо показват „празен" screen. Тренд chart-ът рисува empty chart. Top products показва „Няма данни за продукти" дори при 500. Operator-ът не може да различи „реална тишина" от „infra failure".

- **Why it matters for reuse**: Principle 5 (Real Data Only): „If an API is down, show a clear error — not stale/fake data". Сегашната surface директно нарушава това. На `/traffic` ще е по-зле — GA4 квота errors са по-чести.
- **Recommendation**: Извади `src/lib/swr/fetcher.ts`:

  ```ts
  export class ApiError extends Error {
    constructor(public status: number, public payload: unknown, message: string) {
      super(message);
    }
  }
  export async function jsonFetcher<T>(url: string): Promise<T> {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body, body?.error ?? `HTTP ${res.status}`);
    if (body?.error) throw new ApiError(res.status, body, body.error);
    return body as T;
  }
  ```

  + `src/components/shared/ErrorState.tsx` с consistent „⚠ грешка при зареждане" UI. Всички components: `if (error) return <ErrorState />`. SWR-ът ще автоматично retry с exponential backoff.

---

### 5. `useStoreSelection` чете localStorage в useMemo — hydration drift

- **Severity**: important
- **Where**: `src/hooks/useStoreSelection.ts:11-21`
- **Evidence**:

  ```ts
  const selectedStore = useMemo(() => {
    const param = searchParams.get("store");
    if (param) return param;
    if (typeof window !== "undefined") {
      return localStorage.getItem("selectedStore") || "all";
    }
    return "all";
  }, [searchParams]);
  ```

  SSR render: `typeof window === "undefined"` → returns `"all"`. First client render (още преди hydration finalizes): чете localStorage → returns примерно `"store_gr_uuid"`. Hydration mismatch (React 19 warning, but functional). По-важно: SWR keys, които зависят от `storeParam`, се променят между render passes, тригерира **double fetch на първа навигация**.

- **Why it matters for reuse**: Всеки нов dashboard, който чете `useStoreSelection`, ще наследи hydration mismatch + double fetch. На `/ads` или `/products` ще е още по-явно — те имат много по-голям data payload.
- **Recommendation**: Two options:
  1. **Make localStorage authoritative once via useEffect**: useState от `"all"`, useEffect sets от localStorage on mount. Single source of truth, no SSR mismatch. Минимална цена: един extra render на mount.
  2. **Migrate всичко в URL only**: премахни localStorage, store-selector винаги пише URL. Bookmark-уеми, share-уеми. Loose-вaш „remember my store" UX, но печелиш cleanliness. Препоръчвам това.

---

### 6. „Today" hourly demote не е reflected в client SWR key

- **Severity**: nice-to-have (defensive, не explosion)
- **Where**: `src/app/api/sales/trend/route.ts:32-34`
- **Evidence**: Server-ът прави:

  ```ts
  if (granularity === "hour" && from !== to) {
    granularity = "day";
  }
  ```

  Тогава response-ът съдържа `granularity: "day"` въпреки че client-ът е поискал `granularity=hour`. Кликата `SalesHeroStrip.tsx:494` се основава на client-side `hourly = from === to` за rendering shape — match-ва server-side decision, така че бъг няма. Но: client SWR key включва `&granularity=hour` дори когато server-ът знае, че ще върне daily data. Никой не cache-shares.

- **Why it matters for reuse**: Hint-ва за по-широко напрегване — server side нормализация на granularity не се reflect-ва в URL. Ако някога добавиш explicit hourly preset за multi-day range (Meta hourly за 7 дни), този silent demote ще е mystery debugging session.
- **Recommendation**: Server-side normalisation само ако грешката е сериозна (както сега); инак return 400 с „granularity=hour requires single-day range" — клиент решава да pick-ва granularity преди request, не сървър. Това прави SWR keys self-consistent.

---

### 7. Top products RPC: title merge е case-sensitive по точна string match, but normalisation липсва

- **Severity**: nice-to-have
- **Where**: `src/lib/sales-queries.ts:437-446`
- **Evidence**:

  ```ts
  for (const rows of allResults) {
    for (const p of rows) {
      const existing = byTitle.get(p.title) ?? { quantity: 0, revenue: 0 };
      ...
    }
  }
  ```

  `byTitle` key-ed на raw title. Ако product „Левзея Макс 60 капсули" се пише в БГ store и „Levzea Max 60 caps" в RO store, те ще се появят като два отделни top products. По принцип същият продукт.

  Това може и да е feature (multi-language SKU listing), но не е документирано — operator-ът може да го разчете грешно като „45% дял" когато реално е 45+8% = 53%.

- **Why it matters for reuse**: `/products` страница ще наследи това поведение. SKU normalisation е генеричен проблем; решение само в един client е tech debt.
- **Recommendation**: Hypothesis (verify): прибавяй `sku` или `product_id` колона към `top_products_for_period` RPC return и merge по тях, fall back към title когато sku NULL. Изисква проверка дали Shopify line_items винаги carry-ват variant_id/product_id.

---

### 8. Stack: 11/13 components fail-silently при сървър error

- **Severity**: important
- **Where**: пълен list — виж #4. Specific high-impact callsites:
  - `SalesTrend.tsx:130-145` — render-ва празен chart при 500
  - `SalesRhythm.tsx:388-401` — render-ва 7 празни weekday rows
  - `TopProductsAggregate.tsx:62-72` — render-ва „Няма данни за продукти"
  - География routes — фолд-ват към празна карта
- **Evidence**: виж #4
- **Why it matters for reuse**: Tied to #4. Списвам отделно за да го броя в severity score-а.
- **Recommendation**: Tied to #4.

---

### 9. `daily_aggregates.unique_customers` per-day count нагло конфликтира с period-distinct semantics

- **Severity**: nice-to-have (documented as known, but worth re-highlighting)
- **Where**: `src/lib/sales-queries.ts:140-167`, `supabase/migrations/029_sofia_tz_bucketing.sql:67`
- **Evidence**: Comment-ът в `sales-queries.ts:140-145` обяснява че `daily_aggregates.unique_customers` се сумира per-day и double-count-ва, затова callsite-ът използва `period_unique_customers` RPC. ОК. Но самата `daily_aggregates.unique_customers` колона остава достъпна за `fetchAggregatesForPeriod` (`sales-queries.ts:100-119`) — никой не я чете в `fetchSalesKpis`, но `fetchStorePerformance` (`sales-queries.ts:469-501`) **също** не я чете → unique customers per-store липсва в Top пазар tile. Сегашната surface не това request-ва, но reuse на `fetchStorePerformance` за per-store „клиенти" tile би падна mute.
- **Why it matters for reuse**: На `/customers` page-а ще ти трябва per-store customers. Сегашната RPC surface не може да върне това без fan-out N+1.
- **Recommendation**: Migration 045 — add `period_unique_customers_by_store(p_schemas TEXT[], p_from, p_to) RETURNS TABLE (schema_name, customers)` за single round-trip. Или приеми N+1 за умерен брой stores (~7) и добави към `StorePerformance`.

---

### 10. Геo cities key collision на toLowerCase fold

- **Severity**: nice-to-have
- **Where**: `src/lib/sales-queries.ts:826-848`
- **Evidence**:

  ```ts
  const key = `${r.country_code}|${r.city.toLowerCase()}`;
  ```

  Country comes from RPC vs city comes lowercased only here. Hypothesis (verify): „Велико Търново" vs „велико търново" се сливат правилно. „Велико Tърново" (latin T homoglyph — memory feedback_new_language_pipeline_gotchas warning) не би се слели. Cyrillic vs Latin homoglyphs не са нормализирани.
- **Why it matters for reuse**: Сравнително нисък risk — Shopify обикновено dedup-ва city strings. Но при foreign stores PII fallback chain съществуват случаи на mixed scripts.
- **Recommendation**: Не fix-вай сега. Добави unit test срещу real city dataset веднъж в `/customers` page и виж дали се появяват doubles. Tackle then.

---

### 11. `useStoreSelection.storeParam` always include `stores=`, дори когато route ignores it

- **Severity**: nice-to-have
- **Where**: `src/app/api/sales/store-performance/route.ts:19` vs `src/components/sales/SalesSignalStrip.tsx:200`
- **Evidence**: Server-ът прави `resolveStoreSchemas("all")` независимо от query param. Client-ът на line 200 е знаел това и passes `${queryString}` only (без storeParam). Compare with TopProducts / KPIs callsite-овете които pass-ват storeParam. Inconsistency in convention.
- **Why it matters for reuse**: Reuse на този pattern за други „винаги all-stores" routes (e.g. бъдеща `/api/stores/summary`) ще доведе до objection-driven mixed conventions. Малка кобра.
- **Recommendation**: Една от двете:
  1. Server-ът зачита `stores=` query param дори за store-performance, и filter-ва списъка. Прави endpoint-а composable.
  2. Renaming на endpoint-а `/api/sales/store-performance-all` с explicit suffix → contract-ът е self-documenting.

  Препоръчвам (1). „Top пазар" винаги би искал all stores defensively at the consumer.

---

### 12. Comparison delta math — `pctChange` returns null when previous=0, но downstream code treats null inconsistently

- **Severity**: nice-to-have
- **Where**: `src/lib/sales-queries.ts:169-172`, callers `SalesTrend.tsx:171-174`, `SalesHeroStrip.tsx:147-149`, `SalesRhythm.tsx:232-241`
- **Evidence**: `pctChange` returns `null` ако `previous===0`. Това е честно. Но client side:
  - `SalesTrend:172`: `totalComp > 0 ? Math.round(...) : null` — re-computes от scratch, не използва `pctChange`. OK.
  - `SparkTooltip:147-148`: `if (cur !== null && cmp !== null && cmp > 0)` — explicit guard. OK.
  - `SalesRhythm.WeekdayRow:232-235`: `series.totalComp !== null && series.totalComp > 0` — guards двойно но не отдалечено в delta utility.

  Нямa утvinity функция за rendering. Three callsites сами re-impl-ват „arrow + abs%". Малки drift-ове — SalesTrend round-ва на whole number, SparkTooltip също, но threshold за `flat` е <1% в SparkTooltip vs <1 absolute pct в WeekdayRow / SalesTrend.
- **Why it matters for reuse**: Design contract §4 mandates единен delta формат. Drift между component-и нарушава §8 („Сравнение е същото навсякъде"). Когато копи­раш patterns на `/traffic`, ще наследиш 3 различни функции с прибл. same intent.
- **Recommendation**: Извади `src/lib/analytics/delta.ts` с:

  ```ts
  export function deltaBadge(cur: number, prev: number | null, opts?: { flatThresholdPct?: number }): {
    arrow: '▲' | '▼' | '—' | null;
    abs: number | null;
    tone: 'good' | 'bad' | 'flat' | null;
  }
  ```

  И използвай в всички tooltip-и и WeekdayRow. Вече има `<Delta>` component (`shared/Delta.tsx`) — кодифицирай прав логика там като canonical и експонирай pure-function за tooltip use cases.

---

### 13. SalesRhythm fold-loops O(N×M) — performance, не correctness

- **Severity**: nice-to-have
- **Where**: `src/components/sales/SalesRhythm.tsx:152-183`
- **Evidence**:

  ```ts
  for (let wd = 1; wd <= 7; wd++) {
    for (let h = 0; h <= 23; h++) {
      const curB = cur.find((x) => x.weekday === wd && x.hour === h);
      const cmpB = cmp.find((x) => x.weekday === wd && x.hour === h);
      ...
    }
  }
  ```

  168 × `find()` × 168 buckets = ~28k linear scans per fold. Mirror-ed в `foldByHour` (24×7×168 finds). Хорахмен брой малък (~28k), но useMemo deps re-run-ват при всеки metric toggle. На зрял dataset (по-голям store, recursion в `SalesHourHeatmap.tsx:138` повтаря същия pattern), това вече ще се усети.
- **Why it matters for reuse**: Heatmap fold pattern ще се reuse-ва на `/traffic` (hour×weekday GA4 buckets). Замяна на linear find-ове с `Map<key,bucket>` lookup би помогнало everywhere.
- **Recommendation**: Build a `Map<\`${wd}-${h}\`, HourWeekdayBucket>` once outside the loop. Свърши всички consumer-и (rhythm fold, heatmap fold). Не блокиращ now, но не пускай в `/traffic` reuse.

---

### 14. `SalesHourHeatmap.tsx` still imports `HourWeekdayBucket` and lives на drill-down, но dependency на same RPC значи още един client-side fold

- **Severity**: nice-to-have
- **Where**: `src/components/sales/SalesHourHeatmap.tsx:121-125`, `src/components/sales/SalesRhythm.tsx:388-392`
- **Evidence**: И двата bind-ват към `/api/sales/hour-weekday?${queryString}&${storeParam}`. Същата string structure → SWR cache shared между page-овете. ✓ Това е едно от малките места където copy-paste e работило в наша полза.
- **Why it matters for reuse**: Положителен пример. Не е finding, но worth nothing for the audit.
- **Recommendation**: Нищо. Сanity спрямо #1.

---

### 15. Foreign-store graceful degradation — exists, но opaque

- **Severity**: nice-to-have
- **Where**: `src/lib/sales-queries.ts:856-857` (comment), `supabase/migrations/042_read_store_order_points.sql:29-30`
- **Evidence**: `read_store_order_points` връща rows само за schemas with `shipping_address.latitude` populated. Foreign stores → 0 rows. Това е silent fallback to city-centroid path. Нищо в UI не сигнализира на operator-а, че текущата store-selection вижда city-pin-точки вместо office-точки.
- **Why it matters for reuse**: Когато добавиш втори БГ store или GR започне да изпраща lat/lng (webhook scope upgrade), behavior-ът ще се промени без operator notice. „Защо изведнъж имам точки в Атина?" — context липсва.
- **Recommendation**: Hypothesis (verify): добави `data_quality` field в RPC response („office-level" / „city-level" / „country-level only") и render badge в map tooltip-а. Лек, не нарушава дизайн §1 (статус, не категория).

---

## Reusable primitives candidate list

Кандидати за promotion в `src/lib/analytics/`:

1. **`buildAnalyticsUrl({ path, queryString, storeParam, granularity, comparison })`** — deterministic param-ordered URL builder. Source of truth за SWR keys. (Finding #1)
2. **`jsonFetcher<T>(url): Promise<T>` + `ApiError` class** — replacement за 13 копирани fetcher-и. (Finding #4, #8)
3. **`<ErrorState />` shared component** — consistent error UI за SWR consumer-и. (Finding #4)
4. **`deltaBadge(cur, prev): { arrow, abs, tone }` pure function** — canonical delta logic. (Finding #12)
5. **`countWeekdaysInRange(from, to, opts?: { excludeToday })` + `daysInRange(... )` extended** — average-divisor helpers with optional today-exclude / partial-today scaling. (Finding #3) Already in `src/lib/dates.ts`; just needs opts.
6. **`bucketHashMap<T>(buckets, key: (b) => string)` helper** — replace 168-scan find-ове. (Finding #13)
7. **`resolveBuyerIdentitySql` SQL fragment** — canonical buyer-identity cascade за всички RPC-та, преоблюваемо в SQL functions. (Finding #2) Не може да живее в JS — но може да живее като `CREATE FUNCTION buyer_identity_expr(...) RETURNS TEXT` per-schema или просто като SQL snippet referenced in `docs/db/buyer-identity.md` за бъдещи migration authors.
8. **`StoreSchema` type + `resolveStoreSchemas`** — вече promotable из коробки в `src/lib/analytics/stores.ts`; вторият consumer ще е `/api/traffic/*` (GA4 store-scoped).
9. **`HourWeekdayBucket[]` + fold functions** — ако `/traffic` иска hour×weekday heatmap of sessions, extract `foldByWeekday` / `foldByHour` в `src/lib/analytics/hour-weekday.ts`. Generic за source.

## Open questions

1. **Today-inclusion bias in Ритъм averages**: Operator-ска решение — partial-today scaling, exclude-today, или surface-the-bias badge? Не може да се избере без feedback от cherbal.ppc@gmail.com. (Finding #3)
2. **localStorage vs URL-only за `useStoreSelection`**: Загуба на „remember my store" UX vs cleanliness. Operator-ски trade-off. (Finding #5)
3. **Top-products SKU normalisation across markets**: Single-product cross-locale concept или приема, че мулти-локали = мулти-products? Засяга `/products` page-а директно. (Finding #7)
4. **`period_unique_customers` migration timing**: Това е production migration, която ще измени hero-strip числата за foreign stores веднага. Operator трябва да очаква jump в „Уникални клиенти" KPI-а на /sales за GR/IT/RO/DE/UK/HU/SK при deploy. Comms preparation? (Finding #2)
5. **Cross-store dedup за `period_unique_customers`**: Сегашната surface е „sum-across-stores upper bound" (comment в `sales-queries.ts:144`). Operator-ска приемлива граница, или искаме true cross-schema DISTINCT? Реrelevantно ако някога има shared customer база между store_bg и store_de (един и същ човек поръчвал и в двете).
6. **Foreign-store webhook scope upgrade**: Memory `feedback_foreign_store_pii_redacted_payloads.md` flag-ва long-term fix: upgrade webhook scope to `read_customers`. Колко далеч сме от това? Ако скоро — много от cascade-ите ще обявят quietly redundant. Worth tracking преди да насочваш goldplating на cascade.
