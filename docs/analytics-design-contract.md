# Analytics Design Contract

> Живо референтно doc за визуалния език на Analytics командния център (`/traffic`, бъдещ `/analytics`, breakdown sub-pages).
> Всеки нов analytics компонент **трябва** да следва това. Ако имаш изкушение да наруши правило — спри и преговори правилото тук, не правиш изключение.

---

## Защо този doc съществува

Без визуален договор всеки нов екран е снимка на настроението в момента. Резултатът се усеща AI-генериран: gradient на всяка карта, икона до всяко число, 6 цвята в един donut, „⚡ AI Powered ✨" бадж, рандомни round corners, 4 различни font-weights. Изглежда впечатляващо за 3 секунди и претрупано за 3 месеца.

Целта на договора: **отказваме опции**, за да не се налага да ги избираме всеки път. Stripe, Linear, Plausible, Shopify Analytics всички работят по такъв договор.

---

## 8 правила (неотменими)

### 1. Един смисъл на цвят

- `--accent` (зелено `#22c55e`) = ръст / добре / положителна тенденция.
- `--red` (`#ff3b30`) = спад / лошо / отрицателна тенденция.
- Всичко друго = неутрални нюанси (`--text`, `--text-2`, `--text-3`, `--border`).

Категории (канал, устройство, продукт) **не** получават собствен accent цвят. Donut за устройства е accent за #1 + сиви нюанси за останалите, не три различни цвята.

Изключение: смесени-сорс контексти (Shopify+Meta) могат да ползват `--blue` или `--purple` за дистинкция на източник, но **никога** за метрика-метрика разделение.

### 2. Три размера шрифт. Не четири.

| Размер | Употреба |
|---|---|
| `text-[28px]` font-bold | Hero числа (overview KPIs) |
| `text-[22px]` font-bold | Заглавия на страници (`PageHeader`), secondary hero |
| `text-[15px]` font-semibold | Заглавия на карти (`CardHeader`) |
| `text-[13px]` | Лейбли, табличен текст |
| `text-[12px]` text-text-2 | Meta info (delta лейбли, sub-text) |
| `text-[11px]` text-text-3 | Tooltip-и, дискретни таблични индикатори |

Без `text-sm` / `text-base` / `text-lg` — те създават плаваща скала. Винаги pixel-perfect числа.

### 3. Без иконки на метрики

Иконка не казва нищо за число — само добавя шум. KPI карта = лейбъл + стойност + delta. Точка.

Изключения:
- Иконки за **навигация** (sidebar)
- Иконки за **действия** (бутони — изтегли, обнови, сортирай)
- Иконки за **статус** (live dot, грешка, успех)

`MiniKpi.icon` остава опционален prop за обратна съвместимост с други dashboards (Home, Products, и т.н.), но **в analytics екраните не се ползва**.

### 4. Delta под стойността, не до нея

```
12,847
сесии
↑ 8.2% спрямо пр. период
```

- Стрелката + % е в accent цвят (зелено за ръст) или red (за спад).
- Лейбълът „спрямо пр. период" е `text-text-2 text-[12px]`.
- За проценти точки (engagement rate, conversion rate) — `pp` суфикс, не `%`. Пример: „↓ 2.1pp".
- За метрики където „по-ниско = по-добре" (bounce rate, CPA, cost per session) — `inverse: true` flag обръща цветовата логика.

### 5. Една плътност за един екран

- **Overview екран:** диша. 24–32px между блокове (`mb-6`, `gap-6`). 5 KPI hero + 3 breakdown карти + 1 голям chart. Не повече.
- **Drill-down екран:** плътен. 12–16px (`mb-4`, `gap-4`). Таблици, sortable headers, повече детайли.

Никога не смесваш двете плътности на един view. Ако чувстваш изкушение да добавиш гъст table под overview hero — той е drill-down view.

### 6. Една карта = един въпрос

„Канали" не съдържа второ table „и устройства за всеки случай". Ако имаш изкушение да напъхаш две неща в карта — те са две карти. Дори ако се вее малко място.

Изключение: legend на chart живее в същата карта като chart-а. (Очевидно.)

### 7. Чартовете нямат оси, когато числата ги има

- **Sparkline** под KPI = форма на тенденция, не справочна таблица. Без grid lines, без оси, без точки.
- **Малък chart в breakdown карта** = тенденция + точна стойност в tooltip. Минимална Y-ос (2-3 ticks), без X-ос ако периодът е в заглавието.
- **Голям chart на цял ред (overview)** = пълни оси, светъл grid (`stroke-opacity: 0.4`), сравнителна линия с dash pattern за предишен период.

Tooltip-ите винаги ползват `--surface` фон + `--border` граница (вече направено в `DonutChart`).

### 8. Сравнение е същото навсякъде

Само две сравнителни периода:
- **„Спрямо пр. период"** (default) — eq-length previous (готово в `dates.ts`).
- **„Спрямо м.г."** (по избор) — same period last year.

Формат на delta етикета: **винаги** еднакъв. Винаги „↑ 8.2%" или „↓ 2.1pp" + лейбъл под него. Никога „+8.2%" на едно място и „↑ 8.2%" на друго.

Сравнителното състояние се пази в URL през `useDateRange` хук (вече прави това за preset).

### 9. Visualization vocabulary — въпрос → чарт тип

Не избирай чарт от настроение. Всеки въпрос на оператора има 1-2 правилни визуализации; всичко друго е стилистика, която замъглява смисъла.

Това е каталогът. Ако нямаш въпрос, който се mapва тук — спри и преговори, преди да правиш нов чарт.

| Въпрос | Чарт тип | Защо | Recharts примитив |
|---|---|---|---|
| Как е оформен този **непрекъснат** метрик във времето? (приходи, sessions, CAC) | **Smooth area** + dashed comparison | Покупки/visits се случват постоянно — интерполация е честна | `<Area type="monotone">` |
| Колко **дискретни събития** имаше в всеки bucket? (поръчки, signups, отворени имейли) | **Vertical bars** | Bucket = брой; smooth линия имплицира „между дните имаше 47.3 поръчки" | `<Bar>` |
| Какво е **състоянието** на метрик, който се променя на дискретни моменти? (MRR, цена, AOV) | **Stepped line** (`stepAfter`) | Стойността държи между събития; smooth внушава поток, който няма | `<Line type="stepAfter">` |
| Две метрики на **обща ос** (spend × ROAS, разход × CPA) | **Combo: bars + line** | Едната обяснява другата; различни Y-оси за различни единици | `<ComposedChart>` с `<Bar>` + `<Line yAxisId="right">` |
| Какъв е **съставът** на 100%? (channel mix, статус) | **Single stacked bar** | Композицията е въпросът; pie e лош защото е без контекст | див с flex деца с % width |
| **Top X** в категория? (продукти, кампании, страници) | **Horizontal bars + share %** | Видимият ред = ранкинг; share % дава контекст | див с flex bars (виж TopProductsAggregate) |
| **Кога** през деня/седмицата се случва X? | **Hour × weekday heatmap** | Двумерна плътност; линия скрива wd-pattern, bars — h-pattern | `HeatmapGrid` |
| **Конверсия** от стъпка към стъпка? | **Funnel** | Декларира drop-off като форма; не като %-разлика | `FunnelChart` |
| **Разпределение** на стойности? (AOV buckets, time-to-purchase) | **Histogram** | Bell shape, long tail, bimodality — невидими в средната стойност | `<Bar>` с pre-bucketed данни |
| **Pacing към цел** / месечен таргет? | **Progress arc** или target reference line | Цел = смислена нулева точка; bar е fine, но arc чете „докъде" | `DonutChart` с 2 сегмента или `<ReferenceLine>` |
| **Outliers / „извън нормата"** | **Range band** (μ±σ envelope) + accent line | Контекст за „това спадане необичайно ли е" | `<Area>` за band + `<Line>` за current |
| **Композиция във времето** (channel mix по дни) | **Stacked area** или **stacked bars** | Само ако total-ът също е метрик; иначе normalized=100% | `<Bar stackId="a">` или `<Area stackId="a">` |
| **Един метрик за много обекта** (CPA per campaign, AOV per market) | **Dot plot** (хоризонтално) | Когато нулата НЕ е смислена baseline; bars лъжат за proportion | див с flex точки или `<Scatter>` |

#### 9.1 Smooth area (`type="monotone"`) — кога

- ✅ Приходи / GMV / sessions / CAC — метрики, които технически могат да са на всяка стойност между бакетите
- ✅ Когато bucket-ът е час или ден и want-ваш да видиш ритъма
- ❌ Никога за counts (поръчки, signups). Те не „flow-ват" — те се случват и спират.
- ❌ Никога за дискретно state (MRR, цена) — interpolation внушава continuous плъзгане.

#### 9.2 Vertical bars — кога

- ✅ Брой събития в bucket (поръчки/ден, имейли/седмица)
- ✅ Когато операторът ще иска да види „кой ден беше peak" чрез височина
- ✅ Mobile — всеки bar е tap target
- ❌ Не за continuous метрики ако имаш 30+ bucket-а — bar-овете стават thin и нечетими; смятай линия

#### 9.3 Stepped line — кога

- ✅ Дискретно state-change метрики: MRR, активни абонати, AOV, цена
- ✅ Cumulative прогрес (revenue от началото на месеца)
- ❌ Не за поток (revenue per day) — стъпки внушават evenly-spaced events, които не съществуват

#### 9.4 Combo (bars + line) — кога

- ✅ Когато две метрики са **механично свързани** (spend bars + ROAS line: едната директно обяснява другата)
- ✅ Различни единици на различни Y-оси (EUR vs ratio, count vs %)
- ❌ Не свързвай две независими метрики на dual-axis. Visual correlation ≠ causal correlation.
- ❌ На mobile — преминавай към tab toggle (един метрик в момента), не cram-вай и двата

#### 9.5 Anti-patterns (никога)

- ❌ **Smooth area за counts** — поръчки, signups, имейли. Interpolation на нищо.
- ❌ **Stepped line за continuous поток** — приходи, sessions. Стъпки внушават еventness която няма.
- ❌ **Bars когато нулата не е смислена baseline** — за AOV, ROAS, CTR, bounce rate. Dot plot е по-честен.
- ❌ **Dual Y-axis за две независими метрики** — revenue + sessions без causal линк. Изглежда корелирано, не е.
- ❌ **Категорийни цветове в donut/stacked** — само accent ladder (виж §1). Никога 6 цвята „за разлика".
- ❌ **Gridlines / axes на sparkline** — sparkline = форма, не таблица. (Виж §7.)
- ❌ **Pie chart с 5+ резена** — нечетимо. Преминавай към horizontal bars или дай реално dashboard.
- ❌ **3D / shadow / gradient декорации** — Edward Tufte plays sad violin.

#### 9.6 Mobile rules

- **Bars** > линии на 375px (всеки bar = tap target за tooltip)
- **Heatmap** колапсва до weekday summary под `md:`, не cram 7×24 = 168 клетки
- **Combo charts** — на mobile показвай само едната метрика с tab toggle
- **Stepped line** работи изненадващо добре на mobile — „тактилен" вид

### 10. Map markers — intelligence-hub дисциплина

Maps са специфична категория визуализация — те имат **географска геометрия** (страни, граници, водни маси) И **annotation layer** (markers, labels, heatmap overlays). Двете не са едно и също нещо и не се третират еднакво. Когато ги смесиш, получаваш marketing pulse splash вместо intelligence hub.

Договорът, изведен от refactor-а на `/sales/geography`:

#### 10.1 Markers са UI, не geometry

- **Geographic features** (countries, regions) живеят в SVG world-space — scale-ват с ZoomableGroup, разтягат се при zoom. Очаквано.
- **Markers** (city pins, location dots) живеят в **screen-coordinate space** — counter-scale-вани с `1/currentZoom` за всички dimensions (radius, stroke, hit area, pulse expansion target). При zoom 1×, 4×, 8× — маркерът остава точно същия pixel size на екрана.

Защо: markers са annotations върху картата, не части от нея. Mapbox / Google Maps / Palantir Gotham — всички ги третират така. Когато markerите растат с zoom, получаваш fury-of-dots при висок zoom + слаба видимост при overview.

```tsx
// ❌ Грешно — radius е fixed SVG units, scale-ва се с ZoomableGroup
<circle r={7} fill="..." />

// ✅ Правилно — counter-scale by currentZoom
<circle r={7 / currentZoom} fill="..." />
```

#### 10.2 Calm by default, alive on interaction

- **Idle state** — markerите са спокойни. Без animation, без pulse. Solid dot + (опционално) статичен halo за top performers.
- **Hovered** — само ТОЗИ marker оживява. Един elegant pulse ring (1.6s cycle, 2.2× expansion). Subtle, не лежи.
- **Selected** — accent border на dot-а. **Без pulse** — selection вече е комуникирана чрез country fill / side list. Двойно state-ване е визуален шум.

Защо: при 80+ markers, постоянният ambient pulse губи signal value. „Винаги пулсиращо" = „никога не пулсиращо" — eye filter-ва го като noise. Резервирай pulse за активното engagement.

#### 10.3 Discrete tiers, не continuous gradient

- **T1** — топ entity (top 1 per cohort) → по-голям dot + статичен halo
- **T2** — supporting entities (next 4) → среден dot, без halo
- **T3** — rest → най-малък dot

Eye разпознава 3 tiers моментално. Continuous log-gradient (3-9px) върху 30 markers се чете като „всички еднакви" защото 3× разлика е визуално subtle, особено при clustering.

```typescript
// ❌ Грешно — continuous gradient
const r = 3 + Math.log10(value / max) * 6;

// ✅ Правилно — discrete tiers
const r = tier === 1 ? 7 : tier === 2 ? 5 : 4;
```

**Изключение (revised 2026-05-22):** когато **clustering-ът сам носи magnitude** — т.е. markers се сливат в clusters и cluster-ът показва count/sum — индивидуалните unclustered dots може да са **uniform size**. Tier-ладдер-ът има смисъл само ако всички markers са видими едновременно на един zoom level и се конкурират за вниманието. При hierarchical zoom (country → city → office), на office-level всеки dot вече е „един обект", magnitude-ът се чете от cluster aggregation на по-нисък zoom. Uniform office dots там са по-чисти от tier-ладдер, който добавя шум. WorldMap (`/sales`) ползва точно този pattern — defended, не violation.

#### 10.4 Hit area decoupled from visible size

Transparent hit-area circle, sized ≥12px на screen (counter-scaled), седи зад visible dot-а. Pointer events live on the hit area, **не** на visible dot.

Защо: при T3 4px dot — стандартен mouse target ще е трудно clickable, mobile touch почти невъзможно. Decoupling запазва visual cleanliness + comfortable interaction:

```tsx
<circle r={12 / zoom} fill="transparent" pointerEvents="all" onClick={...} />
<circle r={4 / zoom} fill="var(--accent)" pointerEvents="none" />
```

#### 10.5 Visual hierarchy via presence, not motion

Статичен halo > pulsing animation за персистентна важност. Когато T1 marker има static outer ring at rest, eye го разпознава като „anchor" без да го асоциира с urgency или alert. Pulsing е резервирано за **състояние** (хover, alert, anomaly) не за **rank**.

#### 10.6 Анти-pattern: ambient theatre

- ❌ Pulsing на всички markers по дефолт — фурия от точки, signal loss
- ❌ Concentric rings (3+ rings expanding в стагерnut sequence) — изглежда AI-генерирано dashboard, не intelligence hub
- ❌ Categorical colours на различни марker types — една accent цветова палитра + opacity ladder за hierarchy
- ❌ Markers които растат с zoom — създава overlap chaos
- ❌ Hit area = visible dot size — на T3 4px невъзможно за click

### 11. Glass tooltip — един речник за всеки hover/scrub popup

Всеки chart popup на платформата (Recharts hover, mobile scrubber breakdown, map marker detail) ползва **един** визуален речник. Без това правило всяка нова страница импровизира четвърти вариант на „карта с детайли" и dashboard-ът губи кохерентност.

Каноничният glass surface (компонент `GlassTooltip` в `src/components/charts/`):

```
bg-surface/85 backdrop-blur-xl
border border-border/60 rounded-xl shadow-xl
px-3 py-2.5
text-[11px] leading-tight
```

Структура: **header** (`text-[11.5px] font-medium`, дата или час) → **hairline divider** (`h-px bg-border/70 my-1.5`) → **label→value grid** (`grid-cols-[1fr_auto] gap-x-3 gap-y-1`, всички числа `tabular-nums`).

Правила:
- Никога не пиши tooltip JSX inline в chart компонент. Минаваш през `GlassTooltip` + `buildRechartsTooltip()` за Recharts content, или директно `<GlassTooltip {...} />` за mobile scrubber popup.
- Delta chip-ът в tooltip-а ползва `deltaAccent()` helper-а — еднаква ▲/▼/— glyph логика, еднакъв flat-threshold (<1%).
- `minWidth` се подава само за floating (hover) popup; inline scrubber popup-ите fill-ват card width-а.

❌ Анти-pattern: локален `function XxxTooltip()` който повтаря същите класове с малки разлики. Това вече се случи 3 пъти на `/sales` преди консолидацията — `SparkTooltip`, `TrendTooltip`, `PulseTooltip` бяха байт-различни. Един източник, иначе drift.

### 12. Per-occurrence averaging — средни, не суми, + само пълни дни

Когато една агрегация сумира през **cross-period buckets** — напр. `read_store_hour_weekday` връща revenue сумиран през всеки occurrence на (weekday, hour) в [from, to] — суровата сума **не се показва като число**. За 30-дневен прозорец „Сряда = €18 140" се чете като „една Сряда" срещу дневния store baseline и операторът заключава, че числата са счупени (това реално се случи — виж `incident`-а в audit `2026-05-21-sales-audit-data.md`).

Правила:
- Дели сумата на **броя occurrences** → показваш „типична Сряда". Helper-и: `countWeekdaysInRange`, `daysInRange` в `lib/dates.ts`.
- **Винаги surface-вай делителя** като inline meta (`n=4`). Операторът трябва да види, че това е средно от 4 наблюдения, не single-day число. Без видим `n`, средната пак се чете като единична стойност.
- Header на колоната/картата е „**Средно**", не „Общо". Двете думи са договор — „Общо" имплицира сума, „Средно" имплицира делене.

**Само пълни дни.** Average-based view-ове (Ритъм, hour×weekday rhythm) изключват **частичния текущ ден**. Днешният ден, гледан в 14:00, носи ~70% от нормален ден, но дели на цяла единица → разводнява всяка средна, която докосва. Прозорецът на average view-а се clamp-ва до complete days (`to === sofiaToday() ? addDays(to,-1) : to`); и числителят (fetch-ът), и делителят (counts) се движат в lockstep. Днешните данни остават видими в hero strip / trend / day-pulse — average view-ът просто не ги смесва в „типичното".

❌ Анти-pattern: показване на cross-bucket сума без делене → магнитудна лъжа. ❌ Делене без видим `n` → операторът не може да sanity-check-не. ❌ Включване на частичен ден в average divisor → тих ~3-7% bias надолу.

### 13. Chart-touch + scrubber synergy на mobile

На touch устройства chart-овете **не reagiрат на директен tap**. Recharts native touch handler-ите се mute-ват глобално (`globals.css`, `@media (max-width: 767px)` → `pointer-events: none` на `.recharts-wrapper`). Причина: директен tap (а) показва tooltip точно под пръста, покривайки данните, и (б) рисува focus rectangle около целия SVG.

Вместо това — **една input абстракция, два входа**:
- Slider scrubber под chart-а (`MobileScrubber`) — primary touch input.
- Chart-touch на wrapper-а — `useChartScrubber` hook attach-ва pointer handlers на div-а около chart-а; събитията bubble-ват до него защото recharts вътре е `pointer-events: none`.
- И двата пишат **същия `activeIdx`** → един popup, две входни точки.

Правила:
- Chart wrapper-ът получава `touch-pan-y` — вертикален page scroll минава, horizontal finger движение engage-ва scrubber-а.
- **Gesture intent**: не commit-вай `activeIdx` на `pointerdown`. Изчакай първото движение да премине 6px праг — класифицирай horizontal (scrub) vs vertical (page scroll). Иначе всеки опит за scroll през chart flash-ва tooltip 1 frame.
- **Persistence**: `activeIdx` НЕ се изчиства на release. Позицията се pin-ва (Apple Health / Robinhood pattern) — inspection gesture има памет. (Ако някога стане объркващо при няколко chart-а — добави видим „● Пинирано" affordance; не премахвай persistence-а.)

❌ Анти-pattern: native Recharts tooltip + scrubber popup едновременно — двоен popup, конкурентни истини. ❌ `touch-action: pan-x` на chart wrapper — заключва вертикалния page scroll. ❌ Commit на `pointerdown` — tooltip flash при scroll.

---

## Typography scale (cheat sheet)

```tsx
// Hero number (overview KPIs)
<div className="text-[28px] font-bold tracking-tight text-text">12,847</div>

// KPI label (above value)
<div className="text-[13px] font-semibold text-text-2 mb-1">Сесии</div>

// Delta (below value)
<div className="text-[12px] mt-1.5">
  <span className="text-accent">↑ 8.2%</span>
  <span className="text-text-3 ml-1.5">спрямо пр. период</span>
</div>

// Card title
<h3 className="text-[15px] font-semibold text-text">Канали</h3>

// Table row
<div className="text-[13px] text-text">/products/super-magnesium</div>
<div className="text-[13px] text-text-2 tabular-nums">1,234</div>

// Tooltip / meta
<span className="text-[11px] text-text-3">15 май – 20 май</span>
```

**Винаги ползвай `tabular-nums`** за числа в таблици и сравнителни редици — иначе цифрите се местат при rerender.

---

## Color contract (cheat sheet)

| Token | Hex | Употреба |
|---|---|---|
| `--accent` | `#22c55e` | Ръст delta, primary bars в breakdown, dominant slice в donut |
| `--red` | `#ff3b30` | Спад delta, error states |
| `--text` | `#1d1d1f` | Hero числа, заглавия |
| `--text-2` | `#6e6e73` | Лейбли, secondary values, неутрални bars |
| `--text-3` | `#aeaeb2` | Meta info, dim icons, неактивни slices в donut |
| `--border` | rgba 0.06 | Card граници, table dividers |
| `--surface-2` | `#f9fafb` | Sub-card фон, hover state, progress track |

**Забранено за analytics карти:**
- `--blue`, `--orange`, `--yellow`, `--purple` като категорийни цветове.
- Gradient backgrounds.
- Цветно осветяване около цифри (`text-accent` за hero число — само ако highlight=positive, иначе винаги `text-text`).

---

## Spacing scale (cheat sheet)

| Употреба | Класове |
|---|---|
| Overview блок отделяне | `mb-6` или `gap-6` (24px) |
| Drill-down блок отделяне | `mb-4` или `gap-4` (16px) |
| Card padding | `p-5` (20px — вече в `CardBody`) |
| KPI card padding | `p-5` (вече в `MiniKpi`) |
| Inline gap (label + icon) | `gap-2` (8px) |
| Table row padding | `py-2` (8px) |
| Sortable header buttons | `px-2 py-1` (touch-target safe через line-height) |

---

## Component contract

### MiniKpi (extended)

```tsx
<MiniKpi
  label="Сесии"
  value="12,847"
  delta={{ pct: 8.2, label: "спрямо пр. период" }}
  sparkData={[100, 120, 95, ...]}
/>
```

- `icon`: опционален. **В analytics екрани не се подава.**
- `delta`: новo. `pct` положително/отрицателно. `inverse` обръща цветовата логика.
- `sparkData`: остава както е. Винаги в accent цвят, без оси.
- `highlight`: остава за специални случаи (Home dashboard). В analytics не се ползва.

### Card breakdown pattern

```tsx
<Card>
  <CardHeader>Канали</CardHeader>
  <CardBody>
    {/* Bar list или таблица. Един въпрос. */}
  </CardBody>
</Card>
```

### Hero strip (overview)

```tsx
<div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
  {/* 5 MiniKpi, no icons, with delta */}
</div>
```

### Breakdown grid (3 cards in a row на desktop)

```tsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
  {/* Канали | Устройства | Топ страници (short list) */}
</div>
```

---

## Quick checklist (преди да commit-неш analytics компонент)

- [ ] Цветове: само accent / red / neutrals. Никакъв категориен blue/orange/purple.
- [ ] Шрифтове: само от typography scale-а. Никакъв `text-sm` / `text-base`.
- [ ] KPI карти без иконки.
- [ ] Delta под стойността, същият формат навсякъде.
- [ ] Една карта = един въпрос.
- [ ] Чартът без излишни оси/grids.
- [ ] **Chart типът е честен** — sm-area за continuous, bars за counts, steps за state, combo за mech-linked (§9). Никакво „избрах smooth защото е красиво".
- [ ] **Dual Y-axis само за causally linked метрики** (§9.4–9.5).
- [ ] **Map markers — counter-scaled и calm** — constant pixel size при всеки zoom; pulse само на hover, не ambient; discrete tiers, не gradient (§10).
- [ ] `tabular-nums` на всички числа в таблици.
- [ ] Mobile тест: 375px viewport, grid колапсва правилно. Combo charts collapsing към tab toggle (§9.6).
- [ ] Skeleton, error, empty — и трите състояния са дизайнирани.

---

## Self-iteration

Когато се появи нов pattern или anti-pattern по време на разработка, **обнови този файл веднага**. Не чакай да те питат. Същият принцип като `feedback_platform_ux.md` — живо doc.
