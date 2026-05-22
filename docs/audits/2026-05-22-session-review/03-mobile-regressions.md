# 03 — Mobile & Regressions Audit

**Спринт:** `36bb387..26b6433` (10 commit-а, 2026-05-22)
**Ревизор:** Mobile/Regressions
**Дата:** 2026-05-22

---

## Резюме

Спринтът е добре изпълнен от мобилна гледна точка — двата combo чарта (`SpendRoasTrend`, `GoogleAdsTrend`) правилно имплементират §9.6 tab toggle с `md:hidden` / `hidden md:block` разделение, campaign table-ът се сгъва в card view на mobile. GlassTooltip рефакторът е успешен: старите `contentStyle`/`formatter` inline-ове са отстранени, трите компонента минават durant `buildRechartsTooltip` — без loadpath рекурсии, без dead imports.

**Намерени проблеми:** 5 находки, от които 1 🔴 (runtime), 2 🟠 (риск/договор), 2 🟡 (подобрения).

---

## Таблица — топ находки

| # | Severity | Файл:ред | Описание |
|---|---|---|---|
| 1 | 🔴 | `morning-report/page.tsx:43–51` | `/ads` link в KPI strip води до `/ads` (redirect страница), не до конкретен `/ads/[market]`. Потребителят вероятно получава празен избор на market. |
| 2 | 🟠 | `google-ads/page.tsx:56, 408, 422` | Tab toggle + sort бутони = `py-1` (≈24–28px) — под 44px CLAUDE.md принцип #2. SortButton компонентът (commit `9af0411`) вече ги спазва, но `/google-ads` ги пише inline без `min-h-[44px]`. |
| 3 | 🟠 | `inbox/page.tsx:230–233` | Бутонът „Прегледай" ползва `Button size="sm"` (= `py-1.5`) — ~34px на мобилен Safari. Под 44px изискването. |
| 4 | 🟡 | `SpendRoasTrend.tsx:109–126` | Mobile tooltip при ROAS таб ще покаже и `Разход` ред (=0 или NaN на дни без spend), защото `tooltipContent` е споделен за двата таба, но `LineChart`-ът за ROAS не праща `spend` в payload. |
| 5 | 🟡 | `ads/[market]/page.tsx:460–502` | Sort/filter бутони (`py-1.5` = ~34px) нямат `min-h-[44px]`. Нов код, не реализира 44px от commit `9af0411`. |

---

## Детайлни находки

### 1. 🔴 Morning-report KPI strip — `/ads` link води до market selector, не до конкретен пазар

**Файл:** `src/app/(dashboard)/morning-report/page.tsx:36`

```tsx
{ href: "/ads", label: "ROAS · 7д", value: … }
```

`/ads` е страница за избор на market — без `[market]` параметър. Ако потребителят кликне, ще види празен/недефиниран market избор, а не рекламните данни. Правилният path е `/ads/bg` (или динамично четен от Supabase/settings). За сравнение — `/sales` и `/traffic` са валидни statични routes.

**Белег:** проверено в кода, не само преценка — в `src/app/(dashboard)/ads/` директорията няма `page.tsx` без `[market]`.

---

### 2. 🟠 `/google-ads` tab toggle и sort бутони — под 44px touch target

**Файл:** `src/app/(dashboard)/google-ads/page.tsx`

- Ред 56: `px-2.5 py-1` → ≈28px height. Мобилен tab toggle за `spend`/`roas`.
- Ред 408: `px-2.5 py-1` → ≈28px. View filter (Всички/Brand/Non-Brand).
- Ред 422: `px-2 py-1` → ≈24px. Sort бутони.

Commit `9af0411` (същия спринт!) добавя `min-h-[44px]` в `SortButton` и `FilterPill`. Но `/google-ads/page.tsx` не ползва тези компоненти — пише inline бутони без `min-h-[44px]`. Несъответствие между декларирания fix и новия код.

**Засегнат само mobile** — `hidden md:block` wrapper го скрива на desktop.

---

### 3. 🟠 Inbox „Прегледай" бутон — `Button size="sm"` = ~34px

**Файл:** `src/app/(dashboard)/inbox/page.tsx:230`

```tsx
<Button size="sm" variant="secondary" onClick={() => router.push(href)}>
  <ArrowRight size={14} /> Прегледай
</Button>
```

`Button` компонентът при `size="sm"` прилага `py-1.5` (`src/components/shared/Button.tsx:21`). При `text-[12px]` line-height ≈16px → total height ≈ 3+16+3 = 22px... с padding `py-1.5` = 6px × 2 + 16px = 28px. Под 44px минимум за комфортен touch.

Commit `0df943e` добавя тези бутони — но не добавя `min-h-[44px]` към `Button size="sm"`. Рискът е специфичен за mobile при наредени карти с малки бутони.

---

### 4. 🟡 SpendRoasTrend — споделен tooltip при ROAS таб може да рендира `Разход: NaN €`

**Файл:** `src/app/(dashboard)/ads/[market]/_components/SpendRoasTrend.tsx:31–37, 109–126`

```tsx
const tooltipContent = buildRechartsTooltip<TrendPoint>((row) => ({
  header: fmtDate(row.date),
  rows: [
    { label: "Разход", value: `€${fmtEur(row.spend)}` },
    { label: "ROAS", value: `${row.roas.toFixed(2)}x` },
  ],
}));
```

Този `tooltipContent` е използван и за `LineChart` (ROAS таб, редове 119–124), но `LineChart` за ROAS праща само `{ date, roas }` в payload — без `spend`. При hover Recharts ще извика tooltip с `row.spend = undefined` → `fmtEur(undefined)` → `€NaN`. Не е crash, но потребителят вижда `€NaN` в tooltip.

**Поправка:** отделен tooltip за ROAS таба, или guard `row.spend != null ? ...` преди рендиране.

---

### 5. 🟡 `/ads/[market]` sort/filter бутони — `py-1.5` без `min-h-[44px]`

**Файл:** `src/app/(dashboard)/ads/[market]/page.tsx:447, 466, 492`

Бутоните за sub-brand filter, sort и status filter са `py-1.5` inline. Не ползват `FilterPill`/`SortButton` компонентите от `9af0411`. Малки touch targets на mobile — но **не е нов регрес** (бутоните са предхождали спринта); новото в спринта е само `SpendRoasTrend` и `AdsBreakdown`, не sort/filter областта.

---

## Секция: Възможни регресии

### GlassTooltip рефактор — не е регресия

- `AreaLineChart`: старите `labelFormatter` и `contentStyle` props са **правилно заменени** с `buildRechartsTooltip`. Добавени са `valueLabel`/`valueLabel2` props с defaults — всички съществуващи callers (`/products`, `/traffic`, `/email`, `/customers`) не подават тези props, ще видят default "Стойност" label в tooltip. Функционалността е запазена. ✅
- `BarChartCard`: `tooltipStyle` обект е **правилно заменен**. Existing callers не подаваха `tooltipStyle` — нямаше как да го подадат; беше вътрешно. ✅
- `DonutChart`: форматиращата логика за `%` дял е коректно пренесена в `tooltipContent.rows[1]`. ✅
- Нито един от трите компонента не губи функционалност.

### MiniKpi `hero` prop — не е регресия

- `hero` е нов **optional** prop с `false` default. Всички съществуващи callers в `/ads/campaigns`, `/ads/adsets`, `/email`, `/customers`, `/traffic`, `/products` не подават `hero` — ползват legacy compact layout. Обратно-съвместим. ✅

### `/morning-report` streaming — не е регресия

- `generate()` function запазва SSE логиката непокътната. Новото е само `init()` функцията (GET cache load), която при успех сетва `loading: false` и прескача `generate()`. При miss пада в `generate()` — същото поведение като преди. Streaming е непроменено. ✅
- `hasInit` ref предотвратява двойно извикване при React strict mode — добра практика. ✅

### `/ads` route — `previous` поле

- `/api/dashboard/ads/route.ts` вече връща `previous` поле. `/ads/[market]/page.tsx` го чете като `overviewData?.previous ?? null`. `??` е safe — ако API-то е старо или `previous` липсва, UI показва delta като `undefined` (KPI тайл без delta badge). Без crash. ✅

---

## Добри практики (отбелязани)

1. **§9.6 mobile combo pattern** — и двата combo чарта (`SpendRoasTrend`, `GoogleAdsTrend`) правилно ползват `hidden md:block` / `md:hidden` дублиране с tab toggle. Fragment-ът в ternary клона е коректен JSX — `<BarChart>` и `<LineChart>` са валидни React елементи директно в `ResponsiveContainer`.

2. **Campaign card view** (`google-ads/page.tsx:489–521`) — `grid-cols-3` с `MetricCell` дава четима 375px карта. Truncation с `title` атрибут (`:496`) е правилен fallback.

3. **AdsBreakdown `grid-cols-1 lg:grid-cols-3`** — трите карти (Platforms, Creative Health, Campaigns) колапсват правилно на 375px в единична колона. Bar-овете са flex div-ове с `overflow-hidden` — без overflow на тесен екран.

4. **`/ads` KPI grid** `grid-cols-2 md:grid-cols-3 lg:grid-cols-6` — на 375px: 2×3 grid (6 KPI-та в 3 реда по 2). Четимо, без overflow.

5. **`/morning-report` KPI лента** `grid-cols-2 md:grid-cols-5` — на 375px: 5 KPI-та в 3 реда (2+2+1). Коректно, без orphan проблем (нечетен брой е очакван).

6. **`/settings` health card** `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` — 5 integration badge-а на 375px = 2+2+1. Компактен `IntegrationBadge` с `min-w-0` и `truncate` не препълва.

7. **`SortButton` / `FilterPill`** (commit `9af0411`) — `min-h-[44px]` е добавен правилно с `flex items-center justify-center`. Изпълнява CLAUDE.md принцип #2.

8. **GlassTooltip единен речник** — рефакторът правилно централизира tooltip визуала; `buildRechartsTooltip` wrapper-ът е типово-сигурен и елегантен.

9. **Morning-report cache/generate** — graceful degradation при DB грешка (logging + fallthrough), SSE streaming не е счупен.

---

## Обобщение

**Регресии:** Не са открити регресии в съществуващата функционалност. GlassTooltip рефакторът и `hero` MiniKpi промените са обратно-съвместими.

**Нови мобилни проблеми:** 1 🔴 (bad link в morning-report KPI strip), 2 🟠 (touch targets под 44px в нов код на `/google-ads` и `/inbox`), 1 🟡 (NaN в ROAS tooltip при SpendRoasTrend mobile tab).

**Приоритет за fix:** находка #1 (broken link) и #2 (44px на `/google-ads`) трябва да се поправят преди следващия deploy.
