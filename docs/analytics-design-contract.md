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
- [ ] `tabular-nums` на всички числа в таблици.
- [ ] Mobile тест: 375px viewport, grid колапсва правилно.
- [ ] Skeleton, error, empty — и трите състояния са дизайнирани.

---

## Self-iteration

Когато се появи нов pattern или anti-pattern по време на разработка, **обнови този файл веднага**. Не чакай да те питат. Същият принцип като `feedback_platform_ux.md` — живо doc.
