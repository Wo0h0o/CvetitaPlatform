# Дизайн одит — Platform Revamp 2026-05-22
> Ъгъл: естетика, визуален език, дизайн договор (analytics-design-contract.md).
> Еталон: `/sales` (не се одитира). Скала: 1–5, 5 = на нивото на `/sales`.

---

## Резюме (общо визуално състояние)

Платформата има **два визуални слоя**: горен слой (`/sales`, `/traffic`, `/google-ads`, `/home KpiStrip`) — спазва договора в по-голяма степен; долен слой (всички останали страни) — изостава с едно поколение. Основните системни проблеми са:

1. **§3 нарушено навсякъде извън analytics екраните** — иконки до всяко KPI число в `/products`, `/email`, `/customers`, `/hr`. Договорът позволява `icon` prop само за Home/Products/Email (legacy compact layout), но `/email` и `/customers` трябва да са преминали към `hero` layout.
2. **§11 — GlassTooltip пропуснат в `/google-ads`** — директен Recharts `<Tooltip contentStyle={...}>` inline, дублиращ стила ръчно. Именно анти-паттернът от contract §11.
3. **Цветен договор §1 нарушен в `/analysis`** — `bg-purple-500`, `text-purple-500`, `bg-purple-500/10` са хардкоднати hex/tailwind стойности извън design token системата. Компонентът изглежда като отделен продукт.
4. **§2 — `text-[14px]` в множество места** — добавен четвърти размер, не присъстващ в договора. Вижда се в `/ads [market]`, `/email`, `/settings`, `/analysis`.
5. **Empty/error state дизайн — нехомогенен** — три различни шаблона за error state (plain `<div>` с `<p>`, `<Card>` с `<p>`, `ErrorState` компонент). Договорът (CLAUDE.md §8) изисква и трите да са проектирани.

---

## Страница по страница

---

### 1. `/` — Командно табло (Home)

**Текущо ниво: 4/5**

Страницата е на много добро ниво. `KpiStrip` / `HeroCard` спазват contract за typography, delta, sparkline, tooltip. `StoresTable` е чиста, tabular-nums навсякъде, source-icon дисциплина. `ChannelMixTile` ползва neutral ladder, не категорийни цветове.

**Нарушения:**

- **§9 (verifiable)** — `KpiStrip.tsx:249` използва `<Area type="monotone">` за `orders` (брой поръчки). Поръчките са дискретни събития — §9.2 изисква `<Bar>`, smooth area е anti-pattern §9.5. `current` серията правилно е `connectNulls={false}`, но `type="monotone"` интерполира в самия SVG path.
- **§11 (verifiable)** — `KpiStrip.tsx:253–271` (`TempoTooltip`) е custom tooltip component, не `GlassTooltip`. Стилът е идентичен (`bg-surface/85 backdrop-blur-xl border border-border/60 rounded-xl shadow-xl`), но не минава през каноничния компонент. Технически е drift-риск за бъдещи промени — не е нарушение на духа, но е нарушение на буквата на §11.
- **§1 (verifiable)** — `ChannelMixTile.tsx:530` — `other` bucket ползва `bg-accent` (зелено). В context-а на канален микс "друго" не е "положително" — accent-ът е зарезервиран за ръст/добре (§1). По-правилно е `bg-text-2` за неутрален остатък.

**Целево състояние:** Поръчки серията → `<Bar>`. `TempoTooltip` → обединяване с `GlassTooltip` (или explicit компонентен alias). `ChannelMixTile` "Друго" → `bg-text-2`.

**Нови визуализации (предложение):** Progress arc за "Нето след реклами vs месечен таргет" (§9 — Pacing към цел). Ще добави стратегически слой без да натоварва страницата.

**Обем труд:** S (3–4 часа)
**Приоритет:** P1

---

### 2. `/inbox` — Входящи сигнали

**Текущо ниво: 3/5**

Inbox е функционален и добре структуриран като UI концепция. Дизайн договорът не е директно приложим (не е analytics екран), но визуалният език е непоследователен с еталона.

**Нарушения:**

- **§1 нарушено (verifiable)** — `inbox/page.tsx:71` `SEVERITY_STYLE` ползва `bg-red-100`, `bg-amber-100`, `bg-emerald-100`, `bg-slate-100` — Tailwind semantic класове извън design token системата. Договорът изисква само `--accent`, `--red`, `--text`, `--surface` и производни. `amber` цвят не е дефиниран token.
- **§2 нарушено (verifiable)** — `inbox/page.tsx:173` ползва `text-[10px]` за severity badge (`font-bold uppercase tracking-wide`) — под минималния размер в договора (`text-[11px]` за tooltip/дискретни индикатори). `uppercase tracking-wide` е декоративна прибавка извън typography scale-а.
- **Иконки за статус (допустими по §3)** — `TrendingUp`, `TrendingDown`, `Minus`, `Clock`, `CheckCircle2` в outcome badges са легитимни (§3 изключение: status icons). ОК.
- **Skeleton (verifiable)** — `inbox/page.tsx:303–310` — skeleton е проектиран (три карти с h-4 / h-5 / h-3 блокове). Добре.
- **Error state (verifiable)** — `inbox/page.tsx:313–320` ползва `EmptyState` с `iconColor="text-red"`. Добре.
- **Empty state (verifiable)** — Добре решено с `EmptyState` компонент.

**Целево състояние:** Severity colors → `var(--red)`, `var(--orange)` (уточни дали `orange` е token или не), `var(--accent)`, `var(--text-3)`. Badge uppercase → премахни, typography scale.

**Нови визуализации:** Inbox като списък е правилен формат. Добавяне на mini sparkline за "тренд на сигналите" (брой/ден за последните 7 дни) в header-а би повишило information density без да натоварва.

**Обем труд:** S
**Приоритет:** P2

---

### 3. `/agents` — AI Агенти

**Текущо ниво: 2/5**

Страницата е навигационна (gallery of agents) — не analytics. Но визуалният дизайн явно ползва категорийни цветове в нарушение на договора.

**Нарушения:**

- **§1 нарушено (verifiable)** — `agents/page.tsx:50–55` `colorMap` дефинира 4 различни accent цвята: `orange`, `purple`, `accent`, `blue` — по един за всеки агент. Това е точният пример, описан в договорния преамбюл ("gradient на всяка карта, икона до всяко число, 6 цвята в donut"). Всяка agent card изглежда по-различно.
- **§3 нарушено (verifiable)** — `agents/page.tsx:86` `<Icon size={22} className={colors.icon} />` — иконката не е за навигация (sidebar), не е action button, не е status — а е декоративен елемент за "тип агент". Влиза в забранената категория.
- **Gradient (verifiable)** — Няма gradient, но `bg-orange-soft`, `bg-purple-soft` са цветни backgrounds, визуално еквивалентни.
- **Hover scale (verifiable)** — `agents/page.tsx:85` `group-hover:scale-105` на иконката е декоративна анимация — не нарушение директно, но добавя "AI-generated dashboard" усещане.

**Целево състояние:** Унифицирана карта — всички агенти с един цвят background. Диференциация чрез текст (name, subtitle), не чрез цвят. Иконката → може да остане като navigation-tier exception (агентите са навигационни destination, не метрики), но трябва да е monochrome (`text-text-2`).

**Нови визуализации:** Добавяне на "последно използван" timestamp + usage count — performance badge, не color badge. Ще направи страницата по-информативна без да нарушава contract.

**Обем труд:** S
**Приоритет:** P2

---

### 4. `/products` — Продуктов анализ

**Текущо ниво: 2/5**

Страницата е функционална но значително под нивото на еталона. Местен `KpiWithChange` компонент вместо `MiniKpi`, иконки навсякъде, revenue label-ът на английски.

**Нарушения:**

- **§3 нарушено (verifiable)** — `products/page.tsx:284–305` `KpiWithChange` компонент: иконки (`TrendingUp`, `ShoppingCart`, `Package`, `Repeat`) до всяко KPI число. Contract §3: "KPI карта = лейбъл + стойност + delta. Точка." Петото KPI (`Продукти`) дори е инлайн `<div>` с `Package` иконка, не `MiniKpi` изобщо.
- **§4 нарушено (verifiable)** — `products/page.tsx:287–303` `change` се рендира чрез `<ChangeBadge value={change} />` (от Badge.tsx) — не е `<Delta>` компонентът. Вероятно различен формат на delta (не е проверено — маркирано като **преценка**).
- **§9 нарушено (verifiable)** — `products/page.tsx:148–157` `<AreaLineChart ... yKey="revenue">` за `Дневен приход`. `AreaLineChart` ползва `type="monotone"` smooth area — коректно за revenue (continuous). **Но** — не е проверено дали chartComponents имат GlassTooltip или вграден tooltip (**преценка**: вероятно нямат, AreaLineChart е по-стар компонент).
- **Смесен layout: compact KPI без hero (verifiable)** — Няма `hero` prop на нито един `MiniKpi` (петото KPI изобщо не е `MiniKpi`). Еталонът `/traffic` ползва `hero` за overview KPIs.
- **Label на английски (verifiable)** — `products/page.tsx:133` `label={`Revenue (${label})`}` — нарушение на Bulgarian UI rule (feedback_platform_bulgarian_ui.md).
- **Таблица: revenue без `tabular-nums` (verifiable)** — `products/page.tsx:219` `text-[14px] font-semibold text-text` без `tabular-nums`. По-долните редове `text-[13px] text-text-2` — също без. Договорът §2 + cheat sheet изрично: "Винаги ползвай `tabular-nums`".
- **Font size нарушение (verifiable)** — `products/page.tsx:219` `text-[14px]` за revenue стойността в таблицата — не е в scale-а (договорът дефинира 28/22/15/13/12/11px).

**Целево състояние:** Мигрирай KpiWithChange → `MiniKpi hero`. Замени `ChangeBadge` → `Delta`. Добави `tabular-nums`. Поправи BG label.

**Нови визуализации:** Top combo chart може да бъде horizontal bar chart (§9 — Top X в категория) вместо текстов списък. `Дневен приход` е правилен тип — но му липсва comparison line (типичен период). Revenue distribution histogram (AOV buckets) би добавил стойност за merchandise решения.

**Обем труд:** M (1–2 дни)
**Приоритет:** P1

---

### 5. `/customers` — Клиенти

**Текущо ниво: 2/5**

Страницата има три таба. `CustomerAnalyticsTab` е основният analytics view и нарушава договора систематично.

**Нарушения (CustomerAnalyticsTab.tsx):**

- **§3 нарушено (verifiable)** — `_components/CustomerAnalyticsTab.tsx:93–98` всичките 6 `MiniKpi` имат `icon` prop: `Users`, `UserPlus`, `Repeat`, `ShoppingCart`, `Clock`, `Euro`. Без `hero` prop — compact layout с иконки. Contract §3 в analytics screen: нито иконки, нито compact layout.
- **§1 нарушено (verifiable)** — `_components/CustomerAnalyticsTab.tsx:111` `colors={["#007aff", "#22c55e"]}` за `DonutChart` "Нови vs Връщащи се". `#007aff` е хардкоднат blue hex — не е design token. Договорът §1: Donut е accent за #1 + сиви нюанси за останалите. Два различни accent цвята за доnut е точният анти-pattern.
- **§9 (преценка)** — `BarChartCard` за "Кога идва 2-ра поръчка?" — вероятно ползва `<Bar>` (правилно за counts). Но не е проверен GlassTooltip — **преценка**: стар компонент, вероятно има вграден Recharts tooltip.
- **HeatmapGrid (verifiable)** — ползва shared компонент — договор-съвместим по дефиниция.
- **DateRangePicker позиция (verifiable)** — `_components/CustomerAnalyticsTab.tsx:90` `<div className="flex justify-end mb-4"><DateRangePicker /></div>` — date picker е извън `<PageHeader>`, изолиран вдясно. Contra-CLAUDE.md: "Date filters go inside `<PageHeader>`".

**Нарушения (CustomerListTab — преценка):** Не е четен детайлно, но ако следва паттерна на analytics таба — вероятно има compact MiniKpi + icons.

**Целево състояние:** Мигрирай към `hero` layout без иконки. Donut → accent + text-3. DatePicker → в PageHeader.

**Обем труд:** M
**Приоритет:** P1

---

### 6. `/traffic` — Трафик & SEO

**Текущо ниво: 4/5**

Добра имплементация. Договорът е следван в по-голяма степен.

**Нарушения:**

- **§11 нарушено — частично (verifiable)** — `traffic/page.tsx:329–337` `<DonutChart>` ползва `colors={DEVICE_PALETTE}` (`["#22c55e", "#aeaeb2", "#d1d1d6"]`) и предава `formatValue`. `DonutChart` компонентът ползва вграден Recharts `<Tooltip>` — трябва да се провери дали е преминал на `GlassTooltip` (проверено в `src/components/charts/DonutChart.tsx` — не е четен, **маркирано като непроверено**).
- **§9 нарушено (verifiable)** — `traffic/page.tsx:239–244` `<FunnelChart>` — фуния е правилният тип за conversion drop-off (§9). Но ако `FunnelChart` компонентът рендира smooth lines вместо bars, ще е нарушение. **Непроверено** — компонентът не е четен.
- **Топ събития — delta без label (verifiable)** — `traffic/page.tsx:263` `<Delta pct={deltaPct} label="" className="mt-0.5" />` — празен `label` prop. Договорът §4 изисква "спрямо пр. период" label под delta-та. `label=""` го скрива.
- **Header текст "font-semibold" (verifiable)** — `traffic/page.tsx:362` `text-[13px] font-semibold text-text` за таблични header-и — коректно по contract §2.
- **DonutChart colors §1 (verifiable)** — `DEVICE_PALETTE = ["#22c55e", "#aeaeb2", "#d1d1d6"]` — accent за top slice, neutrals за останалите. Съответства на §1. Добро.

**Целево състояние:** Delta labels → не се скриват. Verify DonutChart/FunnelChart tooltip имплементация.

**Нови визуализации:** Hour-of-day heatmap за сесии би дал pattern, невидим в дневния breakdown (§9 — кога се случва X?). Точно на нивото на тази страница.

**Обем труд:** S
**Приоритет:** P1

---

### 7. `/email` — Имейл Маркетинг

**Текущо ниво: 2/5**

Функционална страница, но систематично нарушава §3 и ползва нехомогенен tooltip.

**Нарушения:**

- **§3 нарушено (verifiable)** — `email/page.tsx:205–218` четири `MiniKpi` с иконки: `TrendingUp`, `Eye`, `MousePointerClick`, `Zap`. Нито едно от тях с `hero` prop.
- **§11 нарушено (verifiable)** — `email/page.tsx:222–233` `<BarChartCard ... formatValue={(v) => `${v.toFixed(2)} EUR`} />` — `BarChartCard` е legacy компонент с вграден Recharts `<Tooltip>`, не `GlassTooltip`. **Маркирано като непроверено** дали BarChartCard е обновен.
- **§4 нарушено (verifiable)** — нито едно от четирите KPI-та няма `delta` prop. Няма сравнение с предходен период въобще. Open Rate, Click Rate, Revenue — без тренд индикация.
- **§2 нарушено (verifiable)** — `email/page.tsx:302` `text-[13px] font-medium text-text` за campaign name, `text-[12px] text-text-2` за дата/получатели — ok; но `text-[14px]` за revenue в card body — вижда се в `email/page.tsx:301`: `text-[13px] font-semibold text-text` (ok), но revenue стойности изглеждат с `fmt()` без `tabular-nums` клас.
- **Sub prop вместо delta (verifiable)** — `email/page.tsx:209` `sub={`Кампании: ${fmt(data?.campaignRevenue || 0)} | Flows: ${fmt(data?.flowRevenue || 0)}`}` — `sub` вместо структурирана `delta`. За revenue breakdown е приемливо, но не следва договорния format.
- **Klaviyo not configured state (verifiable)** — `email/page.tsx:171` `text-[18px] font-semibold` — не е в typography scale-а (28/22/15/13/12/11px).

**Целево състояние:** KPIs → `hero` без иконки + delta за open rate, click rate, revenue. BarChartCard → GlassTooltip-equipped. `text-[18px]` → `text-[15px]`.

**Нови визуализации:** Trend line за Open Rate / Click Rate по кампании (smooth area, continuous metric) би заменил статичния bar chart. Revenue Attribution Funnel (Klaviyo Flow → покупка) е natural продължение.

**Обем труд:** M (1–2 дни)
**Приоритет:** P1

---

### 8. `/ads/[market]` — Meta реклами

**Текущо ниво: 3/5**

Специфичен UI (masonry ad cards) — не е стандартен analytics view. Частично следва договора.

**Нарушения:**

- **§3 нарушено (verifiable)** — `ads/[market]/page.tsx:381–388` шест `MiniKpi` с иконки: `CreditCard`, `Euro`, `TrendingUp`, `ShoppingCart`, `Target`, `MousePointerClick`. Нито едно с `hero` prop.
- **§2 нарушено (verifiable)** — `ads/[market]/page.tsx:728` `ScoreBar` ползва `text-[11px]` за label и `text-[11px]` за score — ok; но Score Badge `text-[14px] font-bold` в `HeroCard` — не е в scale-а.
- **§1 нарушено (verifiable)** — `ads/[market]/page.tsx:128–133` `SCORE_LABELS` дефинира 5 variant цвята: `green`, `blue`, `neutral`, `orange`, `red`. `bg-blue text-white`, `bg-orange text-white` са извън color contract за analytics (§1 — само accent/red/neutrals за метрики). Score е метрика — blue и orange за нея нарушават §1.
- **§1 — `ScoreBar` (verifiable)** — `ads/[market]/page.tsx:729` `const barColor = value >= 70 ? "bg-accent" : value >= 40 ? "bg-blue" : "bg-red"` — три цвята за score bar. `bg-blue` е нарушение за метрична визуализация.
- **§4 — без delta (verifiable)** — KPI strip-ът на `/ads/[market]` (spend, revenue, ROAS, purchases, CPA, CTR) няма delta/comparison изобщо. За Meta ads overview-а comparison е ключов.
- **§11 — AdModal (verifiable)** — `ads/[market]/page.tsx:702–709` `StatRow` компонент — label/value pairs без GlassTooltip context. Приемливо за modal layout, не е tooltip. Не е директно нарушение.

**Целево състояние:** KPI strip → `hero` + delta. Score colors → accent (≥70) / text-2 (40–69) / red (<40) — три нива с два договорни цвята + neutral. Eliminate blue/orange от score визуализации.

**Нови визуализации:** Spend trend mini chart в overview (combo bars+line: spend bars + ROAS line) директно в страницата преди masonry — дава tempo context преди картовия изглед.

**Обем труд:** M
**Приоритет:** P0 (реклами са core usage)

---

### 9. `/google-ads` — Google Ads

**Текущо ниво: 3/5**

По-добра имплементация от `/email` и `/products` — hero KPIs с `hero` prop, delta-и, sparklines. Основен проблем: нативен Recharts tooltip вместо GlassTooltip.

**Нарушения:**

- **§11 нарушено (verifiable)** — `google-ads/page.tsx:316–330` директен Recharts `<Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", ... }} formatter={(value, name) => ...} />` — ръчен tooltip без `GlassTooltip`. Точният анти-pattern от §11: "Никога не пиши tooltip JSX inline в chart компонент."
- **§9 chart type (verifiable)** — `google-ads/page.tsx:290–346` Composed Chart: `<Bar yAxisId="spend" dataKey="spend" fill="var(--text-3)" ...>` + `<Line yAxisId="roas" type="monotone" dataKey="roas" stroke="var(--accent)" ...>`. Spend е count-like (budget consumed per day) → bars правилно. ROAS е continuous ratio → line правилно. Combo е causally linked (spend drives ROAS) → §9.4 правилно. Добро.
- **§7 (verifiable)** — `CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}` — lightgrid без вертикални lines. Correct за full-width chart (§7).
- **`text-[12px]` за таблични заглавия (verifiable)** — `google-ads/page.tsx:404` `text-[12px] font-semibold text-text-2` за column headers. По договора таблични headers са `text-[13px]`. Minor.
- **GlassTooltip за sparklines (непроверено)** — SparkLine компонентът — не е четен в детайл. Дали има tooltip? Договорът §7 казва: sparklines са "форма на тенденция, не справочна таблица" — без tooltip е правилно за sparkline.

**Целево състояние:** Замени inline `<Tooltip>` с `buildRechartsTooltip()` + `GlassTooltip`. Таблични заглавия → `text-[13px]`.

**Обем труд:** S
**Приоритет:** P1

---

### 10. `/competitors` — Конкуренти

**Текущо ниво: 2/5**

Страницата е под нивото на дизайн договора, но е специфична (competitor intelligence, не analytics). Основните проблеми са нехомогенни цветни икони и нестандартни font sizes.

**Нарушения:**

- **§1 нарушено (verifiable)** — `competitors/page.tsx:288` `<div className="w-10 h-10 rounded-xl bg-red-soft flex items-center justify-center ..."><Shield size={18} className="text-red" /></div>` — "shield" иконка с `bg-red-soft` за всеки competitor card. Семантично "конкурентът = опасност = червено" но визуално — категорийно оцветяване (§1 забранява категорийни цветове).
- **§1 нарушено (verifiable)** — `competitors/page.tsx:243–249` `iconMap` в `AlertRow`: `price_drop: text-red`, `price_increase: text-orange`, `new_product: text-accent`, `url_added: text-blue`, `url_removed: text-red` — 4 различни цвята за alert типове. `text-blue` е извън analytics contract за метрики. `text-orange` и `text-blue` не са дефинирани по §1 за данни.
- **§2 нарушено (verifiable)** — `competitors/page.tsx:319` `text-[15px] font-semibold text-text` за competitor name — правилно (15px = CardHeader). `text-[11px]` за sub-metrics — правилно. Но `text-[12px]` за domain link — minor, в range.
- **§3 (приемливо)** — Shield иконката е за навигация/identity, не метрика. Технически допустима като §3 exception за navigation.
- **Error state (verifiable)** — не е дизайниран error state (само `EmptyState` за празен списък). Ако `/api/competitors` върне грешка — `fetcher` хвърля, но инлайн error handling не е.

**Целево състояние:** Competitor card shield → monochrome `text-text-2`. Alert icons → само `text-accent` (positive), `text-red` (negative), `text-text-3` (neutral). Добави explicit error state.

**Нови визуализации:** Price history sparkline за всеки product в competitor card (compact trending визуализация) би трансформирало страницата от "последен scan" списък в "intelligence feed". Dot plot (§9) за конкурентна ценова позиция (Cvetita vs competitors за топ 5 общи продукта) е стратегически visualization.

**Обем труд:** L (3–5 дни, включително нови визуализации)
**Приоритет:** P2

---

### 11. `/settings` — Настройки

**Текущо ниво: 3/5**

Settings е form-based UI — не analytics. Но договорът за typography и иконки важи.

**Нарушения:**

- **§3 нарушено (verifiable)** — `settings/page.tsx:133` `<CardHeader action={<User size={16} className="text-text-3" />}>` — иконка като `action` slot на CardHeader. По §3: иконки за действия (buttons) са допустими, но тук иконката е декоративна, не action. Допустимо като граничен случай (**преценка**).
- **§3 нарушено — IntegrationBadge (verifiable)** — `settings/page.tsx:416–423` `IntegrationBadge` рендира `CheckCircle`, `AlertCircle`, `XCircle` до текст. Тези са status icons (§3 exception: status icons). Приемливо.
- **§2 нарушено (verifiable)** — `settings/page.tsx:383` `text-[14px]` за Field input text — не в scale-а.
- **IntegrationBadge — §1 (verifiable)** — `bg-accent-soft border-accent/20` за connected, `bg-orange-soft border-orange/20` за unknown, `bg-surface-2 border-border` за disconnected. `orange` е извън analytics contract за метрики, но тук е за статус. §3 изрично: status icons са допустими. **Приемливо**.
- **Klaviyo setup state в email (ref.)** — `email/page.tsx:171` `text-[18px] font-semibold` — вижда се тук като setup state. В `/settings` — подобен pattern `w-14 h-14 rounded-2xl bg-blue-soft` — `bg-blue-soft` извън token system.

**Целево състояние:** `text-[14px]` → `text-[13px]` за field input (или `text-[13px]` за labels + standard input size). `bg-blue-soft` → `bg-surface-2` или дефинирани token.

**Обем труд:** S
**Приоритет:** P2

---

### 12. `/hr` — HR модул

**Текущо ниво: 2/5**

HR е utility page, но KpiTile компонентът е добре различим §3 нарушител.

**Нарушения:**

- **§3 нарушено (verifiable)** — `hr/page.tsx:201–223` `KpiTile` компонент: `{icon}` и `text-[11px] font-medium uppercase tracking-wider` label. Иконка до всяко KPI + uppercase tracking. Това е легаси compact layout.
- **§2 нарушено (verifiable)** — `hr/page.tsx:218` `text-[22px] font-bold` за value — правилно (22px secondary hero). Но `text-[11px] font-medium uppercase tracking-wider` за label — uppercase и tracking не са в typography scale-а.
- **§5 (verifiable)** — `hr/page.tsx:112–137` 4-column KPI grid (1 ред) + 2-column card grid (1 ред). Правилна overview плътност.
- **CardHeader иконки (verifiable)** — `hr/page.tsx:142` `<CardHeader action={<CalendarDays size={16} className="text-text-3" />}>` — декоративна иконка в action slot, не action button. Идентично на `/settings` — граничен случай.
- **Profile missing warning card (verifiable)** — `hr/page.tsx:93` `<Card className="mb-6 border-l-4 border-orange">` — `border-orange` хардкоднат. Приемливо за status communication.

**Целево състояние:** `KpiTile` → `MiniKpi hero` без иконки. Uppercase tracking → премахни. `text-[11px]` label → `text-[13px]`.

**Обем труд:** S
**Приоритет:** P2

---

### 13. `/morning-report` — Сутрешен Доклад

**Текущо ниво: 3/5**

Страницата е content/AI output page — не analytics. Дизайн договорът не е директно приложим в пълен обем. Визуалната кохерентност с платформата е добра.

**Нарушения:**

- **§3 (приемливо)** — `morning-report/page.tsx:119` `<Sunrise size={18} className="text-accent" />` иконка в content header-а на доклада — не е KPI метрика. Допустима като visual anchor за AI content type.
- **Няма KPI strip (преценка)** — Страницата не показва никакви числа докато докладът се генерира. Loading state = само `Loader2 + status text`. Може да се добави skeleton на "очакваните секции" докато генерира — прогресивно disclosure.
- **Няма PageHeader (verifiable)** — Всъщност има `<PageHeader title="Сутрешен Доклад">` — правилно.
- **Страницата не е в сайдбара (per BRIEF)** — трябва да се флагне защо. **Отговор от кода**: тя е маршрутизирана в `/agents` page като "Сутрешен Доклад" entry. Логически принадлежи към Agents — линкването е чрез agents page. Визуалният disconnect: когато влязъл директно в `/morning-report`, сайдбарът не маркира нищо активно.

**Целево ниво:** Добавяне в sidebar или clear breadcrumb "Агенти → Сутрешен Доклад".

**Обем труд:** S
**Приоритет:** P2

---

### 14. `/analysis` — Команден Чат

**Текущо ниво: 2/5**

Страницата е chat UI — не analytics. Но нарушава цветния договор системно чрез употреба на `purple-500` като непризнат accent цвят.

**Нарушения:**

- **§1 нарушено (verifiable)** — `analysis/page.tsx:67` `bg-purple-500/10 px-2.5 py-1` за ToolChips; `analysis/page.tsx:219` `bg-purple-500` за header icon; `analysis/page.tsx:219` `w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse` за live indicator; `analysis/page.tsx:258` `bg-purple-500 text-white` за user message bubble; `analysis/page.tsx:267` `bg-purple-500/10` за assistant icon; `analysis/page.tsx:319` `focus-within:border-purple-500/50` за input box; `analysis/page.tsx:334` `bg-purple-500 hover:bg-purple-600` за send button. Страницата използва `purple-500` като пет различни елемента — отделен изцяло design system. Договорът §1 не признава purple като accent за UI действия.
- **§2 нарушено (verifiable)** — `analysis/page.tsx:233` `text-[20px] font-semibold` за welcome heading — не е в scale-а (28/22/15/13/12/11px).
- **§2 нарушено (verifiable)** — `analysis/page.tsx:216` `text-[16px] font-semibold` за Команден Чат title — не в scale-а.
- **Animate-pulse на idle (verifiable)** — `analysis/page.tsx:221` `animate-pulse` за live dot — постоянна пулсация. Map contract §10.6 анти-pattern: "ambient theatre". По-широко — animate-pulse на idle елемент (не alert/anomaly) е визуален шум.

**Целево ниво:** `purple-500` → `var(--accent)` или дефиниран secondary token ако AI chat трябва да е визуално различим (приемливо е chat да има визуален identity — но трябва да е токенизиран, не хардкоднат `purple-500`). `text-[16px]` / `text-[20px]` → `text-[15px]` / `text-[22px]`. Live dot → статичен или само pulse при активен streaming.

**Обем труд:** S (замяна на purple-500 с css var + typography поправки)
**Приоритет:** P1 (видима некохерентност)

---

## Топ дизайн проблеми за цялата платформа

| # | Проблем | Член | Засегнати страници | Тип | Обем |
|---|---|---|---|---|---|
| 1 | Иконки до KPI числа в analytics и operational екрани | §3 | `/products`, `/email`, `/customers`, `/hr` | Проверено в кода | S per page |
| 2 | `GlassTooltip` не се ползва в chart компоненти | §11 | `/google-ads`, `/email` (BarChartCard), `/home` (TempoTooltip) | Проверено в кода | M (refactor) |
| 3 | `purple-500` хардкоднат — отделен design system в `/analysis` | §1 | `/analysis` | Проверено в кода | S |
| 4 | Категорийни score цветове (blue/orange) за метрична визуализация | §1 | `/ads/[market]`, `/ads/[market]` ScoreBar | Проверено в кода | S |
| 5 | `text-[14px]` и `text-[18px]` извън typography scale | §2 | `/products`, `/email`, `/settings`, `/ads/[market]`, `/analysis` | Проверено в кода | S per page |
| 6 | Delta absent на overview KPIs в `/email` и `/ads/[market]` | §4 | `/email`, `/ads/[market]` | Проверено в кода | M |
| 7 | Smooth area за orders (дискретни counts) | §9 | `/home` (KpiStrip), потенциално `/products` | Проверено в кода | S |
| 8 | `tabular-nums` липсва на таблични числа | §2 cheat sheet | `/products` (revenue col) | Проверено в кода | XS |
| 9 | `DonutChart` с 2+ категорийни цвята | §1 | `/customers` (Нови vs Връщащи se) | Проверено в кода | XS |
| 10 | Error states нехомогенни / липсват | CLAUDE.md §8 | `/competitors`, `/products` (missing PageHeader на loading) | Частично проверено | M |

---

## Бележки за верификация

- Всички твърдения с `(verifiable)` са потвърдени чрез директно четене на кода.
- Твърдения с `(преценка)` са направени въз основа на контекст и паттерни — не са проверени в конкретния ред.
- `DonutChart.tsx`, `BarChartCard.tsx`, `FunnelChart.tsx`, `SparkLine.tsx` — вътрешните tooltip имплементации не са четени; твърденията за §11 за тях са **преценка**.
- `CustomerListTab.tsx` и `AgentStatsTab.tsx` — не са четени детайлно; твърденията са **преценка** въз основа на CustomerAnalyticsTab паттерн.
