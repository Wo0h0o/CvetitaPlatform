# Reuse Preparation & Code Cleanliness Audit — /sales

> Дата: 2026-05-21 · Auditor: Reuse Prep & Code Cleanliness
> Scope: `/sales` overview + drill-down + every chart / shared primitive it touches
> Цел: Подготовка преди /traffic, /products, /ads, /email, /customers. „Prep the kitchen, not extend it yet."

---

## Executive summary

Голяма част от мисловната работа е свършена: `GlassTooltip`, `MobileScrubber`, `useChartScrubber`, `Delta`, `HeatmapGrid`, `MiniKpi`, `Card`, `ChartContainer`/`useChartColors` живеят в shared/ и charts/ и вече се ползват без /sales-specific предположения. Hero/Signal strips и Rhythm/Trend charts четат един и същ glass vocabulary през тези примитиви. На фундамента нямаме генеричен дефицит — имаме genericals, които никой друг екран не вика още, и /sales-specific consumers с copy-paste у тях, които ще се размножат на 10×, когато копираме шаблона за `/traffic` или `/ads`.

Най-голямата дупка е форматирането: `fmtEur`/`fmtInt`/`fmtPct` са копирани **дванадесет пъти** из `src/components/sales/`, и са семантично разминати с `src/lib/format.ts` (което изписва "1 234 €", а sales консумерите — "1 234 EUR"). Това НЕ е козметичен дефект; той е препятствие за extraction. Всеки нов consumer (TempoTile в /traffic, AdSpendTile в /ads) ще добави още един copy, защото няма канонично място за hook. Втората дупка е, че `SalesHeroStrip`, `SalesSignalStrip`, `SalesTrend`, `SalesDayPulse`, `SalesRhythm`, `TopProductsAggregate` всеки сам копира `(url) => fetch(url).then(r => r.json())` + `{ refreshInterval: 300_000, revalidateOnFocus: false }` — `src/lib/swr.ts` вече има `fetcher` export, но никой не го ползва.

Един extraction (`<MetricChips>` за toggle групата revenue/orders/customers) ще даде най-голямо payoff: повтаря се в три места днес (`SalesPage.tsx:117-137`, `SalesRhythm.tsx:501-526`, `SalesHourHeatmap.tsx:178-200`) и ще се появи на /ads (Spend/Impressions/Clicks), /email (Sends/Opens/Clicks), /traffic (Sessions/Users/Pageviews). Това е същата UX-форма за 6 различни data domains; extraction-ът е чисто структурен и предсказуем. Това е първото нещо което да правим.

---

## Component reuse-readiness matrix

| Component | Current location | Status | Action |
|---|---|---|---|
| `MiniSpark` (HeroStrip inner) | `src/components/sales/SalesHeroStrip.tsx:226` | **extract-ready** | Promote to `src/components/charts/MiniSpark.tsx` — приема `rows`, `kind`, `formatValue`. Никакво sales coupling. |
| `HeroTile` / `SubTile` (HeroStrip inner) | `src/components/sales/SalesHeroStrip.tsx:375 / 422` | **extract-ready** | Promote to `src/components/analytics/KpiHeroTile.tsx`. Generic за всяка hero KPI tile. |
| `SignalTile` + `StripShell` | `src/components/sales/SalesSignalStrip.tsx:99 / 137` | **extract-ready** | Promote `<SignalStrip>` shell + `<SignalTile>` to `src/components/analytics/`. /traffic ще има идентичен secondary-row pattern. |
| `SalesTrend` | `src/components/sales/SalesTrend.tsx` | **sales-coupled** (SWR keys) | Извлечи `<ComparisonAreaChart>` без SWR; sales-обвиващото остава за това място. |
| `SalesDayPulse` | `src/components/sales/SalesDayPulse.tsx` | **sales-coupled** | Извлечи `<DualAxisComboChart>` без SWR; combo bars+lines за всеки domain (ad spend × ROAS, sessions × conv rate). |
| `SalesRhythm` | `src/components/sales/SalesRhythm.tsx` | **sales-coupled** | Pattern is generic ("когато се случва X"), но логиката за weekday folding + occurrence count е сложна. Defer extraction до 2-ри consumer (Email opens-by-hour). |
| `SalesRhythmPanel` | `src/components/sales/SalesRhythmPanel.tsx` | **extract-ready** (pattern) | Pattern „from===to → Pulse, else → Rhythm" е генерично; може да стане `<DateRangeAdaptive single={…} multi={…} />`. Малко тяло (3 реда), wait for 2-ри consumer. |
| `TopProductsAggregate` | `src/components/sales/TopProductsAggregate.tsx` | **extract-ready** | Извлечи `<TopList>` (`items`, `valueOf`, `labelOf`, `shareDenominator`). Generic за top кампании /ads, top страници /traffic, top sends /email. |
| `CountryListPanel` | `src/components/sales/geography/CountryListPanel.tsx` | **extract-ready** | Извлечи `<DimensionListPanel>` — countries / cities / campaigns / channels. Logic identical. |
| `WorldMap` | `src/components/sales/geography/WorldMap.tsx` | **sales-coupled** (data shape) | Map чартиране е sales-specific (CountrySales/CitySales/OfficePoint) но MapLibre setup + marker discipline са preusable. Defer; map-heavy пейджове не са в roadmap-а. |
| `SalesHourHeatmap` | `src/components/sales/SalesHourHeatmap.tsx` | **sales-coupled wrapper** | `HeatmapGrid` отдолу е вече генеричен — wrapper-ът е /sales drill-down only. ОК. |
| `HeatmapGrid` | `src/components/charts/HeatmapGrid.tsx` | **generic ✓** | Вече консумиран от customer cohort retention. Никакъв action. |
| `GlassTooltip` + `buildRechartsTooltip` + `deltaAccent` | `src/components/charts/GlassTooltip.tsx` | **generic ✓** | Никакъв sales leak. ОК. |
| `MobileScrubber` + `MobileScrubberRow` | `src/components/charts/MobileScrubber.tsx` | **generic ✓** | Headless. ОК. |
| `useChartScrubber` | `src/components/charts/useChartScrubber.ts` | **generic ✓** | Без data assumptions. ОК. |
| `Delta` + `calcDeltaPct` + `calcDeltaPp` | `src/components/shared/Delta.tsx` | **generic ✓** | Pure. ОК. |
| `MarketFlag` | `src/components/shared/MarketFlag.tsx` | **generic ✓** | Геополитика, не sales. ОК — но виж note F2 за coupling към `MARKET_LABEL`. |
| `MetricChips` (toggle revenue/orders/customers) | вграден в 3 места | **MISSING — extract NOW** | Виж extraction #1 по-долу. |
| `StoreKpiGrid` / `StoreTrend` / `StoreInfo` / `StoreOrdersTable` / `StoreTopProducts` | `src/components/sales/Store*.tsx` | **sales-coupled** | Store drill-down only. Не извличай — те ще се пренапишат когато имаме „универсален drill-down" pattern. |
| `__compactEur` | `src/components/sales/SalesRhythm.tsx:707` | **dead** | Изтрий — `grep` показва zero external use. |
| `useStoreSelection` | `src/hooks/useStoreSelection.ts` | **extract-ready** (generalise) | Hard-coded `selectedStore`/`stores=` за Shopify. /ads ще иска „Meta accounts"; /email — „Klaviyo lists". Generalise to `useEntitySelection({ paramName, storageKey })`. |
| `useDateRange` | `src/hooks/useDateRange.ts` | **generic ✓** | URL-driven; преподава `from/to/comp*/preset`. ОК. |
| `sales-queries.ts` → `resolveStoreSchemas` | `src/lib/sales-queries.ts:54` | **extract-ready** | Прехвърли в `src/lib/analytics/stores.ts` (или `src/lib/stores.ts`). /traffic, /ads, /email ще искат същата `stores=all|id,id` резолюция. |
| Plain `fetcher` + SWR опции | replicated 7 пъти | **MISSING — `useAnalyticsSWR`** | Виж extraction #2. |
| `fmtEur` / `fmtEurFull` / `fmtInt` / `fmtPct` / `fmtCompactEur` | 12 file-local copies | **MISSING — consolidation in `lib/format.ts`** | Виж extraction #3 и item C1 в DRY. |

---

## Extraction candidates (proposed shapes)

### 1. `<MetricChips>` — repeated toggle group

**Current locations**
- `src/app/(dashboard)/sales/page.tsx:117-137` — `revenue` / `orders` / `customers`
- `src/components/sales/SalesRhythm.tsx:501-526` — `revenue` / `orders` (2-way)
- `src/components/sales/SalesHourHeatmap.tsx:178-200` — `revenue` / `orders`

**Why candidate**
Идентичен пиксел-shape (rounded surface-2 panel, p-0.5, `shadow-xs` on active), идентична aria семантика, само options/labels се различават. /ads, /email, /traffic ще искат същия паттерн с други metric триади.

**Proposed shape**
```ts
// src/components/analytics/MetricChips.tsx
export interface MetricChipOption<T extends string> {
  value: T;
  label: string;
}

export interface MetricChipsProps<T extends string> {
  value: T;
  options: ReadonlyArray<MetricChipOption<T>>;
  onChange: (v: T) => void;
  size?: "sm" | "md"; // sm = SalesRhythm/SalesHourHeatmap (text-[11px])
                     // md = SalesPage header (text-[12px])
  ariaLabel?: string;
}
```
Usage:
```tsx
<MetricChips
  value={metric}
  onChange={setMetric}
  options={[
    { value: "revenue", label: "Приходи" },
    { value: "orders", label: "Поръчки" },
    { value: "customers", label: "Клиенти" },
  ]}
/>
```

**Impact** — премахва ~60 lines × 3 = 180 lines от sales codebase, и pre-emptively обхваща /ads, /email, /traffic (3+ нови consumer-а).

**Risk** — Low. Pure UI. Migration: search-replace в 3 файла.

---

### 2. `useAnalyticsSWR` — SWR boilerplate

**Current locations** (всеки от тези има 1+ SWR call с identical config)
- `src/components/sales/SalesHeroStrip.tsx:497, 503, 511` (3 calls)
- `src/components/sales/SalesSignalStrip.tsx:184, 190, 199` (3 calls)
- `src/components/sales/SalesTrend.tsx:130, 139`
- `src/components/sales/SalesDayPulse.tsx:129, 136`
- `src/components/sales/SalesRhythm.tsx:388, 395`
- `src/components/sales/TopProductsAggregate.tsx:62, 68`
- `src/components/sales/SalesHourHeatmap.tsx:121`
- `src/app/(dashboard)/sales/page.tsx:97, 102, 107` (3 calls)

Всеки duplicates `const fetcher = ...` (where not imported) и същия `{ refreshInterval: 300_000, revalidateOnFocus: false }`. `src/lib/swr.ts` дава `fetcher` но никой не го ползва в /sales.

**Why candidate**
17+ SWR call-сайта; всеки нов екран ще изтегли още 5-10 на пейдж. Без shared hook няма как да добавим cross-cutting concerns (error toast, retry policy, abort на route change, timeout).

**Proposed shape**
```ts
// src/lib/hooks/useAnalyticsSWR.ts
import useSWR, { SWRResponse } from "swr";
import { fetcher } from "@/lib/swr";

export interface AnalyticsSWROptions {
  /** Null disables the fetch (typical SWR conditional fetch). */
  enabled?: boolean;
  /** Override refresh; default 5 minutes. */
  refreshMs?: number;
}

export function useAnalyticsSWR<T>(
  key: string | null,
  opts: AnalyticsSWROptions = {}
): SWRResponse<T> {
  const { enabled = true, refreshMs = 300_000 } = opts;
  return useSWR<T>(enabled ? key : null, fetcher, {
    refreshInterval: refreshMs,
    revalidateOnFocus: false,
  });
}
```
Usage:
```tsx
const { data: kpis, isLoading } = useAnalyticsSWR<KpisResponse>(
  `/api/sales/kpis?${queryString}&${storeParam}`
);
```

**Impact** — заменя ~5 lines × 17 = 85 lines от sales codebase + всеки future page ще е по 1 ред на endpoint. Един централизиран hook за абсорбиране на error handling и telemetry по-късно.

**Risk** — Low. Pure replace. Запази локалния `fetcher = (url) => fetch...` за случаите където не искаме default options (има 0 такива в /sales днес).

---

### 3. Consolidate formatters in `src/lib/format.ts`

**Current locations** (file-local definitions, all subtly different):
| File | Function | Output |
|---|---|---|
| `SalesHeroStrip.tsx:75` | `fmtEur(n, dp=0)` | `"1 234 EUR"` |
| `SalesHeroStrip.tsx:82` | `fmtEurFull(n)` | `"1 234,56 EUR"` |
| `SalesHeroStrip.tsx:89` | `fmtInt(n)` | `"1 234"` |
| `SalesSignalStrip.tsx:57` | `fmtEur(n, dp=0)` | same |
| `SalesSignalStrip.tsx:68` | `fmtPct(n, dp=1)` | `"54.2%"` |
| `SalesTrend.tsx:76` | `fmtEur(n)` | `"1 234 EUR"` (с Math.round) |
| `SalesTrend.tsx:80` | `fmtEurFull(n)` | same |
| `SalesDayPulse.tsx:74` | `fmtEur(n, dp=0)` | same |
| `SalesRhythm.tsx:83` | `fmtEur(n)` | `"1 234 EUR"` |
| `SalesRhythm.tsx:91` | `fmtCompactEur(n)` | `"2.3k"` |
| `SalesHourHeatmap.tsx:67-86` | 4 копия | same shapes |
| `WorldMap.tsx:144` | `fmtEur(n)` / `fmtInt(n)` | same |
| `TopProductsAggregate.tsx:49-55` | `fmtEur` / `fmtInt` | same |
| `CountryListPanel.tsx:33-38` | `fmtEur` / `fmtInt` | same |
| `StoreOrdersTable.tsx:14` | `fmtEur` | same |
| `StoreTopProducts.tsx:12` | `fmtEur` | same |

Сегашният `src/lib/format.ts` дава `fmtMoney`/`fmtMoneyShort` (с `" €"`, не `" EUR"`) — drift с consumer-ите. Затова никой не го импортва.

**Why candidate**
12+ copies, всичките с „EUR" suffix вместо `" €"`. Memory rule: „EUR / никога BGN / лв". Локалните копия се съгласяват с правилото, `lib/format.ts` — не.

**Proposed shape** — обнови `src/lib/format.ts` за да отрази действителния usage:
```ts
// src/lib/format.ts (rewrite)
const BG = "bg-BG";

/** "1 234 EUR" — rounded currency. Hero values, peak badges, table cells. */
export function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString(BG)} EUR`;
}

/** "1 234,56 EUR" — 2-decimal currency. AOV, single-day totals, hover detail. */
export function fmtEurFull(n: number): string {
  return `${n.toLocaleString(BG, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

/** "1 234" — locale-aware integer. */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString(BG);
}

/** "54.2%" — fraction (already × 100) rendered as percent. */
export function fmtPct(n: number, dp = 1): string {
  return `${n.toFixed(dp)}%`;
}

/** "2.3k" / "847" — compact for cramped contexts (heatmap cells, mobile axes). */
export function fmtCompactEur(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/** "20 май" — short Bulgarian date from "YYYY-MM-DD". */
export function fmtBgDate(iso: string): string {
  return new Date(iso).toLocaleDateString(BG, { day: "numeric", month: "short" });
}

/** Като `fmtBgDate`, но с локализиран weekday: "Пон, 20 май". */
export function fmtBgDateWithWeekday(iso: string): string {
  const wd = new Intl.DateTimeFormat(BG, { weekday: "short" })
    .format(new Date(iso))
    .replace(".", "");
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${fmtBgDate(iso)}`;
}

/** "14:00" — slice HH:MM from ISO without parsing (no tz shift). */
export function fmtHourFromIso(iso: string): string {
  return iso.slice(11, 16);
}
```

**Migration**
- Изтрий локалните `fmtEur`/`fmtInt`/`fmtPct`/`fmtCompactEur` от 12+ файла.
- Премахни `fmtMoney`/`fmtMoneyShort` (single `€` сигла) — те не се ползват в /sales и създават precedent за "€" vs "EUR" drift.
- Премахни `formatBgDate` от `src/lib/dates.ts` (дублирано с `fmtBgDate`) — но keep `daysInRange` / `countWeekdaysInRange`.

**Impact** — премахва ~60 lines от sales codebase, унифицира формата „EUR" vs „€" разминаване. Critical pre-cursor преди /traffic / /ads / /email защото те ще импортнат same set.

**Risk** — Low/Medium. Trivial код, но 12 файла touch. Run typecheck + grep „EUR" / „€" преди commit.

---

### 4. `<DimensionListPanel>` — generic ranked list with selection

**Current location**: `src/components/sales/geography/CountryListPanel.tsx`

**Why candidate**
Структурата „card → header (title + Топ X = N% chip) → scroll list (icon + name + metric + delta/share + selection state)" е генерична. /ads ще иска „Топ кампании", /traffic — „Топ канали", /products — „Топ варианти", /email — „Топ flow-ове". CountryListPanel прави именно това.

**Proposed shape**
```ts
// src/components/analytics/DimensionListPanel.tsx
export interface DimensionItem<TKey extends string> {
  key: TKey;
  primary: string;        // главно име ("България", "Покупка чрез Meta")
  secondary?: string;     // подзаглавие ("123 поръчки · 45 клиенти")
  value: number;          // primary metric
  leading?: ReactNode;    // icon / flag / colour dot
}

export interface DimensionListPanelProps<TKey extends string> {
  title: string;
  items: DimensionItem<TKey>[];
  formatValue: (v: number) => string;
  metricLabel: string;    // "Приходи" — for the "Топ: 94% от приходи" chip
  selectedKey?: TKey | null;
  onSelect?: (key: TKey | null) => void;
  isLoading?: boolean;
  emptyText?: string;
}
```
Usage (CountryListPanel rewrite):
```tsx
<DimensionListPanel
  title="Държави"
  metricLabel={metric === "revenue" ? "Приходи" : metric === "orders" ? "Поръчки" : "Клиенти"}
  items={sorted.map(c => ({
    key: c.countryCode,
    primary: countryDisplayName(c.countryCode, c.countryCode),
    secondary: `${fmtInt(c.orders)} поръчки · ${fmtInt(c.customers)} клиенти`,
    value: valueForMetric(c, metric),
    leading: <MarketFlag market={c.countryCode.toLowerCase()} size={16} labelled />,
  }))}
  formatValue={(v) => metric === "revenue" ? fmtEur(v) : fmtInt(v)}
  selectedKey={selectedCountry}
  onSelect={onSelectCountry}
/>
```

**Impact** — Един shared component покрива 4-5 future consumer-а. ~150 lines в CountryListPanel свиват до 30 lines на consumer + един shared file.

**Risk** — Low. Logic-free shell. Запази `CountryListPanel` тънък wrapper за map-link selection.

---

### 5. `<TopList>` — horizontal-bar ranked list

**Current location**: `src/components/sales/TopProductsAggregate.tsx`

**Why candidate**
„Top X + share %" чарт type е canonical в design contract §9 (`docs/analytics-design-contract.md:109`). Sales показва продукти; /ads — кампании; /traffic — страници; /email — flow performance. Една и съща визуализация.

**Proposed shape**
```ts
// src/components/analytics/TopList.tsx
export interface TopListItem {
  key: string;
  title: string;
  value: number;
  /** Optional secondary metric — e.g. "123 бр." за products, "45 conversions" за campaigns */
  meta?: string;
}

export interface TopListProps {
  title: string;
  items: TopListItem[];
  /** Denominator for share %. If omitted, share = item.value / max(value). */
  shareDenominator?: number;
  /** Topline label — "Топ 3 = 40% от приходи". Pass null to suppress. */
  conclusion?: string | null;
  formatValue: (n: number) => string;
  defaultVisible?: number; // default 6
  maxVisible?: number;     // default 10
  isLoading?: boolean;
  emptyText?: string;
}
```

**Impact** — extraction отваря /ads top-campaigns + /traffic top-pages + /email top-sends без копи-paste.

**Risk** — Low. Pure UI.

---

### 6. `<ComparisonAreaChart>` — full-width trend + comparison

**Current location**: `src/components/sales/SalesTrend.tsx` (the chart body, lines 222-377)

**Why candidate**
Каноничният „smooth area за continuous метрик + dashed comparison + peak dot + mobile scrubber" pattern е документиран в design contract §9.1. Всеки analytics екран ще иска по 1: /traffic (sessions), /ads (spend), /email (sends), /products (revenue), /customers (new customers).

**Proposed shape**
```ts
// src/components/analytics/ComparisonAreaChart.tsx
export interface ComparisonAreaRow {
  /** Bucket label — opaque string, used as Recharts dataKey. */
  bucket: string;
  current: number;
  comparison: number | null;
}

export interface ComparisonAreaChartProps {
  rows: ComparisonAreaRow[];
  metricLabel: string;       // "Приходи", "Сесии"
  formatValue: (n: number) => string;
  formatBucket: (b: string) => string;   // "20 май" / "14:00"
  comparisonLabel?: string;  // "Пр. период" (default)
  height?: number;           // default 240
  /** When true, draws peak ReferenceDot and surfaces peak via header.
   *  Generic „peak" works for continuous metrics; for counts caller
   *  should switch to <ComparisonBarChart> instead. */
  showPeak?: boolean;
}
```
Consumer (`SalesTrend` rewrite):
```tsx
<ComparisonAreaChart
  rows={rows.map(r => ({ bucket: r.date, current: r.revenue, comparison: r.compRevenue }))}
  metricLabel="Приходи"
  formatValue={fmtEurFull}
  formatBucket={(b) => hourly ? fmtHourFromIso(b) : fmtBgDate(b)}
  showPeak
/>
```

**Impact** — Премахва ~150 lines от SalesTrend, плюс готов building block за /traffic / /ads / /email.

**Risk** — Medium. ChartContainer.tsx уже си има `AreaLineChart` — има възможна колизия. Препоръчвам да extraction-нем SalesTrend's chart като замяна на (или sibling към) `AreaLineChart`, защото сегашният `AreaLineChart` не носи comparison/peak логиката.

---

### 7. Promote `resolveStoreSchemas` от sales-queries

**Current location**: `src/lib/sales-queries.ts:54`

**Why candidate**
`resolveStoreSchemas(storesParam)` приема `"all"|"id,id,id"` и връща `{storeId, schemaName, name, marketCode}[]`. Това е „кой store-и да queryна" — не е sales-specific. /traffic, /ads, /email ще искат същото (схема-по-store query routing) ако решим да поддържаме multi-store там (вече сме на път да).

**Proposed shape** — преместване, не пренаписване:
```ts
// src/lib/analytics/stores.ts  (нов файл)
export interface StoreSchema { /* unchanged */ }
export async function fetchActiveStores(): Promise<StoreRow[]> { /* moved */ }
export async function resolveStoreSchemas(storesParam: string): Promise<StoreSchema[]> { /* moved */ }
```

Reexport от `sales-queries.ts` за backward compat (sales API routes не трябва да се пренаписват).

**Impact** — Никакъв runtime change. Symbol move + reexport.

**Risk** — Low. 5 imports update.

---

### 8. `useEntitySelection` — generalise `useStoreSelection`

**Current location**: `src/hooks/useStoreSelection.ts`

**Why candidate**
Hard-coded към Shopify stores (`?store=` URL param, `selectedStore` в localStorage). /ads ще иска Meta accounts ('?account=', `selectedAccount`); /email ще иска Klaviyo lists. Same shape, different name.

**Proposed shape**
```ts
// src/hooks/useEntitySelection.ts
export interface UseEntitySelectionOptions {
  /** URL search param name, e.g. "store", "account". */
  paramName: string;
  /** localStorage key, e.g. "selectedStore". */
  storageKey: string;
  /** Optional API query-param name, default = paramName + "s" plural. */
  apiParamName?: string;
}

export function useEntitySelection(opts: UseEntitySelectionOptions): {
  selected: string;
  setSelected: (id: string) => void;
  isAll: boolean;
  apiParam: string; // e.g. "stores=all" / "accounts=123,456"
}
```

`useStoreSelection` → `() => useEntitySelection({ paramName: 'store', storageKey: 'selectedStore', apiParamName: 'stores' })` thin wrapper за backward compat.

**Impact** — Generic foundation за /ads, /email. Малък diff.

**Risk** — Low. Hook generalisation. Existing callers untouched ако wrap-нем.

---

### 9. Generic `findPeak<T>` helper

**Current locations**
- `SalesTrend.tsx:161-168` — peak by revenue
- `SalesDayPulse.tsx:160-165` — peak by revenue
- `SalesRhythm.tsx:453-464` — peak by per-occurrence value (custom denominator)
- `SalesHourHeatmap.tsx:94-105` — peak by metric (typed `findPeak`)
- `SalesHeroStrip.tsx:554-562` — peak day

**Proposed shape**
```ts
// src/lib/analytics/peak.ts
export function findPeak<T>(
  rows: readonly T[],
  valueOf: (row: T) => number
): T | null {
  let best: T | null = null;
  let bestV = -Infinity;
  for (const r of rows) {
    const v = valueOf(r);
    if (v > 0 && v > bestV) { best = r; bestV = v; }
  }
  return best;
}
```

**Impact** — Дребно но повтарящо се. 5 копия → 1 helper.

**Risk** — None.

---

### 10. (Optional) `useDateRangeAdaptive` / `DateRangeAdaptive` wrapper

**Current location**: `src/components/sales/SalesRhythmPanel.tsx`

**Why candidate**
Pattern „from===to → single-day component; else → multi-day component" може да се повтори за /traffic (днешен сесион vs многодневен retention) и /ads (intraday bid pacing vs многодневен ROAS curve).

**Proposed shape**
```tsx
<DateRangeAdaptive
  single={<SalesDayPulse />}
  multi={<SalesRhythm />}
/>
```

**Impact** — Тялото е 3 реда; defer extraction до 2-ри consumer. **Not recommended NOW.**

**Risk** — Premature abstraction.

---

## Dead code / cleanup items

| # | Item | File / line | Action |
|---|---|---|---|
| D1 | `__compactEur` exported but unused externally | `src/components/sales/SalesRhythm.tsx:707` | Delete. Make `fmtCompactEur` not exported. |
| D2 | `qa-api-test.mjs` в repo root + has **plaintext SUPABASE service_role + ENCRYPTION_KEY** | `qa-api-test.mjs:14-16` | **CRITICAL**. Move to `scripts/qa-api-test.mjs` AND replace literals с `process.env.…` reads. Memory note `incident_2026_05_runaway_curl_script.md` именно за това — credential rotation TODO стои отворен. |
| D3 | `qa-audit.js` в repo root | `qa-audit.js` | Move to `scripts/qa-audit.mjs` (and unify shape — `.js` CommonJS sticks out; other scripts са `.mjs`). |
| D4 | `inspect-ro-currency.mjs` — already under `scripts/` | `scripts/inspect-ro-currency.mjs` | No action needed; referenced in repo-root list mistakenly. |
| D5 | `src/lib/format.ts` exports `fmtMoney`/`fmtMoneyShort` with `"€"` suffix; **zero callers** | `src/lib/format.ts:13-20` | Replace by `fmtEur` / `fmtEurFull` per extraction #3. |
| D6 | `src/lib/format.ts` имитира `fmtGA4Date`/`fmtRoas` без callers | `src/lib/format.ts:32-45` | Keep for now if intended for future /traffic, /ads — but document че не са consumed. Skip. |
| D7 | `formatBgDate` от `dates.ts` дублира `fmtBgDate` в `format.ts` | `src/lib/dates.ts:115`, `src/lib/format.ts:48` | After extraction #3, alias `formatBgDate = fmtBgDate` или премахни един. Запази `daysInRange` / `countWeekdaysInRange`. |
| D8 | `useId` import unused if `MiniSpark` extraction lands | `SalesHeroStrip.tsx:4` | Will resolve automatically post-extraction; not actionable now. |
| D9 | Empty line 127 in `SalesDayPulse.tsx` between gradId and the `const { data: cur, …}` block | `SalesDayPulse.tsx:127-128` | Cosmetic; ignore. |
| D10 | `SalesHourHeatmap` doc block повтаря горната заглавка (lines 10-23 vs 25-46) | `SalesHourHeatmap.tsx:10-46` | Merge to a single block. Cosmetic. |
| D11 | `MARKET_LABEL` в `MarketFlag.tsx` поддържа `bg/gr/ro/de/it/uk/sk/hu`, но няма test или registry за добавяне на нов market | `src/components/shared/MarketFlag.tsx:29-38` | Document в memory или add to a registry. **Not urgent.** |
| D12 | `SparkTooltip` локално в `SalesHeroStrip.tsx` повтаря `GlassTooltip` shape | `SalesHeroStrip.tsx:132-198` | Refactor `SparkTooltip` to use `GlassTooltip` + `buildRechartsTooltip` like `SalesTrend` does. ~60 lines reduction. |

---

## DRY violations remaining

### C1. `fmtEur` / `fmtInt` / `fmtPct` (12 copies)
Виж extraction #3 за пълен списък — всеки subtly различен (някои Math.round, някои не; някои `dp`-параметризирани, някои не). **Highest-value DRY hit.**

### C2. SWR boilerplate (17+ call sites)
Виж extraction #2.

### C3. Локален `SparkTooltip` повтаря `GlassTooltip`
- `SalesHeroStrip.tsx:124-198` — `SparkTooltip` interface + render + tone color cascade
- Това е identical vocabulary с `GlassTooltip` (`src/components/charts/GlassTooltip.tsx:38-69`).
- Action: Refactor `SparkTooltip` to consume `GlassTooltip` via `buildRechartsTooltip` + `deltaAccent`, identically към SalesTrend/SalesDayPulse/SalesRhythm. ~70 lines reduction в HeroStrip.

### C4. `WorldMap`'s `TooltipShell` + `useFadingState` повтаря glass vocabulary
- `WorldMap.tsx:915-985` — `TooltipShell` div + `useFadingState` hook
- Същият visual contract като `GlassTooltip` (bg-surface/85 backdrop-blur-xl, etc.), но с допълнителен `useFadingState` за fade-out.
- **Не** е тривиална консолидация — WorldMap има специфичен positioning (absolute + clientX/Y), не Recharts wrap. Препоръчвам **split**:
  - Extract `<GlassPanel>` (the visual skeleton — same classNames) to a primitive.
  - `GlassTooltip` (Recharts variant) and `TooltipShell` (MapLibre variant) become 5-line shells around `GlassPanel`.
  - `useFadingState` стои в `src/hooks/useFadingState.ts` като generic; може да се ползва от future preview cards.

### C5. Peak-finding в 5 места
Виж extraction #9.

### C6. „Total + comparison delta badge" в card header
- `SalesTrend.tsx:206-219` — `totalBadge` JSX
- `SalesDayPulse.tsx:200-215` — `totalBadge` JSX
- Same shape (`▲/▼ N%` + comparison label, with text-accent / text-red / text-text-3 logic).
- Refactor: extract `<DeltaBadge pct={…} comparisonLabel="срв. пр. ден" />`. `Delta` component is too verbose for this header chip — нужен е inline 11px version. ~25 lines × 2.

### C7. Peak badge JSX
- `SalesTrend.tsx:191-203`, `SalesDayPulse.tsx:189-198`, `SalesRhythm.tsx:486-499` всеки рисува `<span class="inline-flex …"><dot/>Пик: …</span>` със същите класове. Variations само в payload.
- Refactor: `<PeakChip label="…" />`. Small win (~30 lines).

### C8. `bg-accent-soft` row treatment for peak weekday и selected country
- `SalesRhythm.tsx:257` и `CountryListPanel.tsx:137` използват `bg-accent-soft` като "this row is highlighted". Не е DRY violation per se, но е добре да го документираме като **shared interaction vocabulary** в design contract (current contract §10 покрива map markers, не list rows).

---

## Proposed file reorganisation

Бъди conservative — renames чупят imports.

**Препоръчвам само 2 малки move-и:**

| Before | After | Reason |
|---|---|---|
| `qa-api-test.mjs` | `scripts/qa-api-test.mjs` | Repo root debris + credentials. Move + strip plaintext keys. |
| `qa-audit.js` | `scripts/qa-audit.mjs` | Same. Convert to ESM to match other scripts. |

**Не препоръчвам:**
- Преместване на `GlassTooltip` / `MobileScrubber` / `useChartScrubber` от `src/components/charts/` към `src/components/analytics/`. Те се ползват в chart context, name-то е честно. Промяна на path-овете ще изиска import update в 5+ файла без functional gain.
- Сплитване на `src/components/sales/geography/` — само 2 файла; flat е по-четим.
- Преименуване на `sales-queries.ts`. Move-ни `resolveStoreSchemas` без преименуване на старите exports.

**Препоръчвам new directories** (нови файлове, не renames):
- `src/components/analytics/` — за бъдещите generic shells (`MetricChips`, `DimensionListPanel`, `TopList`, `KpiHeroTile`, `SignalStrip`, `ComparisonAreaChart`).
- `src/lib/analytics/` — за `peak.ts`, `stores.ts`.
- `src/hooks/useAnalyticsSWR.ts` — top-level.

---

## Cleanup priority list (ordered)

Order = biggest reuse unlock per unit of effort. Each item: size (S=≤1h, M=1-3h, L=≥3h), risk (low/med/high), payoff (number of future consumers benefiting).

| # | Item | Size | Risk | Payoff | Why now |
|---|---|---|---|---|---|
| **1** | **Extraction #3 — consolidate formatters in `lib/format.ts`** | M | low | 5+ pages | Blocks 1, 2 от естетика; всеки нов tile иска fmtEur. Премахва drift „€" vs „EUR". |
| **2** | **Extraction #2 — `useAnalyticsSWR` hook** | S | low | 5+ pages | 17+ replace sites; mechanical. Дава ни място за future error/telemetry. |
| **3** | **Extraction #1 — `<MetricChips>` component** | S | low | 4+ pages | Already 3 копия днес. На /ads/email/traffic ще стане 6+. |
| **4** | **D2 — Move `qa-api-test.mjs` + strip plaintext credentials** | S | **high (security)** | n/a | Service role key & encryption key в plaintext в repo root. Стои с TODO от runaway incident memo. Critical security hygiene. |
| **5** | **Promote `resolveStoreSchemas` to `lib/analytics/stores.ts` (#7)** | S | low | 3 pages (ads, traffic, email) | Preconditional за multi-store на други pages. |
| **6** | **D1 — delete `__compactEur` dead export** | S | low | n/a | Trivial. |
| **7** | **C3 — refactor `SparkTooltip` to use `GlassTooltip`** | S | low | tooling | 70 lines saved + един source of truth за glass vocabulary. |
| **8** | **Extraction #5 — `<TopList>`** | M | low | 4+ pages | Once formatters & SWR са в, this is plug-and-play. /ads top campaigns immediately. |
| **9** | **Extraction #4 — `<DimensionListPanel>`** | M | low | 4+ pages | Sibling към TopList — DimensionListPanel е "items with selection state", TopList — "items with share %". И двата следват analytics design §9. |
| **10** | **Extraction #6 — `<ComparisonAreaChart>`** | L | medium | 5+ pages | Core analytics primitive. Replace `AreaLineChart` or sibling. Trickiest because Recharts is finicky and `useChartScrubber` integration must be tested. Defer до след #1-#5. |
| **11** | **Extraction #8 — `useEntitySelection`** | S | low | 2-3 pages | Schedule when /ads work starts. |
| **12** | **Extraction #9 — `findPeak<T>` helper** | S | low | 5+ pages | Combine with #10 PR for free. |
| **13** | **C4 — split `GlassPanel` primitive + extract `useFadingState`** | M | medium | 2+ pages | Только if /traffic / /products need fading hover popups. Defer. |
| **14** | **C6 — extract `<DeltaBadge>` inline 11px** | S | low | 3-4 pages | Combine into #10 PR. |
| **15** | **C7 — extract `<PeakChip>`** | S | low | 3+ pages | Same. |

**Recommended sprint** (size order, low-risk first): **1 → 2 → 3 → 4 → 5 → 6 → 7**. After those, /traffic kick-off е значително по-малко risky.

---

## Open questions

1. **`fmtMoneyShort` vs `fmtEur` naming.** Текущият `lib/format.ts` ползва `fmtMoney`-prefix; sales code използва `fmtEur`-prefix. Memory правилото е „винаги EUR, никога BGN/лв" — името `fmtEur` е по-explicit. **Q: предпочитаме `fmtEur*` (изтриваме `fmtMoney*`) или унифицираме на `fmtMoney*` (преименуваме всичко sales)?** Препоръка: **`fmtEur*`** — реалното usage го одобрява и memory rule-а е explicit за EUR.

2. **`useAnalyticsSWR` като default или opt-in?** Има ли причина sales компонент да иска по-различен `refreshInterval` от 5 min или `revalidateOnFocus: true`? Не открих такъв в `/sales`. **Q: правим ли defaults задължителни, или приемаме `refreshMs` override?** Препоръка: приеми override, default 300_000.

3. **`<MetricChips>` — accept `value`/`options`/`onChange` или generic `<ChipToggle>`?** Дали този pattern се ползва за non-metric тоggles (filter: All / Mobile / Desktop)? Ако да, `<ChipToggle<T>>` е по-универсално. **Q: има ли scope?** Препоръка: започни с `<MetricChips>`; ако /traffic нуждае device toggle, generalise към `<ChipToggle>` при поява на 2-ри consumer.

4. **`useStoreSelection` localStorage fallback.** Hook чете `localStorage.getItem("selectedStore")` за initial value. /ads / /email ще имат отделни ключове (selectedAccount, selectedList). **Q: остава ли localStorage fallback в generic-ата, или /traffic не би трябвало да си помни selection между сесии?** Препоръка: запази, защото операторите се връщат към същия context. Параметризирай ключа.

5. **Map markers/WorldMap reuse.** Никой друг екран в roadmap-а не иска карта; /traffic може да иска `<CityMap>` за GA4 city dimension, но не е приоритет. **Q: има ли смисъл да удържаме reuse за това сега, или го приемаме като sales-specific и refactor-нем когато 2-ри map поява?** Препоръка: leave as-is; document marker discipline в design contract §10 (вече направено) така че когато 2-ри map дойде, не започваме от нула.

6. **Credentials в `qa-api-test.mjs`.** Memory има open TODO „rotate CRON_SECRET + ANTHROPIC_API_KEY" (`incident_2026_05_runaway_curl_script.md`). **Q: дали като част от този cleanup правим и `SUPABASE_SERVICE_ROLE_KEY` rotation?** Препоръка: **YES**. Move-ни файла, замени с `process.env.*`, и rotate-вай ключа в Supabase dashboard в същия PR.

---

*— End of audit —*
