# 🏛️ Platform Revamp — Птичи поглед и Roadmap

> **Дата:** 2026-05-22
> **Метод:** 3 ревю-агента (Data/API, Mobile, Design) → 2 одитора (технически, creative) → синтез.
> **Източници:** `01`–`05` в тази папка. Този документ ги консолидира с приложени корекции от одиторите.
> **Цел:** честна оценка на труда между сегашното състояние и „ЦРУ-like intelligence hub", еталон `/sales`.

---

## Изпълнително резюме

Платформата **не страда от липса на интеграции** — Shopify, GA4, Klaviyo, Meta, Supabase
sync pipeline всички работят. Страда от **слаба консумация** и **визуален дълг**. Има два слоя:

- **Горен слой** (`/sales`, `/traffic`, `/`, частично `/google-ads`) — близо до договора.
- **Долен слой** (`/products`, `/email`, `/customers`, `/ads`, `/hr`, `/analysis`, `/competitors`,
  `/settings`) — изостава с едно поколение: иконки до всяко KPI, inline tooltip-и вместо
  `GlassTooltip`, charts тихо неинтерактивни на mobile, един магазин вместо multi-store.

**Надеждност на одита: ~87%** (по техническия одитор). Репортите не преувеличават.
Три фактически корекции бяха приложени (виж „Корекции" по-долу).

**Ключовият извод на creative одитора:** агентите одитираха страница-по-страница, но
гръбнакът на ЦРУ хъба не е една страница — той е **верига**: „как е бизнесът днес"
(`/morning-report`) → „какво се обърка" (`/inbox`) → „защо/колко" (`/sales`, `/ads`) →
„какво да направя" (deep-link към действие). Тази верига днес е накъсана — затова
`/morning-report` и `/inbox` deep-links се покачват до **P0**, въпреки че ревю-агентите
ги дадоха P1/P2.

---

## Матрица: страница по страница (консолидирана, верифицирана)

Ниво 1–5 (5 = на нивото на `/sales`). Приоритет и обем — **след** корекциите на одиторите.

| Страница | Ниво сега | Целево състояние | Главен gap | Обем | Приоритет |
|---|:--:|---|---|:--:|:--:|
| `/sales` | **5** | — | еталон, не се пипа | — | ✅ |
| `/` Дашборд | **4** | cross-platform briefing + Klaviyo revenue + pacing arc | `orders` като smooth area (тр. bars §9.2); `TempoTooltip` ≠ `GlassTooltip` | S–M | P1 |
| `/inbox` | **3** | действена сигнална система с deep-links | `target_id` в schema, но никаква навигация към проблема; severity цветове извън token система | S | **P0** |
| `/morning-report` | **2** | входна точка на хъба — sidebar nav + кеш + clickable KPI strip | не е в навигацията; нов AI call при всеки refresh (~$0.50–1); само markdown | M | **P0** |
| `/ads` (Meta) | **3–4** | overview с delta + trend chart + placement breakdown | KPI strip без delta/comparison; score bars ползват blue/orange (§1) | M | **P0** |
| `/google-ads` | **3** | mobile-използваема + search terms | combo chart без mobile tab toggle; таблица `min-w-[900px]`; inline Recharts tooltip | L | **P0** |
| `/settings` | **2** | live integration health check | **хардкоднат** интеграционен статус — нарушава Real Data Only | S | **P0** |
| `/analysis` | **2** | команден чат с identity + persistence | не е в sidebar; `purple-500` като отделен design system; `100vh` чупи iOS; chat не persist-ва | S–M | P1 |
| `/traffic` | **3–4** | GA4 с geo + hour×weekday rhythm | само BG property; липсва geo/rhythm; празни delta labels | M | P1 |
| `/email` | **2** | имейл-канал здраве, не само кампания tracker | KPI без delta; липсва deliverability (`bounce`/`unsub`); icons на KPI (§3) | M | P1 |
| `/products` | **2** | multi-source: Shopify + GA4 sessions + inventory | само BG store; нула GA4; `KpiWithChange` с иконки вместо `MiniKpi hero` | L | P1 |
| `/customers` | **2–3** | retention + LTV, multi-store | donut с категориен blue (§1); icons; heatmap без mobile collapse | M | P1 |
| `/competitors` | **2–3** | автоматизиран watchdog, не ръчен scan | няма cron scan; цените се пазят, но няма price trend chart | M | P1 |
| `/agents` | **1–2** | AI mission control с live feed | нула данни — статична gallery; 4 категорийни цвята (§1) | M | P2 |
| `/hr` | **2** | козметика до договора (извън ЦРУ scope) | `KpiTile` с иконки + uppercase tracking | S | P2 |

---

## Системни (cross-cutting) проблеми — поправят се веднъж, ползват се навсякъде

Тези **не са** per-page работа. Правят се като споделени sprints преди (или паралелно с) страниците.

| # | Проблем | Засяга | Решение | Обем |
|---|---|---|---|:--:|
| C1 | **§3 иконки до KPI числа** | `/products`, `/email`, `/customers`, `/hr`, `/ads` | `analytics` prop на споделените KPI компоненти (`MiniKpi`/`KpiWithChange`/`KpiTile`) → една поправка, всяка страница се изчиства при reuse | S |
| C2 | **`GlassTooltip` не се ползва** — inline Recharts tooltip | `DonutChart`, `BarChartCard`, `AreaLineChart`, `/google-ads` inline, `TempoTooltip` | `buildRechartsTooltip()` factory + рефактор на 5-те компонента (провери дали factory вече съществува) | M |
| C3 | **SortButton ~30px touch target** (тр. 44px) | `/products`, `/email`, `/traffic`, `/google-ads` | `min-h-[44px]` в `SortButton.tsx` — една поправка | S |
| C4 | **Charts тихо неинтерактивни на mobile** — `globals.css` глуши Recharts pointer events, но няма scrubber извън `/sales` | всички chart страници | извади `useChartScrubber`/`MobileScrubber` от `/sales` като reusable, приложи | L |
| C5 | **Cross-page navigation липсва** (не е одитирано — flagнато от creative) | цялата платформа | breadcrumbs + focus-param routing (`?focus=<id>`), workflow верига Inbox→drill-down | M |
| C6 | **Нехомогенни skeleton/empty/error states** | долен слой | единна skeleton стратегия по модела на `/sales` | M |
| C7 | **`--ai` CSS token** | `/analysis` | дефинирай `--ai` в `globals.css` вместо `purple-500` — chat запазва identity, договорът се спазва | XS |

---

## Корекции, приложени след одита (не вярвай на ревю-репортите тук буквално)

1. **`inventory_quantity` НЕ е „само да се expose-не".** Намира се само в `fetchProductCatalog()`;
   `/products` route ползва `fetchAllProducts()`, която не заявява `variants`. Нужна е реална
   промяна в route-а. (технически одитор)
2. **FunnelChart НЯМА Recharts tooltip проблем.** Той е чист HTML/CSS компонент. Mobile
   репортът греши тук — премахни го от §13 списъка. (технически одитор)
3. **Multi-store за `/products` и `/customers` е XL, не L.** Тези route-ове правят директни
   Shopify REST заявки; Supabase aggregate pattern от `/sales` покрива дневни суми, не
   product/customer-level данни. Нужен е нов aggregate слой. (технически одитор)
4. **GA4-based wins за `/google-ads`** (`searchTerm`, `adGroup`) са **S**, не M — само нови
   `runReport()` в съществуващ route. (технически одитор)
5. **`/products` сваля се P0 → P1.** Работи с реални BG данни; multi-store/GA4 е важно,
   не блокиращо. (creative одитор)
6. **`/competitors` качва се P2 → P1.** Автоматизираният scan е стратегически слой, не
   nice-to-have. (creative одитор)
7. **HR overtime chart — отхвърлено.** HR не е част от intelligence-hub слоя — scope creep. (creative)

---

## Roadmap (4 фази)

### Фаза 0 — Основи (~1 седмица) — отключва всичко останало

C1 shared KPI компонент · C2 GlassTooltip factory · C3 SortButton 44px ·
C4 reusable mobile scrubber · C7 `--ai` token.

> Защо първо: всяка следваща страница reuse-ва тези. Ако ги правим per-page, плащаме 6 пъти.

### Фаза 1 — Гръбнакът (P0, ~2 седмици)

`/settings` live health (S) · `/morning-report` sidebar+persist+KPI strip (M) ·
`/inbox` deep-links + severity tokens (S) · `/ads` delta KPIs + trend chart + placement breakdown (M) ·
`/google-ads` mobile fix: combo tab toggle + table card view (L).

> След Фаза 1 веригата „как е бизнесът → какво се обърка → защо → действие" е цяла.

### Фаза 2 — Отчетните страници до ниво `/sales` (P1, ~2–3 седмици)

`/traffic` geo + rhythm heatmap + delta labels (M) · `/email` deliverability + delta + trend (M) ·
`/products` GA4 sessions + design-contract миграция (L) · `/customers` LTV histogram + heatmap mobile + дизайн (M) ·
`/analysis` sidebar + session persist + `100dvh` (M) · `/competitors` auto-scan cron + price history (M) ·
`/` Home: orders→bars + pacing arc + Klaviyo revenue (S).

### Фаза 3 — Multi-store + напреднало (P1–P2, ~3+ седмици)

Multi-store aggregate слой за `/products` + `/customers` + `/traffic` (**XL всяко**) ·
`/agents` → AI mission control (M) · `/hr` козметика (S) · C5 cross-page navigation workstream (M).

---

## Груба оценка на труда

| Фаза | Съдържание | Обем |
|---|---|---|
| 0 | 5 cross-cutting sprints | ~5 чов.-дни |
| 1 | Гръбнак, 5 страници (P0) | ~8–10 чов.-дни |
| 2 | 7 страници до еталон (P1) | ~12–15 чов.-дни |
| 3 | Multi-store + advanced | ~15+ чов.-дни |
| | **Общо до пълен ЦРУ хъб** | **~6–8 седмици фокусирана работа** |

Ако целта е „платформата изглежда и работи на ниво `/sales`" без multi-store —
**Фази 0+1+2 ≈ 4–5 седмици** дават 90% от визуалния и UX скок.

---

## Топ 10 действия, подредени по impact/effort

| # | Действие | Страница | Обем | Приоритет |
|---|---|---|:--:|:--:|
| 1 | Live integration health check (край на хардкодания статус) | `/settings` | S | P0 |
| 2 | Inbox deep-links (`target_id` → `?focus=`) | `/inbox` | S | P0 |
| 3 | Shared KPI компонент — край на §3 иконките навсякъде | cross | S | P0 |
| 4 | `/ads` delta KPIs + trend chart (данните вече са в Supabase, 0 нови calls) | `/ads` | M | P0 |
| 5 | `/morning-report` → sidebar + Supabase persist + KPI strip | `/morning-report` | M | P0 |
| 6 | `/google-ads` mobile: combo tab toggle + table card view | `/google-ads` | L | P0 |
| 7 | Meta placement breakdown card | `/ads` | M | P0 |
| 8 | GlassTooltip factory + рефактор на 5 charts | cross | M | P1 |
| 9 | GA4 geo + hour×weekday rhythm heatmap | `/traffic` | M | P1 |
| 10 | Deliverability KPIs (`bounce`/`unsub`) в email overview | `/email` | S | P1 |

---

## Какво липсваше изцяло в ревю-репортите (flagнато от creative одитора)

- **Cross-page navigation** — платформата е 12 изолирани страници с обща sidebar; няма
  workflow верига, breadcrumbs, или focus-param routing. → C5.
- **AI overlays дисциплина** — memory правилото „AI insights само в `/inbox` и `/morning-report`,
  никога inline в analytics" не е проверено за консистентност. Запази го като explicit rule.
- **URL state consistency** — `/email` и `/customers` вероятно пазят датите в component state,
  не URL → операторът не може да bookmark-не view. Провери и уеднакви с `useDateRange`.
- **First-run / onboarding** — нова инсталация с нулеви интеграции: какво вижда операторът?
- **Real-time awareness** — Inbox poll-ва на 60s, но няма browser badge/notification при P0 сигнал.

---

## Бележка за визуалните „изображения на продажбите"

Одитът е код-базиран (по правилото да не пускаме visual preview за platform UI). За реални
before/after screenshots — най-чисто е да се дръпнат от Vercel deploy-а. При желание, следваща
стъпка може да е описателни before/after мокъпи на гръбначните страници (`/morning-report`,
`/inbox`, `/ads`) като част от upgrade презентацията.

---

*Синтез генериран от оркестратора, 2026-05-22. Базиран на `00`–`05` в тази папка.*
