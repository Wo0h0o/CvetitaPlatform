# Design Contract & Aesthetic Audit — /sales

> **Date:** 2026-05-21
> **Scope:** Цялата `/sales` повърхност след днешния overhaul (Hero, Signal, Trend, География, Топ продукти, Ритъм/Пулс).
> **Method:** Прочетен e целият договор (`docs/analytics-design-contract.md` §1–§10) + `CLAUDE.md` принципи 1/2/7 + `AGENTS.md` + memory pointers. Чел съм всеки файл от `src/components/sales/**`, `src/components/charts/{GlassTooltip,MobileScrubber,useChartScrubber}.tsx`, `src/components/shared/{Card,Delta,MiniKpi,PageHeader}.tsx`, `src/app/(dashboard)/sales/page.tsx`, `src/app/globals.css`. Read-only — нищо не променям; всички правила са proposals за следващия PR върху договора.

---

## Executive summary

`/sales` е най-disciplined екран в проекта от досега произведените и достига 80–85% покритие на §1–§10. Hero/Signal/Trend/Top Products/Country List минават през всички правила. Има три истински drifts (изброени в Inconsistencies) и четири skipped-but-needed rules: `срв.` vs `спрямо`, "Средно/Общо" разграничение, mobile-docked tooltip vocabulary, и chart-touch+scrubber model. Договорът трябва да поеме §11–§18 преди извеждането към `/traffic`, `/products`, `/ads`.

Това което е tight: §1 color discipline (само `--accent` + neutrals, без категорийни цветове изобщо в /sales overview — единственото "blue/purple" е MarketFlag, който е legitim source identifier); §2 typography scale (нула `text-sm`/`text-base`/`text-lg` в целия `src/components/sales/**` + `src/app/(dashboard)/sales/page.tsx`); §3 без иконки на метрики (само ArrowRight на selected държава в CountryListPanel — иконка-за-state, не за число); §4 unified Delta под всяка стойност чрез `<Delta />` component.

Това което drift-ва: (а) §8 — `SalesTrend:217` пише `срв. пр. период` и `SalesDayPulse:213` пише `срв. пр. ден` докато `<Delta />` хардкодва `спрямо пр. период` — два езика за същото нещо; (б) §9.4 — `SalesDayPulse` dual-axis (orders bars left + revenue line right) е mech-linked правилно, но prior-period dashed линия е САМО на revenue axis, което прави visual compare асиметричен (виж §9 ауditt по-долу); (в) §10.3 — `WorldMap` няма дискретни tiers за маркерите, всички unclustered dots са `r=5` (line 592). Discrete tiers са изрично required от §10.3.

Missing rules: договорът няма §-я за (1) glass tooltip vocabulary (duplicated между `GlassTooltip.tsx` и `WorldMap.TooltipShell:929`); (2) headline-in-header pattern което сега се ползва навсякъде ("Топ 3 = 40% от приходи"); (3) asymmetric hero strip (6/3/3); (4) snap-scroll signal strip; (5) adaptive view per date range; (6) per-occurrence averaging с n=X surfacing; (7) chart-touch+scrubber synergy; (8) persistence on release.

---

## §1–§8 compliance summary

### §1 Един смисъл на цвят — **PASS**

Скаned целия `src/components/sales/**` + `/sales/page.tsx` за `text-blue`, `text-orange`, `text-purple`, `text-yellow`, `bg-blue`, и т.н. Намерени **нула** случая. Единствените цветове са:

- `text-accent` / `bg-accent` / `bg-accent-soft` — ръст и selection
- `text-red` / `text-red-soft` — спад
- `text-text` / `text-text-2` / `text-text-3` / `text-border` — neutrals
- MarketFlag — country flags са source identifier, не категорийна цветова палитра (експлицитно permitted by §1 exception)

Hardcoded hex в `WorldMap.tsx:561,597`: `#ffffff` за text-halo и `#0b0d10` за dot stroke. Both са MapLibre layer paint properties (not Tailwind classes) — `#ffffff` е технически correct за halo върху accent dot; `#0b0d10` обаче е dark-mode-only colour и НЕ е токен от globals.css — това е dark-mode hardcode. Виж Inconsistencies #3.

`WorldMap` ползва inline `rgb(34, 197, 94)` / `rgba(34, 197, 94, ...)` 6 пъти (lines 376, 454, 504, 523, 590, 596). Това е същият accent hex но не минава през CSS variable, така че dark-mode override на `--accent` би прескочил тези layer-и. Виж Inconsistencies #2.

### §2 Три размера шрифт — **PASS**

Скан с pattern `text-sm|text-base|text-lg|text-xl|text-2xl` over `src/components/sales/**` и `src/app/(dashboard)/sales`. **Нула** мatches. Цялата typography е pixel-perfect (`text-[10px]`/`[11px]`/`[11.5px]`/`[12px]`/`[13px]`/`[15px]`/`[20px]`/`[22px]`/`[24px]`/`[28px]`/`[32px]`/`[36px]`).

Малък drift: `SalesHeroStrip.tsx:388` ползва `text-[32px] md:text-[36px]` за hero Revenue tile, докато договорът §2 cheat-sheet declares `text-[28px]` като canonical hero. Това е целево upgrade на най-важната метрика на страницата (асиметричен hero — §13 amendment по-долу), но трябва да бъде codified. Виж §13.

### §3 Без иконки на метрики — **PASS**

- `SalesHeroStrip` — само label/value/delta/sub. Без иконки. ✓
- `SalesSignalStrip:288` — `<MarketFlag />` на "Топ пазар" tile-а. Flag е identifier на entity (държава), не иконка-на-метрика. Match §1 exception. ✓
- `TopProductsAggregate` — само ranking number `i+1`. Без иконки. ✓
- `SalesTrend` / `SalesDayPulse` / `SalesRhythm` — peak badge ползва accent dot, не lucide икона. ✓
- `CountryListPanel:161` — `<ArrowRight />` на selected state. Иконка за **status** (selection), permitted by §3 exception. ✓

### §4 Delta под стойността — **PASS със следа за §8 fix**

`<Delta />` (`src/components/shared/Delta.tsx:23-55`) налага unified ▲/▼/— + pct + label format. Всички hero/signal tiles minават през него. Drift точки:

- `SalesTrend.tsx:206-219` — custom inline delta badge ("▲ 12% срв. пр. период") НЕ ползва `<Delta />`. Логиката е дублирана и грамата на etiketa разлика (`срв.` вместо `спрямо`). Виж §8 по-долу.
- `SalesDayPulse.tsx:200-215` — същия pattern, custom inline badge, `срв. пр. ден`.
- `SalesRhythm.tsx:237-249` — custom inline delta за weekday rows. Threshold `< 1` за isFlat е different от `<Delta />` threshold `< 0.05` (Delta.tsx:33). Минор inconsistency.

Format на arrow glyphs identical навсякъде (▲/▼/—) — само лейбълът drift-ва.

### §5 Една плътност за един екран — **PASS със два минора**

`/sales/page.tsx:149,157,162,185,189` пише `mb-4 md:mb-6` и `gap-4 md:gap-6`. Logic: mobile=drill-down density (16px), desktop=overview density (24px). Договор §5 не explicitly addressва това; mobile-tight е реасонабло consequence на принцип 2 (Mobile First) но трябва да се codify-не.

Card padding: `Card.tsx:45` дефинира CardBody като `p-5`. `SalesHeroStrip:386` ползва `p-5 md:p-6` (Hero tile override) и `:432` ползва `p-4 md:p-5` (Sub tiles). Това е целево tier-ane на padding spreed по визуална тежест, но НЕ е в договора. Виж §13.

### §6 Една карта = един въпрос — **PASS**

- Hero Revenue tile — "колко приходи + кой ден беше peak" — peak callout е contextual annotation на същия въпрос, не втора метрика. ✓
- SalesTrend — "как изглежда приходният тренд + спрямо предходния". ✓
- SalesRhythm — combo от weekday small multiples (top) + hour strip (bottom). Това **граничи** с two-questions ("Кой ден?" + "Кой час?") в една карта. Защитата на компонентa в file-comment-а (lines 53-60) е "split into 'which day' + 'which hour'" — този split осъзнато прави cardа dual-question. По §6 строго това е violation; де факто е добре пресечено защото операторът reads ги seqуенциално. Worth codifying като legitim ексepшън. Виж §16 amendment.
- WorldMap + CountryListPanel — две карти, две views на същите данни, bound by selection. Това НЕ е една карта = два въпроса, а две карти = един въпрос с two-channel input. ✓

### §7 Sparkline/chart axis discipline — **PASS със следа**

- `SalesHeroStrip` MiniSpark — без axes, без grid. ✓ Match §7.1.
- `SalesTrend` (full-row) — пълни axes, light grid (`stroke="grid"` — line 259), dashed comp line. ✓ Match §7.3.
- `SalesDayPulse` (full-row) — пълни dual axes, dashed comp line. ✓
- `SalesRhythm` hour strip — minimal Y (`width={36}`), dashed comp. Reasonable за mid-size chart. ✓ Match §7.2.
- `SalesRhythm` weekday rows — `<YAxis hide />` (line 279), без X-axis. ✓ Match §7.1 sparkline.

### §8 Сравнение е същото навсякъде — **FAIL (минорно но реално)**

Драфтuvат се два различни fраzа в едно view:

| File:line | String |
|---|---|
| `Delta.tsx:23` | `"спрямо пр. период"` (default label) |
| `FunnelChart.tsx:81,101` | `"спрямо пр. период"` |
| `SalesTrend.tsx:217` | `"срв. пр. период"` |
| `SalesDayPulse.tsx:213` | `"срв. пр. ден"` |

`Delta` е единствено source-of-truth и пише "спрямо"; SalesTrend / SalesDayPulse custom badge-и пишат "срв.". Един от двата трябва да изчезне. Препоръчвам "спрямо пр. период" (както е в `Delta`) — то е без abbreviation, типографски-по-чисто на mobile и BG-natural. "срв." е agency-shorthand. Това е §8 violation defakto.

Допълнително: `SalesDayPulse:213` пише `"срв. пр. ден"` — period label-ът се сменя според mode (ден vs период). Това е contextually-correct, но трябва договорът да го разреши изрично — иначе следващият /traffic component ще импровизира трета вariation.

---

## §9 Chart type compliance

| Чарт | Тип | §9 правило | Verdict | Evidence |
|---|---|---|---|---|
| Hero Приходи | smooth area | §9.1 — continuous flow | **honest** | `SalesHeroStrip:304-320`, `kind="area"` |
| Hero Поръчки | vertical bars + `maxBarSize=14` | §9.2 — discrete events | **honest** | `:321-329`, `kind="bars"`. Y-domain anchors at 0 (default Recharts). ✓ |
| Hero Среден чек | `stepAfter` Area | §9.3 — state-change | **honest** | `:330-352`, `kind="step"`. AreaArea версията (не Line) е намерено compromise — `connectNulls` enabled за празни дни (line 348). Pure stepLine би плавал mid-canvas; Area attaches вiсуалния weight to the floor. Defensible. |
| SalesTrend | `<Area type="monotone">` revenue + `<Line type="monotone" strokeDasharray>` comp | §9.1 + §8 comp dashed | **honest** | `:313-327` |
| SalesTrend ReferenceDot | accent dot за peak | §9 — annotation pattern | **honest** | `:328-337` |
| SalesDayPulse | Bar (orders, left axis) + Line (revenue, right axis) + dashed Line (comp revenue, right axis) | §9.4 — mech-linked dual axis | **partial pass** | `:332-367`. Bars+Line са mech-linked (повече orders = повече revenue) — ✓. **Asymmetry**: comp-period линия живее само на revenue axis (line 343, `yAxisId="revenue"`); няма `compOrders` bar или dashed orders trace. Решението е документирано в file comment (`:43-52`) — "one question per card, orders pace lives in hero strip". Legitim trade-off; защитава §6. Worth codifying explicitly. |
| SalesRhythm weekday rows | smooth Area (`type="monotone"`) на per-occurrence averaged revenue | §9.1 — continuous flow за усреднена hourly krivа | **honest but novel** | `:292-300`. Argument: средната стойност "typical wd-h" e интерполируема между часовете (между 14:00 и 15:00 има 14:30 с очаквана стойност). Smooth area е honest. **Caveat**: при metric=orders, тази крива се чете като "0.7 orders at 14:30" — fractional orders за усреднена крива е actually OK (средната стойност e continuous), но трябва договорът да разреши explicitly "averaged counts ⇒ smooth дОпустимо". Виж §16. |
| SalesRhythm hour strip | Bar за usрed per-day hourly sum + dashed comp Line | §9.2 — counts in bucket | **honest** | `:638-654`. Когато metric=revenue, всеки bar е "средно приходи за час H в typical ден" — стрictлy това е continuous, но bars all-else-equal са honest за hourly buckets. §9.2 не забранява bars за усреднени revenue; §9.5 само забранява smooth area за raw counts. ОК. |
| SalesHourHeatmap (`/sales/store/[id]`) | 7×24 grid с accent opacity ladder | §1 + §9 "Кога" | **honest** | `SalesHourHeatmap.tsx:131-152`. `HeatmapGrid` ползва accent opacity ladder (виж implementation), не categorical colours. Match §1. |

### §9 — overall

Hero tier-ът е flagship example за §9 discipline (3 различни chart типа в един row, всеки choice contractually defended in code comments). Това е канoн.

Една edge case която договорът не покрива: **what happens when window<2 buckets?**

- `SalesHeroStrip:494-495` switches to hourly granularity.
- `SalesTrend:127-128` same.
- `SalesRhythmPanel:29` switches to `SalesDayPulse`.

Това е adaptive-view логика която договорът няма rule за. Виж §15 amendment.

---

## §10 Map markers compliance — **PARTIAL FAIL**

`WorldMap.tsx` адресva §10 правилaта така:

| Правило | Status | Evidence |
|---|---|---|
| §10.1 Markers са UI, не geometry (counter-scaled) | **PASS** | MapLibre layer типове (`circle`) са inherently screen-space (`circle-radius` is in pixels, not map units). Counter-scaling е автомат due to MapLibre runtime — не trябва explicit `1/currentZoom` divisions. Defacto равно с §10.1 чрез engine choice. ✓ |
| §10.2 Calm by default, alive on interaction | **PASS** | Нямa pulse animation на dots. `circle-stroke-color` мени се на hover-state but no pulse. ✓ |
| §10.3 Discrete tiers (T1/T2/T3) | **FAIL** | `marker-dots` layer (`:584-601`) ползва **single** `circle-radius: 5` за ВСИЧКИ unclustered points. Defended in code (`:580-583`) с argument "cluster sizing tells magnitude, per-marker sizing adds noise at the office level where most points represent 1-15 orders". Legitim view but contradicts §10.3 expicitly. Cluster layer (`:498-527`) **DOES** ползва interpolated log10 scale (`14, 19, 24, 30, 36` px stops) — continuous, not discrete. §10.3 explicitly bans continuous radius mapping. Виж Inconsistencies #4. |
| §10.4 Hit area decoupled | **PASS** | `marker-hit` layer (`:569-578`), `circle-radius: 12`, transparent. Click bound to `marker-hit` (`:766`). ✓ |
| §10.5 Visual hierarchy via presence | **PASS-ish** | Няма halo на top performers (T1) защото няма tiers — single dot size. So § 10.5 е moot. Cluster layer halo (opacity 0.22 surround) is presence-based for AGGREGATES not for individual T1s. |
| §10.6 No ambient theatre | **PASS** | Без concentric rings, без stagered pulses, без gradient palette. ✓ |

**Conclusion:** §10.3 е real violation. Two options: (a) revise §10.3 to allow uniform marker sizing когато cluster aggregation вече кодира magnitude (документиран trade-off в `WorldMap:580-583`); (b) revert `marker-dots` layer to T1/T2/T3 ladder. Препоръчвам (a) — codify "if clusters carry magnitude, individual markers may be uniform" като §10.3a exception.

---

## Proposed contract amendments (§11–§18 drafts)

### §11 Glass tooltip vocabulary

- **Where introduced:** `src/components/charts/GlassTooltip.tsx` (canonical); duplicated visual recipe в `src/components/sales/geography/WorldMap.tsx:929-946` (TooltipShell + 5 *TooltipBody components).
- **Story problem solved:** На SalesTrend / Pulse / Rhythm / Hero hover-popup всеки file импровизираше малко — different padding, different blur strength, different header weight. След няколко итерации tooltipите вече **изглеждаха различно** между Hero spark и Trend hover. Без правило всеки нов компонент ще impровизира пак. WorldMap.TooltipShell дублира GlassTooltip визуала ръчно защото MapLibre не подава Recharts-стил `payload` — но същата визуална grammatика трябва да живee един път.
- **Proposed rule text:**

  > Всеки chart tooltip и map popup на /analytics екран ползва **една визуална вокабуларна формула**, изведена в `<GlassTooltip />` (canonical). Class набор:
  >
  > ```
  > bg-surface/85 backdrop-blur-xl
  > border border-border/60 rounded-xl shadow-xl
  > px-3 py-2.5 min-w-[180-220px]
  > text-[11px] leading-tight
  > ```
  >
  > Header: `text-[11.5px] font-medium text-text`. След header — `<div className="h-px bg-border/70 my-1.5" />` hairline divider. Body: `grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline` с label в `text-text-3` и value в `text-text font-semibold tabular-nums text-right`. Delta accent suffix следва `deltaAccent()` helper.
  >
  > Map popup-и (MapLibre) която не може да минe през `<GlassTooltip />` (защото няма Recharts payload) **трябва** да import-ват от `GlassTooltip.tsx` shared building blocks (например `<GlassTooltipShell />` ако се отдели) — never re-implement the recipe inline.

- **Edge cases / when it doesn't apply:** Mobile docked popup-ите (`globals.css:145-154`) override `left/right/bottom` чрез CSS, но vocabularът визуален остава identical — само position-ането се мени. ОК.
- **Anti-pattern to avoid:** Inline custom popup с `bg-white/95`, `shadow-lg`, `p-4` — изглежда близко, но е трета вокабула. Forbidden.

### §12 Headline-in-header pattern

- **Where introduced:** `SalesTrend.tsx:223-230` ("totalRevenue + totalBadge" в action slot); `SalesDayPulse.tsx:219-227`; `SalesRhythm.tsx:530-536` (peakBadge + metric toggle); `TopProductsAggregate.tsx:102-110` ("Топ 3 = 40% от приходи"); `CountryListPanel.tsx:94-105` ("Топ: 94% Приходи").
- **Story problem solved:** Преди тoday-овата итерация cards-ите бяха "имe-на-картата + детайл вътре" — операторът трябваше да прочете цялата таблица за да извлече тезисния insight. Сега headerа сам носи thesisа ("Топ 3 = 40% от приходи"), а body-то само го подкрепя. Карта-ta е quote, header-а е headline.
- **Proposed rule text:**

  > Всяка breakdown card в analytics layer трябва да носи **insight в headerа**, не само метричен total. `<CardHeader action={...}>` slot-ът се ползва за:
  >
  > 1. **Concentration headline** — "Топ 3 = X% от приходи" / "Топ: Y% поръчки".
  > 2. **Peak callout** — "Пик: Пет 18:00 • €1,234".
  > 3. **Total + delta badge** — `<div className="flex flex-col items-end gap-0.5"><span>€12,847</span><span>спрямо пр. период ▲ 8%</span></div>`.
  >
  > Шрифт за insight: `text-[11px] text-text-3` за labelя; `text-text font-semibold tabular-nums` за число (на същия размер ако се ползва без label). Делta tone follows §4 cohort. Insightа е **един phrasе**, не таблица; ако трябва повече, то това е втора карта (§6).

- **Edge cases / when it doesn't apply:** Tabular drill-down cards без single thesis-able number (e.g. raw orders log) могат да дадат `null` в action slot.
- **Anti-pattern:** Header с logo / иконка / "AI Insight ✨" badge. Header има insight, не decoration.

### §13 Asymmetric hero strip (col-span 6/3/3)

- **Where introduced:** `SalesHeroStrip.tsx:585-628`. На lg desktop: `grid-cols-12` → revenue 6 / orders 3 / aov 3. Mobile: `grid-cols-2` → revenue full (col-span-2) / orders 1 / aov 1.
- **Story problem solved:** Прежного 5-equal-tiles layout-а четеше се като "5 еднакво важни числа", което скриваше hierarchyата. Revenue е THE answer на страницата; ostalното подкрепя. Hero-ата трябва да каже това с пропорция (Tufte data-ink: тежестта на елемента ≈ важността).
- **Proposed rule text:**

  > Hero KPI strip на overview екран ползва **asymmetric grid** когато една метрика е dominantна:
  >
  > ```
  > lg: grid-cols-12  → primary col-span-6, supporting col-span-3 each (2-3 supporters)
  > mobile: grid-cols-2 → primary col-span-2 (full), supporting col-span-1 each
  > ```
  >
  > Primary tile font: `text-[32px] md:text-[36px]`. Supporting tiles: `text-[24px] md:text-[28px]`. Padding tier-ed: primary `p-5 md:p-6`, supporting `p-4 md:p-5`. Min-height еднаква (`min-h-[180px]`) за визуален rhythm.
  >
  > Когато няма clear dominant metric (e.g. /traffic може да иска "Sessions + Users + Engagement" 3-equal), 12-col grid fallback-ва на 4/4/4 — symmetric е приемлив, asymmetric е prefered when applicable.

- **Edge cases:** Drill-down екран (плътен mode, §5) не ползва hero strip изобщо. Email summary screen може да иска 1+1+1+1 equal — OK.
- **Anti-pattern:** 5+ equal hero tiles за overview. Тежки страници изчадиet операторския eye scan.

### §14 Snap-scroll for "many but small"

- **Where introduced:** `SalesSignalStrip.tsx:141-164` — `StripShell` ползва `-mx-4 px-4 ... overflow-x-auto snap-x snap-mandatory` на mobile, regular grid на desktop.
- **Story problem solved:** 4–5 secondary KPI tile-а не cтаваsiат заедно в 375px viewport. Вертикалното stacking ги направи 4 rows × 80px = 320px just for signal strip. Snap-scroll прави row-а ONE row на всеки viewport — операторът swipe-ва horizontally между тиlatе. Това е Apple Health / Stripe Atlas / iOS Calendar widgets pattern.
- **Proposed rule text:**

  > Когато на overview екран има >3 secondary tile-а и mobile-first layout-а не може да побере всички в един row (375px), ползва **snap-scroll carousel** pattern:
  >
  > ```tsx
  > <div className="-mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto md:overflow-visible snap-x snap-mandatory">
  >   <div className="flex md:grid md:grid-cols-N gap-3 md:gap-4 w-max md:w-auto">
  >     {/* min-w-[180px] md:min-w-0 на всеки tile */}
  >   </div>
  > </div>
  > ```
  >
  > Tile-а **mu** има `snap-start` за clean halt-position. На desktop snap-class-овете остават но overflow-visible ги обезсилва.
  >
  > Visual cue: на mobile последното tile-а трябва да peep-ва от right edge (negative margin прави това) — операторът вижда "има още надясно". Hidden scrollbar — `scrollbar-thin` се изтегляи на iOS native.

- **Edge cases:** Primary hero (§13) НЕ ползва snap-scroll — primary metric трябва да е винаги визибл, не зад swipe.
- **Anti-pattern:** Snap-scroll на 2 tile-а ("защото е красиво"). Под 4 tiles — вертикален stack или 2-column grid е по-добре.

### §15 Adaptive view per date range

- **Where introduced:** `SalesRhythmPanel.tsx:27-31` — `from === to ? <SalesDayPulse /> : <SalesRhythm />`. Същият pattern в `SalesTrend.tsx:127-128` (`hourly = from === to`) и `SalesHeroStrip.tsx:494-495`.
- **Story problem solved:** Один-day window с daily granularity дава ONE data point. Chart-ът е празен SVG. Smooth area без segment; bars единичен stub mid-axis. Решение: detect window resolution от resolved range (НЕ от preset name — custom from===to трябва да работи same), и автоматично flip-вай towards другата vis-class.
- **Proposed rule text:**

  > Chart-ове които depend on time-series buckets ползват **adaptive view** правило:
  >
  > 1. **1 data point ⇒ adapt granularity или vis-class.** Detection е по resolved `from === to`, не по `preset.name` (custom 1-day ranges трябва да работят).
  > 2. Trend-style charts (smooth area, stepped line) → switch към hourly granularity (`&granularity=hour`). Tooltip header switches от `formatBgDate(d)` → `formatHourLabel(d)`.
  > 3. Aggregate views (weekday small multiples) → switch към intra-day combo (e.g. SalesDayPulse). Adapt ползвa специализиран компонент, не еще-един-mode на оригиналния.
  > 4. Comparison overlay (§8) се прави на same-granularity period (1-day-vs-1-day, hourly-vs-hourly).
  >
  > Adaption-ът е **automatic** — операторът не вижда toggle. Това е prog disclosure (§7 CLAUDE.md) — UI се agresира към избора, не иска от потребителя да познава.

- **Edge cases:** 2-bucket window (e.g. вчера+днес) — adaptive logic-ат не trigger-ва; default vis работи защото 2 точки рисуват segment.
- **Anti-pattern:** Manual "hourly / daily / weekly" toggle на overview chart. Защо да караш оператора да pick кога логиката може сама?

### §16 Per-occurrence averaging — surface the divisor

- **Where introduced:** `SalesRhythm.tsx:139-141` (`divSafe`), `:163,166-167,308-317` (n=X chip surfacing), `:320-323` (tooltip explainer).
- **Story problem solved:** Първоначалната версия показваше `Ср €18,000` за 30-day window. Операторът прочете това като "single-day revenue" и flag-на го като obvious бъг — а всъщност това беше SUM of all 4 Wednesdays за периодa. Two-Tiered fix: (1) divide by occurrences (4 Wednesdays = 4); (2) surface the divisor inline as `n=4` chip. Без втората стъпka, "среден 4500" пak изглежда suspicious — операторът се чуди "ама среден на какво?".
- **Proposed rule text:**

  > Когато aggregate metric се сумира across cross-period buckets (e.g. weekday × hour за 30-day window), displayed-ната стойност е **per-typical-occurrence** (sum / count_of_occurrences). Винаги:
  >
  > 1. Divide raw sum by ISO occurrence count for that bucket (e.g. `countWeekdaysInRange(from, to).get(wd)`).
  > 2. **Surface the divisor inline** as `n=X` chip in `text-[10px] text-text-3 tabular-nums` под основната стойност. Tooltip explainer ("Средно за петък, n=4 спрямо предходен период n=5") в `title=` attribute.
  > 3. Headerа на cardа explицitno изрича вокабулата "Средно" (вместо "Общо"), за да не се чете per-occurrence value като single-instance figure.
  >
  > Когато aggregate е HONESTLY a sum (т.e. всеки bucket е инстанция, не аverage), нapишi "Общо" expлицитно и не surface n=X — divisor=1.

- **Edge cases:** Single-day window — divisor винаги e 1 (нямa multiple occurrences), н=X chip не се показва; "Средно" labelа отпадa. Това е смislено fall-through.
- **Anti-pattern:** Surface average without n=X (looks like single-occurrence number); average data labeled "Общо" (математически neправилно); n=X chip без вопросно "Средно" header (контекст е missing).

### §17 Chart-touch + scrubber synergy on mobile

- **Where introduced:** `globals.css:188-196` mutes recharts pointer-events на ≤767px; `useChartScrubber.ts:53-125` owns the activeIdx; `MobileScrubber.tsx:101-128` slider; всеки chart wraps content in `ref={wrapperRef}` + `{...pointerHandlers}` (примерi: `SalesTrend.tsx:241-245`, `SalesDayPulse.tsx:261-265`, `SalesRhythm.tsx:588-592`).
- **Story problem solved:** Преди this iteration chart-ите имаха Recharts native touch tooltip, който: (а) се отваряше под finger-а (operatorът не вижда стойността); (б) painted глобален focus outline върху целия SVG (iOS Safari). Solution: mute recharts touch напълно на mobile; let finger taps land on wrapper div; map clientX to data index via `getBoundingClientRect()`; render single popup above slider. Two input paths (slider drag + chart tap) → one state (activeIdx).
- **Proposed rule text:**

  > Mobile chart inspection ползва **chart-touch + slider scrubber synergy**:
  >
  > 1. `globals.css` mute-ва `.recharts-wrapper { pointer-events: none }` на `@media (max-width:767px)`. Recharts native touch tooltip спира да съществува.
  > 2. Chart wrapper div получава `useChartScrubber({ count })` — single source of truth за `activeIdx`.
  > 3. Pointer events on wrapper (`onPointerDown/Move/Up/Cancel`) mapват clientX to bucket index via `getBoundingClientRect()`. Pointer capture ensures finger-slide-off-edge не cancels the gesture.
  > 4. `<MobileScrubberRow>` под chart-а renders слайдера + activated popup в reserved 58px slot (preventing reflow when activeIdx flips на/off).
  > 5. Само `pointerType !== 'mouse'` engages scrubber — desktop hover paths остават Recharts'. Туч/pen на desktop също engage scrubber (защита срещу future touchscreen Mac).
  > 6. Wrapper класа **MUST** include `touch-pan-y` — vertical page scroll не bourgeois.
  >
  > Recharts cursor mirror: chart-ат rendersва `<ReferenceLine>` + `<ReferenceDot>` при `activeIdx !== null` (не Recharts native cursor, който е muted). Това е "you-are-here" mark който mirror-ва desktop hover cursor.

- **Edge cases:** Single-bucket window (`count < 2`) — useChartScrubber short-circuits (`indexFromEvent` returns null), MobileScrubber returns null (`MobileScrubber.tsx:59`). Card just doesn't have scrubber. ОК.
- **Anti-pattern:** Native Recharts touch tooltip enabled (causes double-popup); chart-touch без slider companion (loses accessibility — slider can be keyboard-driven); slider без chart-touch (forces finger-down-on-slider always; chart taps ignored).

### §18 Persistence on release

- **Where introduced:** `useChartScrubber.ts:102-112` — `releaseCapture` does NOT clear `activeIdx`. `MobileScrubber.tsx:54-55` — `handleRelease` defaults to no-op. Comment chain explicitly defends this (`useChartScrubber:21-25`).
- **Story problem solved:** Default `onPointerUp = setActiveIdx(null)` reads as "tap to inspect, release to dismiss" — but mobile operators released, looked at the popup, and the popup vanished mid-glance. Persistence на release означава "tap, look at it as long as you want, tap next bucket to move." Match Apple Health / Robinhood / iOS Stocks behaviour.
- **Proposed rule text:**

  > Chart scrubber и chart-touch active state **persist after pointer release**. `onPointerUp` / `onTouchEnd` / `onBlur` release the pointer capture and clear hover-state CSS, но **не** clear-ват `activeIdx`. Operatorсkото движение pinned-ва last position.
  >
  > To clear state: explicit "back" affordance (e.g. tap outside the card, or a tiny dismiss button), не implicit release. Consistency over implicit dismissal.
  >
  > Apply uniformly to:
  > - Chart-touch scrubber (`useChartScrubber`)
  > - Range slider scrubber (`MobileScrubber` default `onRelease = no-op`)
  > - WorldMap marker tooltip — фейд-out след `setHover(null)` only когато hover leaves the surface, not after touch-release.

- **Edge cases:** Map tooltip следва same rule de-facto: `mouseout` clears `hover` (`WorldMap:742-746`), което е "pointer left the map", не "pointer released". ✓
- **Anti-pattern:** Slider thumb snapping to 0 на release; popup vanishing immediately; chart cursor disappearing without explicit dismiss.

---

## Aesthetic inconsistencies

Numbered for prioritization. file:line evidence.

1. **§8 — `срв.` vs `спрямо` mismatch.**
   - `SalesTrend.tsx:217` → `срв. пр. период`
   - `SalesDayPulse.tsx:213` → `срв. пр. ден`
   - `Delta.tsx:23` (canonical) → `спрямо пр. период`
   **Fix direction:** Stuff custom badges to ползват `<Delta />` или, ако се иска tiny variant, ekstract `<DeltaInline pct unit className />` helper that hardcodes "спрямо" suffix. Never "срв." на public copy.

2. **§1 indirect — hardcoded accent hex `rgb(34, 197, 94)` 6 пъти в WorldMap.tsx (lines 376, 454, 504, 523, 590, 596).**
   `globals.css:12` defines `--accent: #22c55e`. MapLibre paint accepts CSS variables in modern browsers via `getPropertyValue("--accent")` resolved on init. Hardcoded RGB strings са OK runtime-wise но dark-mode overrides на `--accent` (if ever added) ще пропуснат map. **Fix direction:** Read `--accent` once at map init, store in const, use everywhere.

3. **§1 — `#0b0d10` hardcode на marker stroke** (`WorldMap.tsx:597`). Това е dark-bg color, intended да contraст-ва accent dot на dark map style. Не е token. **Fix direction:** Add `--map-bg` token в globals.css, или derive from `--bg` dark value. Не критично — map style URL forces dark — но bro inconsistency.

4. **§10.3 — uniform `circle-radius: 5` за всички unclustered marker-и** (`WorldMap.tsx:592`). Defended in code but contradicts the explicit "discrete tiers" rule. **Fix direction:** Either revise §10.3 to allow uniform sizing when cluster aggregation already encodes magnitude (preferred), or implement T1/T2/T3 ladder.

5. **§4 — three custom delta badges duplicated** instead of using `<Delta />`. SalesTrend:206-219, SalesDayPulse:200-215, SalesRhythm:237-249. Each implements its own ▲/▼/— threshold (some `<1`, some `<0.05`). **Fix direction:** Extract `<DeltaInline />` variant in `Delta.tsx` (smaller font, no "spazрямо" suffix optionally) and use everywhere. Single threshold (recommended `<1` matches existing custom logic; the `<0.05` in main Delta is for sparkline noise floor).

6. **§5 — `mb-4 md:mb-6` is partially codified.** `/sales/page.tsx:149,157,185,189` uses it. Договор §5 ne addressва mobile-tighter density. **Fix direction:** Add §5b "On mobile (under md), overview-mode spacing may compress from `gap-6` to `gap-4` (24→16px). Drill-down stays at `gap-4` both sides."

7. **§2 hero size drift** — `SalesHeroStrip:388` ползва `text-[32px] md:text-[36px]` vs договорa `text-[28px]`. **Fix direction:** Update §2 to specifу that ASYMMETRIC hero primary tile uses 32-36px, supporting tiles 24-28px, симметричен hero stays at 28px. Tied to §13.

8. **§7 minor — SalesRhythm hour strip Y-axis is `width={36}`** (`:615`) and shows ticks at `1k`/`2k`/etc. Договорът §7.2 каza "минимална Y-ос (2-3 ticks)" — Recharts auto-ticks rarely picks ≤3. **Fix direction:** Add `tickCount={3}` to enforce minimal ticks explicitly. Same for SalesTrend:272 and SalesDayPulse:291,301.

9. **"Средно" vs "Общо" — никаде в договора.** `SalesRhythm.tsx:551` пише `Средно` като column header. `TopProductsAggregate` (and others) imply "Общо" but never say it. Now that per-occurrence averaging exists, this distinction is meaningful — needs §16 codification.

10. **Skeleton accuracy.** `SalesHeroStrip:455-477` skeleton matches live grid exactly (col-span-6/3/3). `SalesTrend:181-189`, `SalesDayPulse:178-187`, `SalesRhythm:475-484` все ползват `Skeleton className="h-[260px] w-full"` или подобeн — generic block, не matches peakBadge row или legend row. **Fix direction:** Add skeleton rows for peakBadge (h-3 w-32 mb-2) и legend (h-3 w-48 mb-3) преди chart block. Минор reflow on load.

11. **Loading / empty / error coverage.** Audit per-card:
    - SalesHeroStrip — loading ✓, error ✓ (line 566-572), empty implicit (zero values render). Good.
    - SalesSignalStrip — loading ✓, error ✗ (no kpisError check), empty implicit. **Add error fallback.**
    - SalesTrend — loading ✓, error ✗ (no fallback when `cur === undefined && !isLoading`), empty implicit. **Add error fallback.**
    - SalesDayPulse — same as SalesTrend.
    - SalesRhythm — same.
    - TopProductsAggregate — loading ✓, empty ✓ (`:115-119`), error ✗. **Add error fallback.**
    - CountryListPanel — loading ✓, empty ✓ (`:110-114`), error implicit (passed isLoading only). OK.
    - WorldMap — no skeleton / no error overlay; container shows Stadia tiles or blank. **Add error overlay** ако `/api/sales/geography/*` падне.

12. **`tabular-nums` coverage** — почти navсякадe applied. One miss: `TopProductsAggregate.tsx:131` truncated title `<span className="text-[13px] text-text truncate">{p.title}</span>` — title не е число, ОК. `:147` quantity ✓, `:144` share ✓, `:133` revenue ✓. Pass.

13. **`toLocaleString("bg-BG")` coverage.** All fmtEur / fmtInt helpers ползват `"bg-BG"`. Pass.

14. **Dark mode coverage.** Few hex hardcodes break it (#3, #4 above). Otherwise all CSS variables. Should test the map at `.dark` since `STADIA_STYLE_URL` is `alidade_smooth_dark` permanently — dark map on light theme is a visual mismatch in light mode. **Fix direction:** swap to `alidade_smooth` (light) when `.dark` class absent. Or codify "map is always dark per intelligence-hub vocabulary" as part of §10.

15. **Snap-scroll signal strip on tablet (md width).** `SalesSignalStrip:153-159` uses `md:grid md:grid-cols-4 lg:grid-cols-5`. На md width (768-1023px) — 4 tiles fit. ОК. На lg+ — 5 tiles. ОК. Но: ако stores filter изключи "Топ пазар" tile (line 284 conditional render), grid става 4 tiles на lg → cols-5 layout оставя empty cell. **Fix direction:** Add `min` rule so 4 tiles рендeринг като 4-col grid дори при lg. Or codify in §14: "tile count == grid col count; conditional tiles need explicit grid override."

---

## Recommended contract amendments — ordered

Преди извеждане към `/traffic`, `/products`, `/ads`, `/email`, `/customers`:

1. **Codify §11 Glass tooltip vocabulary** — fix duplication между `GlassTooltip.tsx` и WorldMap inline tooltips. (Highest leverage; визуалното drift между chart-popup и map-popup е първото което следваща страница ще copy-paste погрешно.)
2. **Codify §17 + §18 (chart-touch synergy + persistence on release)** — този pattern е core за всеки mobile chart, draft за следваща страница ще се изгуби без правило.
3. **Codify §12 Headline-in-header** — всяка следваща карта трябва да носи insight в header, не само title.
4. **Codify §16 Per-occurrence averaging** + "Средно"/"Общо" vocabulary — same trap ще ucapне at /traffic (Sessions per typical Monday) и /ads (CPM per typical campaign-day).
5. **Codify §15 Adaptive view per date range** — будъщи charts will hit this; обясни прокозvane от resolved range не от preset name.
6. **Fix §8 — "срв." → "спрямо" uniformity** — direct edit на SalesTrend.tsx:217 + SalesDayPulse.tsx:213 + extract `<DeltaInline />` helper.
7. **Codify §13 + §14 (asymmetric hero + snap-scroll strip)** — дава design vocabulary за every overview page.
8. **Revise §10.3** to allow uniform marker sizing когато cluster aggregation encodes magnitude (или revert WorldMap to discrete tiers).
9. **Add error fallback rules to §8 (CLAUDE.md principle 8)** — codify "every analytics card has all-three states designed."

---

## Open questions

1. **§8 — "срв." или "спрямо"?** Препоръчам "спрямо" but operator decision. Affects 2 file edits.
2. **§10.3 — keep uniform marker sizing or implement T1/T2/T3 ladder?** Trade-off е дefended in WorldMap:580-583, но contradicts договорa expлицитно. Operator pick.
3. **§9 SalesRhythm weekday smooth area — keep monotone for averaged crivа?** Smooth е honest за averages but visually equivalent to "smooth area for counts" which is §9.5 anti-pattern. Worth explicit "averaged counts ⇒ smooth допустим" amendment to §9.1 / §9.5.
4. **WorldMap — keep dark map style на light theme?** Currently always dark via STADIA_STYLE_URL. Light theme operators see jarring contrast. Codify в §10 or swap based on theme?
5. **§13 — declare canonical "primary metric per overview screen" список?** За /traffic — Sessions? За /ads — Spend? За /email — Sent? Each page needs explicit primary, иначе asymmetric hero е арbitrary.
6. **§16 — should "n=4" chip live in tooltip only or always inline next to value?** Currently inline (SalesRhythm:312-316). Inline catches the eye but adds visual noise on 7 rows. Could be tooltip-only with consistent label "Средно (виж n)".
7. **SalesDayPulse legend (lines 235-257) — is it OK as colored swatches?** Договор §3 разрешава indicator dot за status — line swatch е border-case. Counts as decoration or as status indicator?
