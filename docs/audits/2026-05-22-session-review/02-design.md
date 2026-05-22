# Design Contract Audit — Revamp Sprint 2026-05-22

> Ревизор: Design-Contract Agent
> Обхват: `36bb387..26b6433` (10 commita)
> Еталон: `docs/analytics-design-contract.md` (13 правила) + `/sales` компоненти

---

## Резюме

Спринтът е **значително по-дисциплиниран** от предишните итерации. Основните §1 цвят-нарушения (blue/orange score badges) са изчистени. GlassTooltip рефакторът е реален и пълен — всички четири засегнати компонента преминаха. KPI лентата на `/ads` е вярна на §3 (без иконки) и §4 (delta под стойността). Единственото системно нарушение на договора е **§13 (mobile scrubber)** — новите chart компоненти (`SpendRoasTrend`, `GoogleAdsTrend`) разчитат на native Recharts touch tooltip вместо `useChartScrubber + MobileScrubber` pattern-а от `/sales`. Понеже `globals.css` вече mute-ва `.recharts-wrapper` на mobile, резултатът е **нефункционален tooltip на 375px** — операторът тапва и не вижда нищо. Всичко останало е добро или подобрение спрямо baseline-а.

---

## Топ находки (таблица)

| # | Severity | Член | Файл:ред | Описание |
|---|---|---|---|---|
| 1 | 🔴 | §13 | `SpendRoasTrend.tsx:95-105` | Tab toggle без `useChartScrubber` — tooltip не работи на mobile |
| 2 | 🔴 | §13 | `google-ads/page.tsx:56, 88-96` | `GoogleAdsTrend` — същото: native Recharts touch muted в globals.css |
| 3 | 🟠 | §8 | `AdsBreakdown.tsx:134-135` | `CreativeHealthCard` показва „Зареждане..." като hardcoded text вместо Skeleton |
| 4 | 🟠 | §13 | `SpendRoasTrend.tsx:99` | Tab toggle button: `py-1` → висота ~24px, нарушение на 44px touch target (CLAUDE.md §2) |
| 5 | 🟠 | §4/§8 | `morning-report/page.tsx:48` | `MorningKpiStrip` — hero KPI-та без delta (no comparison data) — §4 изисква delta под стойността в analytics hero |
| 6 | 🟡 | §2 | `morning-report/page.tsx:187` | `text-[14px]` за error message — извън scale-а (трябва `text-[13px]`) |
| 7 | 🟡 | §8 | `AdsBreakdown.tsx` | `PlacementCard` и `CampaignsCard` нямат error state — само loading + empty |
| 8 | 🟡 | §8 | `SpendRoasTrend.tsx` | Няма error state — само loading + empty |

---

## Детайлни находки

### 1. 🔴 §13 — Mobile tooltip нефункционален в SpendRoasTrend

**Файл:** `src/app/(dashboard)/ads/[market]/_components/SpendRoasTrend.tsx:95-130`

`globals.css` ред 189-190 слага `pointer-events: none !important` на `.recharts-wrapper` при `max-width: 767px`. Това е правилото от §13 — операторът трябва да вижда popup само чрез `useChartScrubber + MobileScrubber`. Новият `SpendRoasTrend` използва tab toggle (§9.6 compliant — добре), но вътре mobile `BarChart` и `LineChart` нямат `touch-pan-y` wrapper, `useChartScrubber` или `MobileScrubber`. Резултат: на 375px tooltip е напълно глух. Операторът вижда chart без никакъв начин да инспектира конкретна стойност.

Референция за поправка: `src/components/sales/SalesDayPulse.tsx:165, 258-264, 405-418`.

### 2. 🔴 §13 — Mobile tooltip нефункционален в GoogleAdsTrend

**Файл:** `src/app/(dashboard)/google-ads/page.tsx:40-101`

Абсолютно същият проблем — новият `GoogleAdsTrend` компонент не имплементира §13. Tab toggle е налице (§9.6 OK), но mobile charts са blind за touch. Pre-existing код (преди спринта) имаше същия проблем — спринтът го реши за desktop, но не за mobile touch.

### 3. 🟠 §8 — CreativeHealthCard: hardcoded „Зареждане..." вместо Skeleton

**Файл:** `src/app/(dashboard)/ads/[market]/_components/AdsBreakdown.tsx:134-135`

```tsx
{total === 0 ? (
  <p className="text-[13px] text-text-2">Зареждане...</p>
```

`total === 0` е вярно и когато `ads` prop-ът е празен след успешен fetch (напр. нов акаунт без реклами), и докато данните се зареждат. `CreativeHealthCard` получава `ads` prop от parent-а (не прави собствен SWR call), което означава "зареждане" и "наистина 0 реклами" дават идентичен изглед. Трябва условие по `adsLoading` prop или явен skeleton.

### 4. 🟠 §13 / CLAUDE.md §2 — Tab toggle buttons: sub-44px touch target

**Файл:** `src/app/(dashboard)/ads/[market]/_components/SpendRoasTrend.tsx:99`
**Файл:** `src/app/(dashboard)/google-ads/page.tsx:56`

```tsx
className={`px-2.5 py-1 rounded-md text-[11px] ...`}
```

`py-1` = 4px top + 4px bottom + `text-[11px]` line-height ≈ 13px → обща висота ~21px. CLAUDE.md §2 изисква 44px минимум за touch targets. Поправеният `SortButton` (`9af0411`) получи `min-h-[44px]`, но tab toggle buttons в двата trend charts пропуснаха същото.

### 5. 🟠 §4 — MorningKpiStrip: hero KPI-та без delta

**Файл:** `src/app/(dashboard)/morning-report/page.tsx:33-54`

```tsx
<MiniKpi hero label={k.label} value={k.value} />
```

Договорът §4: „Hero числа → delta под стойността". `MorningKpiStrip` не показва delta — snapshot-ът не носи сравнителни данни. Това е преценка, не абсолютна грешка — страницата е briefing, не analytics drill-down. Но §4 е ясен: overview KPI hero = label + value + delta. Без delta стрипът изглежда по-слаб от `/ads` и `/sales`.

**Забележка:** snapshot данните идват от `BusinessContext` и там история няма — за да се спазва §4 ще трябва допълнителен API call. Засега е 🟠 риск, не 🔴 грешка.

### 6. 🟡 §2 — text-[14px] в error state на morning-report

**Файл:** `src/app/(dashboard)/morning-report/page.tsx:187`

```tsx
<p className="text-[14px] text-red">{error}</p>
```

`text-[14px]` не е в scale-а (13 / 15 са позволените body размери). Трябва `text-[13px]`. Малко нарушение, но scale-ът е договорен точно за да спре такива отклонения.

### 7. 🟡 §8 — PlacementCard и CampaignsCard без error state

**Файл:** `src/app/(dashboard)/ads/[market]/_components/AdsBreakdown.tsx:63-107, 173-204`

SWR `error` prop-ът не е деструктуриран. При Meta API грешка (`data` e `undefined` и SWR `error` e set), PlacementCard просто показва „Няма данни за периода" — операторът не разбира дали е нямало данни или API-ят се е счупил.

### 8. 🟡 §8 — SpendRoasTrend без error state

**Файл:** `src/app/(dashboard)/ads/[market]/_components/SpendRoasTrend.tsx:49-56`

```tsx
const { data, isLoading } = useSWR<...>(...);
const empty = !isLoading && trend.length === 0;
```

Когато Supabase query fail-ва, `data` е `undefined`, `isLoading` е `false`, `trend` е `[]` → показва `emptyText="Няма данни"`. Трябва разграничение loading / error / empty.

---

## Добре направено

### §1 — Цветово почистване е реално и пълно

`page.tsx:86-90` Score badges: `blue` → `green`, `orange` → `neutral`. `getScoreStyle()` ред 128 вече не включва `blue` или `orange` case. `ScoreBar` ред 766: `bg-blue` → `bg-text-2`. Спазено до детайл.

### §9.4 + §9.6 — SpendRoasTrend: правилен combo и мобилен collapse

Desktop combo chart: spend като `<Bar>`, ROAS като `<Line>` — механично свързани, различни Y-оси (§9.4). Mobile: tab toggle, един метрик в момента (§9.6). Структурата е exemplary. Само §13 го куца.

### §11 — GlassTooltip рефакторът е пълен и чист

`DonutChart.tsx`, `BarChartCard.tsx`, `AreaLineChart.tsx`, `google-ads/page.tsx` — всичките четири минаха от `contentStyle={{...}}` инлайн към `buildRechartsTooltip`. `valueLabel` и `valueLabel2` props позволяват на consumers да персонализират лейбъла без да пишат нов tooltip JSX. Нула остатъчни `contentStyle` props. Договорен единичен речник.

### §1 + §3 — /ads KPI лента

Шестте KPI tiles: `hero=true`, без icon props, delta под стойността. CPA с `inverse: true`. CTR с `unit: "pp"`. Всичко е по договора. Идентично изглежда с `/sales` Hero strip.

### §3 — /settings health badges

`error` статус = `border-red/20 bg-red-soft` + `text-red` (беше `orange`). `disconnected` = неутрален. Иконките са статус-индикатори (§3 изключение). Правилно.

### §7 — Chart оси: минимални и светли

И двата trend chart-а: `axisLine={false}`, `tickLine={false}`, `vertical={false}` grid. Чисти оси само за Y тикове. Договорен pattern.

### §2 — Типографски scale спазен в новите файлове

В `SpendRoasTrend.tsx`, `AdsBreakdown.tsx`, `settings/page.tsx` (новите части) — само 11/12/13/15px. `text-[14px]` в `morning-report/page.tsx:187` е единственото нарушение и е ново (не pre-existing).

### CLAUDE.md §8 — Loading/empty states в новите компоненти

`SpendRoasTrend`: Skeleton via `ChartContainer loading=`, empty via `ChartContainer empty=`. `PlacementCard`: Skeleton с 4 placeholder реда. Само error state-ите липсват (🟡 по-горе).

### /inbox deep-links

`targetHref()` функцията правилно маппа target types (`market | product | ad | adset | campaign`) към routes. Правилно `null` при неразличим тип — без dead links.

---

## Бележка: pre-existing нарушения извън обхвата

- `ads/[market]/page.tsx:331-332` — `bg-blue-soft / text-blue` за „Meta не е свързан" empty state. Беше преди спринта (проверено с `git show 36bb387`). Не е въведено в спринта.
- `ads/[market]/page.tsx:613` и `734` — `text-[14px]` в score badge и action button. Pre-existing.
- `settings/page.tsx:428` — `text-[14px]` в form input. Pre-existing.
