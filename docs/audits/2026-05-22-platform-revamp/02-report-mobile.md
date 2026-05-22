# Mobile UX Одит — Cvetita Command Center
**Дата:** 2026-05-22
**Одитор:** Mobile UX Agent (анализ само от код — без браузър)
**Еталон:** `/sales` + `MobileScrubber` / `useChartScrubber` / `globals.css` mobile rules

---

## Резюме (общо състояние на mobile)

Платформата е **частично mobile-ready**, но с дълбок разрив между секциите. Около половината от страниците имат responsive grid-ове (`grid-cols-1 md:grid-cols-N`) и мобилни алтернативи на таблиците. Другата половина — по-старите аналитични скрийни — разчита на `overflow-x-auto + min-w-[Npx]` wrapper, което прави съдържанието хоризонтално скролируемо вместо адаптирано. Критичният проблем е **нулева mobile touch стратегия за chart-ове извън `/sales`**: `AreaLineChart`, `BarChartCard`, `DonutChart`, `FunnelChart`, `ComposedChart` в `/google-ads` — нито едно от тях не имплементира `MobileScrubber` / `useChartScrubber`, което означава native Recharts tooltip-ите остават активни под пръста (anti-pattern по §13 на design contract). Второто системно нарушение: sort-бутоните (`SortButton` компонент, `px-2.5 py-1.5`) и table header бутоните имат touch target ~28-32px вместо изискваните 44px.

---

## Страница по страница

---

### 1. `/` — Командно табло (Home)

**Файл:** `src/app/(dashboard)/page.tsx` → `KpiStrip.tsx` + `StoresTable.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | **HeroCard-овете** в `KpiStrip` нямат `MobileScrubber` — Recharts native tooltip остава активен на mobile (anti-pattern §13). Всеки chart в секциите Бизнес/Meta/Google е засегнат. _(проверено в код)_ | `KpiStrip.tsx:246-316` | P1 |
| 2 | Grid `grid-cols-1 md:grid-cols-3` в `SectionShell` — на 375px трите Hero карти се stack-ват. Добре. Но всяка карта има `min-h-[220px]` и chart с `h-[90px]` — fixed heights при dynamic content, рискуват overflow при малки шрифтове. _(проверено в код)_ | `KpiStrip.tsx:324,331,628` | P2 |
| 3 | **StoresTable мобилен вариант** (`md:hidden`) — добре имплементиран с stacked cards и 2-col grid вътре. Touch target за card-а е `p-4` без min-height — функционален, но потенциално тесен при кратко съдържание. _(проверено в код)_ | `StoresTable.tsx:328-417` | P2 |
| 4 | `TempoTooltip` в KpiStrip (ако tooltip-ите останат активни на mobile) показва tooltip директно под пръста — покрива данните. _(преценка — следствие от проблем #1)_ | `KpiStrip.tsx:254-278` | P1 |

**Текущо mobile-ready ли е:** Частично. Grid структурата е коректна. Проблемът е chart touch стратегията.
**Обем труд:** M (1-2 дни — добавяне на `useChartScrubber` + `MobileScrubberRow` за всеки от 3+ chart-а в HeroCard)
**Приоритет:** P1

---

### 2. `/inbox` — Входящи сигнали

**Файл:** `src/app/(dashboard)/inbox/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | Tab бутоните в PageHeader (`px-3 py-1`) — изчислена touch height ~30px, под минималния 44px. _(проверено в код)_ | `inbox/page.tsx:281-295` | P1 |
| 2 | Action бутоните в `CardRow` (`Button size="sm"`) — зависи от `Button` размерите, но типично `size="sm"` е ~32px. Трябва проверка на `Button.tsx`. _(преценка)_ | `inbox/page.tsx:196-205` | P1 |
| 3 | `flex-wrap gap-3` на action row-а — добре, wrap-ва на малки екрани. _(проверено в код)_ | `inbox/page.tsx:195` | OK |
| 4 | Без charts — няма scrubber проблем. Чисто съдържание. | — | OK |
| 5 | `max-w-[900px] mx-auto` — добре, не ограничава на 375px. | `inbox/page.tsx:277` | OK |

**Текущо mobile-ready ли е:** Почти. Само touch targets на tab бутоните са под норма.
**Обем труд:** S (≤ половин ден — увеличаване на py на tab бутоните до `py-2.5` минимум)
**Приоритет:** P1

---

### 3. `/agents` — AI Агенти

**Файл:** `src/app/(dashboard)/agents/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | `grid-cols-1 md:grid-cols-2` — на 375px agent cards-ите са на 1 колона, full-width. _(проверено в код)_ | `agents/page.tsx:74` | OK |
| 2 | `<Link>` card-овете нямат min-height — но съдържанието (title + description + caps) е достатъчно дълго за добър touch target. _(преценка)_ | `agents/page.tsx:79-105` | OK |
| 3 | Capability badges (`px-2 py-0.5`) — много малки (~20px), но са само визуален label, не интерактивни. _(проверено в код)_ | `agents/page.tsx:97-99` | OK |
| 4 | Без charts — без scrubber проблем. | — | OK |

**Текущо mobile-ready ли е:** Да. Чист layout, правилен grid, без charts.
**Обем труд:** S (козметика — нищо критично)
**Приоритет:** P2

---

### 4. `/products` — Продукти

**Файл:** `src/app/(dashboard)/products/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | KPI grid `grid-cols-2 md:grid-cols-5` — на 375px: 2 колони. 5-та KPI карта (`Продукти`) самостоятелно — добре. _(проверено в код)_ | `products/page.tsx:132` | OK |
| 2 | **`AreaLineChart` без mobile touch стратегия** — `height={200}`, Recharts native tooltip активен на mobile, не е обвит с `useChartScrubber`/`MobileScrubber`. Anti-pattern §13. _(проверено в код)_ | `products/page.tsx:148-157` | P1 |
| 3 | Продуктовата таблица: `overflow-x-auto -mx-5 px-5` + `min-w-[600px]` — хоризонтален scroll вместо mobile-first адаптация. Таблицата с 6 колони не може да се покаже смислено на 375px. _(проверено в код)_ | `products/page.tsx:183-184` | P1 |
| 4 | **SortButton touch targets** (~28px) в table header — под 44px. _(проверено в SortButton.tsx:22-37)_ | `products/page.tsx:189-200`, `SortButton.tsx:22` | P1 |
| 5 | `KpiWithChange` компонент използва icons (`<Icon size={16}>`) в KPI карти — нарушава design contract §3 (в analytics cards без иконки). _(проверено в код)_ | `products/page.tsx:296-304` | P2 |
| 6 | "Покажи всички" бутон (`py-2.5`) — добър touch target. _(проверено)_ | `products/page.tsx:240` | OK |
| 7 | `grid-cols-1 lg:grid-cols-3` за products + combos — на mobile: двете карти stack-нати. _(проверено)_ | `products/page.tsx:159` | OK |

**Текущо mobile-ready ли е:** Не напълно. Таблицата е "desktop в scroll" на mobile.
**Обем труд:** L (3-5 дни — трябва mobile card view за продуктите + MobileScrubber за chart-а)
**Приоритет:** P1

---

### 5. `/customers` — Клиенти

**Файл:** `src/app/(dashboard)/customers/page.tsx` + `_components/`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | Tab бутони в customers page: `px-4 py-2.5` — ~38px height. Под 44px, но приемливо. _(проверено в код)_ | `customers/page.tsx:53` | P2 |
| 2 | **CustomerListTab — добра mobile имплементация.** Има изрични `hidden md:block` (desktop table) и `md:hidden` (mobile cards) алтернативи. _(проверено в код)_ | `CustomerListTab.tsx:327,394` | OK |
| 3 | Mobile cards имат `!p-4` + flex layout — добър touch target per card. _(проверено)_ | `CustomerListTab.tsx:403` | OK |
| 4 | Filter chips `px-3 py-1.5` — ~30px, под 44px. На mobile filter bar-ът е основна навигация. _(проверено в код)_ | `CustomerListTab.tsx:241` | P1 |
| 5 | Date inputs (`py-1.5`) — нативни input, обработени от OS, приемливо. _(преценка)_ | `CustomerListTab.tsx:258` | OK |
| 6 | **`CustomerAnalyticsTab` — `HeatmapGrid` за cohort retention.** `min-w-[600px]` с overflow-x-auto — на 375px прави хоризонтален scroll на 8-column heatmap. Design contract §9.6 изисква колапс на heatmap под `md:`. _(проверено в код)_ | `CustomerAnalyticsTab.tsx:126-137`, `HeatmapGrid.tsx:80` | P1 |
| 7 | **`DonutChart` в CustomerAnalytics** — colors `["#007aff", "#22c55e"]` нарушава design contract §1 (categorical colours). _(проверено в код)_ | `CustomerAnalyticsTab.tsx:111` | P2 |
| 8 | `BarChartCard` в CustomerAnalytics без MobileScrubber — anti-pattern §13. _(проверено в код)_ | `CustomerAnalyticsTab.tsx:115-123` | P1 |
| 9 | KPI grid `grid-cols-2 md:grid-cols-3 lg:grid-cols-6` — на 375px: 2 колони, 3 реда. OK. _(проверено)_ | `CustomerAnalyticsTab.tsx:92` | OK |

**Текущо mobile-ready ли е:** Списък таб — добре. Аналитика таб — не.
**Обем труд:** M (1-2 дни — HeatmapGrid mobile collapse + scrubbers за charts)
**Приоритет:** P1

---

### 6. `/traffic` — Трафик & SEO

**Файл:** `src/app/(dashboard)/traffic/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | KPI grid `grid-cols-2 md:grid-cols-5` — на 375px: 2 col, 3 реда. MiniKpi компонентите имат sparklines (SparkLine component). _(проверено)_ | `traffic/page.tsx:196` | OK |
| 2 | **`FunnelChart` без MobileScrubber** — Recharts native tooltip на mobile. _(проверено в код)_ | `traffic/page.tsx:238-244` | P1 |
| 3 | `DonutChart` за устройства — нямаме видимост дали има mobile touch handler. Recharts DonutChart-ите имат native tooltip, anti-pattern §13. _(проверено в DonutChart — не виждам MobileScrubber)_ | `traffic/page.tsx:329-337` | P1 |
| 4 | Таблица "Източник / медия": `overflow-x-auto -mx-5 px-5` + `min-w-[500px]` — хоризонтален scroll на mobile. Пет колони не се събират на 375px. _(проверено в код)_ | `traffic/page.tsx:285-286` | P1 |
| 5 | Таблица "Топ страници": `min-w-[600px]` с 6 колони — хоризонтален scroll. _(проверено в код)_ | `traffic/page.tsx:359-360` | P1 |
| 6 | Sort бутони за Топ Страници (`px-2 py-1` + `text-[11px]`) — ~24px touch height, значително под 44px. _(проверено в код)_ | `traffic/page.tsx:344-356` | P1 |
| 7 | Липсва `DateRangePicker` в mobile-friendly позиция — но PageHeader го пази. _(OK)_ | `traffic/page.tsx:191` | OK |
| 8 | `grid-cols-1 lg:grid-cols-3` за funnel + events и за source/donut — на mobile двете карти stack-ват. _(проверено)_ | `traffic/page.tsx:235,279` | OK |

**Текущо mobile-ready ли е:** Не. Таблиците са "desktop в scroll", chart-овете без touch стратегия.
**Обем труд:** L (3-5 дни — mobile card views за двете таблици + scrubbers за 2 charts + sort button touch targets)
**Приоритет:** P1

---

### 7. `/email` — Имейл Маркетинг

**Файл:** `src/app/(dashboard)/email/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | KPI grid `grid-cols-2 md:grid-cols-4` — на 375px: 2 col, 2 реда. OK. _(проверено)_ | `email/page.tsx:204` | OK |
| 2 | **`BarChartCard` "Flows по Revenue" без MobileScrubber** — horizontal bar chart, Recharts native tooltip. Anti-pattern §13. _(проверено в код)_ | `email/page.tsx:223-233` | P1 |
| 3 | Campaigns таблица: `overflow-x-auto -mx-5 px-5` + `min-w-[500px]` — хоризонтален scroll на mobile. _(проверено в код)_ | `email/page.tsx:265-266` | P1 |
| 4 | **SortButton touch targets** в campaign header — ~28-32px. _(проверено в SortButton.tsx)_ | `email/page.tsx:272-283` | P1 |
| 5 | FilterPill бутони (`px-3 py-1.5`) — ~30px, под 44px. _(проверено в SortButton.tsx:53-64)_ | `email/page.tsx:246-261` | P1 |
| 6 | Flows list — `Link` items с `py-3 px-2` — ~38px. Приемливо, но леко под 44px. _(проверено)_ | `email/page.tsx:356` | P2 |
| 7 | MiniKpi-тата имат icons (icon prop подаден) — нарушение на design contract §3 за analytics. _(проверено в код)_ | `email/page.tsx:205-218` | P2 |

**Текущо mobile-ready ли е:** Не. Таблицата е "desktop в scroll", chart-ът без touch стратегия.
**Обем труд:** M (1-2 дни — scrubber за bar chart + mobile collapse за campaign table)
**Приоритет:** P1

---

### 8. `/ads/[market]` — Meta Реклами

**Файл:** `src/app/(dashboard)/ads/[market]/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | KPI row `grid-cols-2 md:grid-cols-3 lg:grid-cols-6` — на 375px: 2 col, 3 реда. OK. _(проверено)_ | `ads/[market]/page.tsx:376` | OK |
| 2 | Sort + filter toolbar: `flex items-center justify-between flex-wrap gap-3` — wrap-ва на mobile. _(проверено)_ | `ads/[market]/page.tsx:412` | OK |
| 3 | Sort бутони `px-2.5 py-1.5` (~28-32px) — под 44px. Много от тях наведнъж на mobile. _(проверено в код)_ | `ads/[market]/page.tsx:415-425` | P1 |
| 4 | Search input `w-36 md:w-48` — 144px на mobile. Достатъчно широко за BG думи? Минималното е OK, но tight. _(проверено)_ | `ads/[market]/page.tsx:436` | P2 |
| 5 | **Masonry grid** `breakpointCols={{ default: 3, 1024: 2, 640: 1 }}` — на 375px (<640px): 1 колона. Добре. _(проверено в код)_ | `ads/[market]/page.tsx:459,465` | OK |
| 6 | **AdModal** — `w-full h-full md:h-auto md:max-h-[90vh] md:max-w-lg` — на mobile: fullscreen modal. Добре за mobile. Sticky header/footer с backdrop. _(проверено в код)_ | `ads/[market]/page.tsx:622` | OK |
| 7 | ScoreBar labels в modal (`text-[11px]`) + score badge (`w-10 h-10`) — touch targets ОК за информационни елементи, не интерактивни. _(OK)_ | `ads/[market]/page.tsx:565` | OK |
| 8 | MiniKpi-тата с icons (icon prop) — нарушение §3. _(проверено)_ | `ads/[market]/page.tsx:381-387` | P2 |
| 9 | Пауза/Активирай бутон в card: `py-1.5 text-[12px]` — ~30px. Основно действие, трябва ≥44px. _(проверено)_ | `ads/[market]/page.tsx:597-599` | P1 |
| 10 | Без charts на тази страница — нямаме scrubber проблем. _(OK)_ | — | OK |

**Текущо mobile-ready ли е:** Да за layout. Не за touch targets.
**Обем труд:** S (половин ден — увеличаване на touch targets на sort бутони и пауза бутон)
**Приоритет:** P1

---

### 9. `/google-ads` — Google Ads

**Файл:** `src/app/(dashboard)/google-ads/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | KPI grid `grid-cols-2 md:grid-cols-5` — на 375px: 2 col. OK. _(проверено)_ | `google-ads/page.tsx:197` | OK |
| 2 | Brand vs Non-Brand split: `grid-cols-1 md:grid-cols-2` — на 375px: 1 col, stack-нати. OK. _(проверено)_ | `google-ads/page.tsx:236` | OK |
| 3 | **ComposedChart (Spend + ROAS) — директен Recharts без MobileScrubber.** `h-[260px]` fixed height, native Recharts Tooltip активен на mobile. Combo chart на mobile трябва tab toggle или scrubber (§9.4, §9.6). Нито едното. _(проверено в код)_ | `google-ads/page.tsx:284-347` | **P0** |
| 4 | Combo chart нарушава и §9.4 — на mobile combo charts трябва да колапсват към tab toggle. _(проверено в код)_ | `google-ads/page.tsx:288-347` | **P0** |
| 5 | Campaign table: `overflow-x-auto -mx-5 px-5` + **`min-w-[900px]`** — 900px е най-широкото в цялата платформа. На 375px: 9-колонна таблица зад хоризонтален scroll. Изключително трудна за ползване. _(проверено в код)_ | `google-ads/page.tsx:402-403` | **P0** |
| 6 | Sort/filter controls в table header: inline `flex items-center gap-2` с 4 sort бутона + 3 view бутона — всичко на един ред в CardHeader. На mobile `flex-wrap` липсва → хоризонтален overflow в header. _(проверено в код)_ | `google-ads/page.tsx:365-396` | P1 |
| 7 | Sort бутони `px-2 py-1` + `text-[11px]` — ~24px touch height. _(проверено)_ | `google-ads/page.tsx:373-390` | P1 |
| 8 | MiniKpi с sparklines — добре. _(OK)_ | `google-ads/page.tsx:198-233` | OK |

**Текущо mobile-ready ли е:** Не. P0 проблеми.
**Обем труд:** L (3-5 дни — mobile tab toggle за combo chart + mobile card view за campaign table + flex-wrap controls)
**Приоритет:** P0

---

### 10. `/competitors` — Конкуренти

**Файл:** `src/app/(dashboard)/competitors/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | Competitor cards: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` — на 375px: 1 col. OK. _(проверено)_ | `competitors/page.tsx:133, 176` | OK |
| 2 | Add form: `grid-cols-1 md:grid-cols-4` — на 375px: 1 col, stack-нати inputs. OK. _(проверено)_ | `competitors/page.tsx:154` | OK |
| 3 | "Scan" бутон `py-2` — ~32px. Основно action, под 44px. _(проверено)_ | `competitors/page.tsx:373-388` | P1 |
| 4 | "Meta Ad Library" link `py-2` — ~32px. _(проверено)_ | `competitors/page.tsx:345-352` | P1 |
| 5 | Alert row items `py-2` — ~32px. Не са primary actions, по-малко критично. _(преценка)_ | `competitors/page.tsx:251` | P2 |
| 6 | Без charts — без scrubber проблем. _(OK)_ | — | OK |
| 7 | Competitor card metrics grid `grid-cols-3 gap-3` — 3 тесни колони на 375px. Данните (текст) могат да се препокрият. _(преценка)_ | `competitors/page.tsx:314` | P2 |

**Текущо mobile-ready ли е:** Да за layout. Малки touch target проблеми.
**Обем труд:** S (половин ден)
**Приоритет:** P1

---

### 11. `/settings` — Настройки

**Файл:** `src/app/(dashboard)/settings/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | Главен grid: `grid-cols-1 lg:grid-cols-2` — на 375px: 1 col. OK. _(проверено)_ | `settings/page.tsx:57` | OK |
| 2 | Integrations grid: `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` — на 375px: 2 col. OK. _(проверено)_ | `settings/page.tsx:351` | OK |
| 3 | Field inputs `py-2.5 text-[14px]` — добри touch targets (~40px). _(проверено)_ | `settings/page.tsx:383` | OK |
| 4 | Save бутон `w-full` — пълна ширина = добър touch. _(проверено)_ | `settings/page.tsx:189` | OK |
| 5 | `grid-cols-1 md:grid-cols-2` за EGN/Длъжност и Град/Дата — stack-нати на mobile. OK. _(проверено)_ | `settings/page.tsx:154,168` | OK |
| 6 | IntegrationBadge-ите нямат интерактивност — само визуални. OK. _(проверено)_ | — | OK |

**Текущо mobile-ready ли е:** Да. Форм страниците са добре адаптирани.
**Обем труд:** S (козметика)
**Приоритет:** P2

---

### 12. `/hr` — HR Модул

**Файл:** `src/app/(dashboard)/hr/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | KPI tiles: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` — на 375px: 1 col. Четири карти stack-нати. Прекалено голяма вертикална дължина, но функционално. _(проверено)_ | `hr/page.tsx:112` | P2 |
| 2 | Icons в KpiTile — допустими тук (не е analytics screen). OK. _(проверено)_ | `hr/page.tsx:214-216` | OK |
| 3 | Бутони "Виж график" / "Нова заявка" — `<Button>` без size prop, вероятно пълен размер. OK. _(преценка)_ | `hr/page.tsx:149,184` | OK |
| 4 | `grid-cols-1 lg:grid-cols-2` за cards — на 375px: 1 col. OK. _(проверено)_ | `hr/page.tsx:140` | OK |
| 5 | Leave request list items `py-1.5` — ~26px. Само информационни редове без action. OK. _(преценка)_ | `hr/page.tsx:165` | OK |

**Текущо mobile-ready ли е:** Да.
**Обем труд:** S (козметика — може grid-cols-2 за KPI tiles на mobile)
**Приоритет:** P2

---

### 13. `/morning-report` — Сутрешен Доклад

**Файл:** `src/app/(dashboard)/morning-report/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | "Генерирай нов" бутон `px-4 py-2` — ~36px touch height. Основно действие, под 44px. _(проверено в код)_ | `morning-report/page.tsx:83` | P1 |
| 2 | `max-w-4xl` — не ограничава на 375px. OK. _(проверено)_ | `morning-report/page.tsx:96` | OK |
| 3 | Markdown рендериране в `Card` с `p-6` — функционален на mobile. _(OK)_ | `morning-report/page.tsx:117` | OK |
| 4 | **Не е в sidebar навигацията** — потребителят трябва да го открие чрез `/agents`. UX проблем. _(проверено в 00-BRIEF.md:43)_ | N/A | P1 |

**Текущо mobile-ready ли е:** Да. Прост text-based layout.
**Обем труд:** S (touch target fix + sidebar навигация)
**Приоритет:** P1

---

### 14. `/analysis` — Команден Чат

**Файл:** `src/app/(dashboard)/analysis/page.tsx`

#### Mobile проблеми

| # | Проблем | Файл:ред | Тежест |
|---|---------|----------|--------|
| 1 | `h-[calc(100vh-var(--topbar-height)-48px)]` — фиксирана viewport height. На mobile (iOS Safari с variable toolbar) `100vh` е ненадежден — може да се покрие с OS chrome. Трябва `100dvh` или `svh`. _(проверено в код)_ | `analysis/page.tsx:209` | P1 |
| 2 | Send бутон `w-8 h-8` (32px) — под 44px. Основно действие. _(проверено в код)_ | `analysis/page.tsx:334` | P1 |
| 3 | Suggestion бутони `px-4 py-3` — ~44px height. Добре. _(проверено)_ | `analysis/page.tsx:239` | OK |
| 4 | Textarea `min-h-[36px]` — приемливо. _(проверено)_ | `analysis/page.tsx:328` | OK |
| 5 | `flex-1 overflow-y-auto min-h-0` за chat area — правилна flex имплементация. _(проверено)_ | `analysis/page.tsx:226` | OK |
| 6 | Source cards бутон `hover:text-purple-500` — само hover state, без focus-visible, но acceptably small action. _(преценка)_ | `analysis/page.tsx:42-43` | P2 |
| 7 | **Не е в sidebar навигацията** — вижда се само от `/agents`. _(проверено в 00-BRIEF.md:44)_ | N/A | P1 |

**Текущо mobile-ready ли е:** Почти. `100vh` е известен iOS проблем.
**Обем труд:** S (fix на `100vh` → `100dvh` + send button touch target)
**Приоритет:** P1

---

## Системни (cross-platform) проблеми

### A. Нулева chart touch стратегия извън `/sales`

**Засегнати компоненти:** `AreaLineChart.tsx`, `BarChartCard.tsx`, `DonutChart.tsx`, `FunnelChart.tsx`, inline Recharts в `google-ads/page.tsx`

`globals.css:187-192` мутира `.recharts-wrapper` pointer events на `@media (max-width: 767px)` — това означава native tooltip-ите са вече заглушени. Но без `MobileScrubber` + `useChartScrubber`, chart-овете стават **напълно неинтерактивни на mobile** — потребителят не може да инспектира никоя точка. Това е по-лошо от native tooltip: chart показва данни, но не дава начин да ги прочетеш точно. Необходимо е или: (a) добавяне на scrubber към всеки chart компонент, или (b) показване само на stateless визуализации на mobile (без tooltip).

### B. SortButton touch targets (~28-32px навсякъде)

`SortButton.tsx:22` — `px-2.5 py-1.5` дава ~30px. CLAUDE.md принцип #2 изисква 44px min. Всяка страница с sortable table е засегната: `/products`, `/email`, `/traffic`, `/google-ads`. Решение: добавяне на `min-h-[44px]` или `py-3` на `SortButton`.

### C. HeatmapGrid без mobile collapse

`HeatmapGrid.tsx:80` — `min-w-[600px]` без `md:` conditional. Design contract §9.6 изрично: "Heatmap колапсва до weekday summary под `md:`". Засегнати: `/customers` (cohort retention), евентуално `/hr/schedule`. Нужен е responsive wrapper или weekday-only view под md.

### D. Icons в KPI картите на analytics екрани

`products/page.tsx`, `email/page.tsx`, `ads/[market]/page.tsx`, `customers/CustomerAnalyticsTab.tsx` — всички използват `icon` prop на `MiniKpi`. Design contract §3: "В analytics екрани `icon` не се подава." Не е mobile-специфичен проблем, но е системно нарушение.

### E. `morning-report` и `analysis` извън sidebar

Двете AI-powered страници са скрити от sidebar (виж 00-BRIEF.md:43-44). На mobile това е критично — потребителят не може да ги открие без да знае URL-то. Трябва флагване към навигационния architect.

---

## Топ mobile проблеми за цялата платформа

| Ранг | Проблем | Засегнати страници | Обем | Приоритет |
|------|---------|-------------------|------|-----------|
| 1 | **Combo chart без mobile tab toggle** — `/google-ads` ComposedChart е P0 нарушение на §9.4/§9.6 | `/google-ads` | M | **P0** |
| 2 | **Campaign table min-w-[900px]** — 9 колони зад scroll, неизползваема на mobile | `/google-ads` | M | **P0** |
| 3 | **Всички charts извън `/sales` без MobileScrubber** — chart-овете са тихо неинтерактивни на mobile (pointer-events muted, scrubber липсва) | `/products`, `/traffic`, `/email`, `/customers`, Home KpiStrip | L | P1 |
| 4 | **SortButton touch targets ~30px** (нужно 44px) — системен проблем в `SortButton.tsx` | `/products`, `/email`, `/traffic`, `/google-ads` | S | P1 |
| 5 | **HeatmapGrid без mobile collapse** — §9.6 нарушение | `/customers` | M | P1 |
| 6 | **Source/medium и топ-pages таблици** в `/traffic` — `min-w-[500-600px]` scroll вместо адаптация | `/traffic` | M | P1 |
| 7 | **`100vh` в `/analysis`** — iOS Safari variable toolbar проблем | `/analysis` | S | P1 |
| 8 | **Inbox / Customers filter chip touch targets** (~30px) | `/inbox`, `/customers` | S | P1 |
| 9 | **Продуктова таблица без mobile card view** | `/products` | M | P1 |
| 10 | **Morning report + Analysis не в sidebar** | навигация | S | P1 |
| 11 | **Icons в analytics KPI карти** (§3 нарушение) | `/products`, `/email`, `/ads`, `/customers` | S | P2 |
| 12 | **DonutChart категорийни цветове** в `/customers` | `/customers` | S | P2 |

---

## Легенда за верификация

- _(проверено в код)_ — твърдението е верифицирано с конкретен файл:ред
- _(преценка)_ — логически извод от кода, без директен counter-evidence; може да е погрешно при runtime условия

---

*Репорт генериран от mobile UX agent, 2026-05-22. Анализ само от Tailwind класове и компонентна структура — без браузър/visual тест.*
