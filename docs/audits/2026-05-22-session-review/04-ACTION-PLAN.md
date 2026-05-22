# 04 — Верификация + План за действие

**Одитор:** Verification Agent  
**Дата:** 2026-05-22  
**Обхват:** 3 ревизионни репорта (`01-correctness`, `02-design`, `03-mobile-regressions`)  
**Метод:** Всяко 🔴/🟠 твърдение проверено срещу реалния код.

---

## 1. Верификационна таблица

### От `01-correctness.md`

| # | Severity | Твърдение | Статус | Бележка |
|---|---|---|---|---|
| C1 | 🟠 | `getMetaPlacementBreakdown` липсва `level: "account"` — Meta default-ва `level=ad` | ⚠️ **Частично** | Виж детайли под таблицата |
| C2 | 🟠 | Health probe използва `Bearer` header; production ползва URL param — различни auth paths | ✅ **Потвърдено** | `health/route.ts:96` vs `meta.ts:248` — точно описано |

**Детайли за C1 — защо ⚠️ а не ✅:**  
`getMetaOverview` (meta.ts:314) **също** не подава `level` и работи коректно от години — Meta Graph API-ът при `act_<ID>/insights` без `level` **default-ва на `account`**, не на `ad`. Доказателство: `getMetaOverview` връща 1 ред (account aggregate), точно както се очаква, без `level` в параметрите.

Обаче `getMetaPlacementBreakdown` **добавя `breakdowns: "publisher_platform"`**. Meta docs специфицират, че при `breakdowns` + липсващ `level` поведението е **недефинирано в документацията** — в практиката различни версии на API-то са го обработвали различно. Рискът не е нулев. Твърдението е **неточно в частта "Meta default-ва `level=ad`"** (правилното default е `account`), но **правилно в частта "добави `level: "account"` за безопасност"** — explicit е по-добре при `breakdowns`.

**Корекция:** Проблемът е реален като хигиена (не като текущ бъг), тъй като `getMetaOverview` без `level` работи. Риск от pagination truncation при голям акаунт с `breakdowns` е легитимен.

---

### От `02-design.md`

| # | Severity | Твърдение | Статус | Бележка |
|---|---|---|---|---|
| D1 | 🔴 | `SpendRoasTrend` без `useChartScrubber` — tooltip нефункционален на mobile | ✅ **Потвърдено** | `globals.css:188-194` mute-ва `.recharts-wrapper` на ≤767px. Нито `useChartScrubber`, нито `MobileScrubber` са в `SpendRoasTrend.tsx`. |
| D2 | 🔴 | `GoogleAdsTrend` без `useChartScrubber` — tooltip нефункционален на mobile | ✅ **Потвърдено** | `google-ads/page.tsx:56,84-104` — идентичен проблем, нито scrubber hook, нито wrapper. |
| D3 | 🟠 | `CreativeHealthCard` — `total === 0` показва "Зареждане..." и при реални 0 реклами | ✅ **Потвърдено** | `AdsBreakdown.tsx:134-135` — `{total === 0 ? <p>Зареждане...</p> : ...}`. Prop-ът е `ads: { score: number }[]` без `adsLoading` flag. |
| D4 | 🟠 | Tab toggle buttons `py-1` ≈ 21px — под 44px touch target | ✅ **Потвърдено** | `SpendRoasTrend.tsx:99` `px-2.5 py-1`, `google-ads/page.tsx:56` — идентично. |
| D5 | 🟠 | `MorningKpiStrip` hero без delta | ✅ **Потвърдено** | `morning-report/page.tsx:48` — `<MiniKpi hero label={k.label} value={k.value} />` без delta prop. Design contract §4. Snapshot API не носи comparison data. |

---

### От `03-mobile-regressions.md`

| # | Severity | Твърдение | Статус | Бележка |
|---|---|---|---|---|
| M1 | 🔴 | `/ads` link в morning-report води до market selector — „в `ads/` няма `page.tsx` без `[market]`" | ❌ **НЕВЯРНО** | `src/app/(dashboard)/ads/page.tsx` **съществува** и прави `redirect("/ads/bg")` (server-side, без flash). Линкът работи — операторът се озовава директно в BG market. Клеймът "няма page.tsx" е фактически грешен. |
| M2 | 🟠 | Tab toggle + sort бутони в `/google-ads` = `py-1` (≈24–28px) — под 44px | ✅ **Потвърдено** | `google-ads/page.tsx:56, 408, 422` — `px-2.5 py-1`, `px-2.5 py-1`, `px-2 py-1`. Без `min-h-[44px]`. |
| M3 | 🟠 | Inbox "Прегледай" бутон `Button size="sm"` ≈ 34px | ✅ **Потвърдено** | `Button.tsx:21` `sm: "px-3 py-1.5 text-[12px]"` → ~28px. `inbox/page.tsx:230` — без `min-h-[44px]` override. |
| M4 | 🟡 | `SpendRoasTrend` ROAS таб tooltip → `€NaN` защото LineChart не праща `spend` | ❌ **НЕВЯРНО** | `buildRechartsTooltip` ползва `payload[0]?.payload` = целия data row (`TrendPoint`). Данният масив `trend` е `{date, spend, roas}[]` — **и двата полета са налице** за всеки ден, независимо кой chart type го рендира. `row.spend` не е `undefined`. Tooltip ще покаже `€0.00` за дни без разход — не `NaN`. |
| M5 | 🟡 | `/ads/[market]` sort/filter бутони `py-1.5` без `min-h-[44px]` — нов регрес | ⚠️ **Частично** | Потвърдено като touch target нарушение, но самият репорт признава "не е нов регрес" — бутоните са предхождали спринта. Не е въведено в тези 10 commita. |

---

## 2. Надеждност на репортите

| Репорт | Потвърдени | Невярни | Частични | Общо 🔴/🟠 | Оценка |
|---|---|---|---|---|---|
| `01-correctness` | 1 | 0 | 1 | 2 | **~85%** — Solid; C1 е технически неточен в мотивацията (Meta default е `account`, не `ad`), но заключението "добави `level: "account"`" е правилно. |
| `02-design` | 5 | 0 | 0 | 5 | **~97%** — Висока точност; всяко твърдение е проверено в кода с конкретни редове. |
| `03-mobile-regressions` | 2 | 2 | 1 | 5 | **~65%** — Две грешки: M1 (фактически грешен — `page.tsx` съществува) и M4 (Recharts `payload[0].payload` работи коректно). |

---

## 3. ПЛАН ЗА ДЕЙСТВИЕ

> Само реалните проблеми, дедуплицирани, подредени по приоритет.

---

### P0 — Преди следващия deploy

#### P0-A: Mobile scrubber липсва в SpendRoasTrend и GoogleAdsTrend

**Проблем:** `globals.css` mute-ва Recharts touch events на ≤767px. Двата нови trend компонента нямат `useChartScrubber + MobileScrubber`. Операторът вижда charts, но не може да инспектира стойности на мобилно устройство — пълна загуба на tooltip функционалност.

**Файлове:**
- `src/app/(dashboard)/ads/[market]/_components/SpendRoasTrend.tsx`
- `src/app/(dashboard)/google-ads/page.tsx` (функцията `GoogleAdsTrend`)

**Референция за fix:** `src/components/sales/SalesDayPulse.tsx:165, 258-264, 405-418`

**Предложен fix:**
1. Добави `useChartScrubber(trend.length)` hook.
2. Wrap-ни chart-овете в touch-enabled div с `onTouchMove` handler.
3. Добави `<MobileScrubber>` под chart-а в `md:hidden` секцията.
4. Подай `activeIdx` към tooltip вместо native Recharts hover.

**Обем:** M (по ~40 реда промяна на файл, същия pattern два пъти)

---

#### P0-B: Tab toggle touch targets под 44px

**Проблем:** `py-1` ≈ 21px — нарушение на CLAUDE.md §2 в нов код, написан в същия спринт, в който `SortButton` беше поправен до 44px.

**Файлове:**
- `src/app/(dashboard)/ads/[market]/_components/SpendRoasTrend.tsx:99`
- `src/app/(dashboard)/google-ads/page.tsx:56`

**Fix:** Добави `min-h-[44px] flex items-center` към tab toggle button className-а (или `min-h-[44px]` на wrapper-а с `flex items-center`).

**Обем:** S (4 реда промяна)

---

### P1 — Скоро (следващ sprint)

#### P1-A: CreativeHealthCard — неразличимо loading vs empty state

**Проблем:** `total === 0` е true и по време на зареждане, и при реален 0 реклами. Операторът вижда "Зареждане..." перманентно при нов/неактивен акаунт.

**Файл:** `src/app/(dashboard)/ads/[market]/_components/AdsBreakdown.tsx:122-135`

**Fix:** Добави `adsLoading: boolean` prop към `CreativeHealthCard`. Render `<Skeleton>` при `adsLoading`, "Зареждане..." само при `total === 0 && !adsLoading`, списъка при `total > 0`.

**Обем:** S

---

#### P1-B: Google Ads page sort/filter бутони под 44px

**Проблем:** `google-ads/page.tsx:408, 422` — inline бутони без `min-h-[44px]`. Нов код в спринта. SortButton component (commit `9af0411`) е правилен — но не е използван тук.

**Файл:** `src/app/(dashboard)/google-ads/page.tsx:401-430`

**Fix:** Замени inline `<button>` елементите с `<FilterPill>` и `<SortButton>` компонентите от `9af0411`, или добави `min-h-[44px]` директно.

**Обем:** S

---

#### P1-C: Inbox "Прегледай" бутон под 44px

**Проблем:** `Button size="sm"` дава ~28px. Кликаем action бутон в inbox card-овете на мобилен Safari.

**Файл:** `src/app/(dashboard)/inbox/page.tsx:230`

**Fix:** Добави `className="min-h-[44px]"` prop към бутоните в showActions секцията, или create `size="touch-sm"` вариант в `Button.tsx`.

**Обем:** S

---

#### P1-D: Error states липсват в breakdown карти и SpendRoasTrend

**Проблем:** При API грешка, `AdsBreakdown` (PlacementCard, CampaignsCard) и `SpendRoasTrend` показват "Няма данни" — операторът не разбира дали данните липсват или API-ят е счупен.

**Файлове:**
- `src/app/(dashboard)/ads/[market]/_components/AdsBreakdown.tsx:63-107, 173-204`
- `src/app/(dashboard)/ads/[market]/_components/SpendRoasTrend.tsx:49-56`

**Fix:** Деструктурирай `error` от `useSWR`. При `error && !data` — render `<ErrorState>` (или inline текст "Грешка при зареждане") вместо empty state.

**Обем:** S

---

#### P1-E: `getMetaPlacementBreakdown` — добави explicit `level: "account"`

**Проблем:** Без explicit `level` при `breakdowns` параметър поведението е недокументирано. В production работи (Meta default е `account`), но при pagination с голям акаунт рискът от truncation е реален.

**Файл:** `src/lib/meta.ts:426-432`

**Fix:** Добави `level: "account"` в params обекта.

**Обем:** XS (1 ред)

---

### P2 — По-късно / Nice-to-have

#### P2-A: Health probe Meta auth — унифициране

**Проблем:** `health/route.ts:96` ползва `Authorization: Bearer`, `meta.ts:248` ползва URL param. Meta приема и двата метода. Потенциален false-positive при token-scope проблем.

**Fix:** Обнови `metaFetch` да поддържа `Authorization: Bearer` header вместо URL param. Или приеми inconsistency-то като документирано.

**Обем:** M (засяга всички Meta production calls — трябва внимателно тестване)

---

#### P2-B: `MorningKpiStrip` — delta под hero стойностите

**Проблем:** §4 изисква delta под hero числата. Snapshot API не носи comparison data.

**Fix:** Изисква допълнителен API call за "yesterday vs day-before" или "last 7d vs previous 7d". Засяга архитектурата на `/api/agents/morning-report`. Не е бъг — страницата работи, но е по-слаба от `/ads` и `/sales`.

**Обем:** L

---

#### P2-C: Meta error body се губи при 400/403

**Проблем:** `meta.ts:253` — `await res.text()` drains but discards error body. Debug при Meta API грешки изисква re-production.

**Fix:** `const body = await res.text(); logger.error("Meta API error", { ..., body: body.slice(0, 500) });`

**Обем:** XS

---

## 4. Заключение

**Спринтът е в добро базово състояние.** Build минава, критичните потоци (KPI lenta + delta, trend chart, morning report cache, SSE streaming, inbox deep-links) работят коректно. Нито един от 10-те commita не е счупил съществуваща функционалност.

**Два от трите "съмнителни" твърдения паднаха при проверка:**
1. `[Mobile M1]` — `/ads/page.tsx` **съществува** и прави server-side redirect към `/ads/bg` — твърдението "няма page.tsx" е фактически грешно.
2. `[Mobile M4]` — ROAS tooltip NaN е **невъзможен** — `buildRechartsTooltip` ползва `payload[0].payload` = целия TrendPoint ред с и `spend`, и `roas`.
3. `[Correctness C1]` — `level` твърдението е **частично грешно** (Meta default при `/act_id/insights` е `account`, не `ad`), но препоръката за explicit `level` остава валидна.

**P0 са 2:** Mobile scrubber липсва в двата нови trend chart-а (оператор не може да инспектира стойности на мобилно); tab toggle touch targets под 44px в нов код. Двете трябва fix преди следващ deploy с мобилен трафик.

**Design agent (01-correctness: ~85%, 02-design: ~97%)** е надежден; **Mobile/Regressions agent (~65%)** трябва да подобри проверката дали файл съществува преди да го цитира като липсващ, и да провери как Recharts предава данни в `payload[0].payload`.
