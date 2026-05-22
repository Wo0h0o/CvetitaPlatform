# Platform Revamp — Bird's-Eye Audit Brief

> Споделен контекст за всички агенти в оркестрацията на 2026-05-22.
> Всеки агент чете този файл преди да започне.

## Голямата цел

Cvetita Command Center трябва да стане **ЦРУ-like intelligence hub** — една платформа,
в която собственикът на бизнеса взима решения на база реални данни, професионално
визуализирани. `/sales` беше изцяло преработена и сега е **еталонът** (gold standard)
за това как изглежда страница на нивото, което искаме.

Останалите страници са „остарели с две поколения" — лимитирани данни, стари view-ове,
не на нивото на дизайн договора. Този одит прави **честна оценка на труда** между
сегашното състояние и целевото, страница по страница.

## Каноничните документи (ЗАДЪЛЖИТЕЛНО четене)

1. `docs/analytics-design-contract.md` — 13 неотменими правила за визуалния език.
   Това е мерилото. Всяка страница се оценява спрямо него.
2. `CLAUDE.md` — 8 dev принципа (Elegance, Mobile First, KISS, Ship>Perfect,
   Real Data Only, AI Sees Everything, Progressive Disclosure, Graceful Degradation).
3. `/sales` (`src/app/(dashboard)/sales/page.tsx` + `sales/store/[storeId]/`) —
   референтната имплементация. **Не я одитирай** — ползвай я като еталон за сравнение.

## Картите в сайдбара (обхват на одита)

| Модул | Път | Файл | Бележка |
|---|---|---|---|
| Основни | `/` | `(dashboard)/page.tsx` | Дашборд / Home |
| Основни | `/inbox` | `(dashboard)/inbox/page.tsx` | Входящи сигнали |
| Основни | `/agents` | `(dashboard)/agents/page.tsx` + `ads-intel/`, `ad-creator/` | AI агенти |
| Отчети | `/sales` | `(dashboard)/sales/` | ✅ ГОТОВО — еталон, не одитирай |
| Отчети | `/products` | `(dashboard)/products/page.tsx` + `[handle]/` | Продукти |
| Отчети | `/customers` | `(dashboard)/customers/page.tsx` + `[phone]/` | Клиенти |
| Отчети | `/traffic` | `(dashboard)/traffic/page.tsx` | Трафик & SEO |
| Отчети | `/email` | `(dashboard)/email/page.tsx` + `flows/[flowId]/` | Имейли (Klaviyo) |
| Отчети | `/ads` | `(dashboard)/ads/page.tsx` + `adsets/`, `campaigns/`, `[market]/` | Реклама (Meta) |
| Отчети | `/google-ads` | `(dashboard)/google-ads/page.tsx` | Google Ads |
| Отчети | `/competitors` | `(dashboard)/competitors/page.tsx` + `[slug]/` | Конкуренти |
| Система | `/settings` | `(dashboard)/settings/page.tsx` + `stores/`, `team/` | Настройки |
| HR | `/hr` | `(dashboard)/hr/page.tsx` + `schedule/`, `leave/`, `team/` | HR модул |
| (извън сайдбар) | `/morning-report` | `(dashboard)/morning-report/page.tsx` | Флагни — защо не е в навигацията |
| (извън сайдбар) | `/analysis` | `(dashboard)/analysis/page.tsx` | Флагни — защо не е в навигацията |

## Скала за оценка (използвай я във всеки репорт)

За **всяка страница** дай:
- **Текущо състояние** (1–5): 5 = на нивото на `/sales`; 1 = напълно остаряло.
- **Целево състояние** — какво трябва да представлява тази страница в ЦРУ хъба.
- **Gap** — конкретно разминаване между сегашно и целево.
- **Обем труд** (S / M / L / XL): S ≤ половин ден, M ≈ 1–2 дни, L ≈ 3–5 дни, XL > седмица.
- **Приоритет** (P0 критично / P1 важно / P2 nice-to-have).

## Правила за репортите

- Пиши на български (cyrillic), технически термини на латиница са ок.
- Конкретика, не общи приказки. Цитирай `файл:ред` където твърдиш нещо.
- Не предлагай „всичко на всяка страница" — уважавай KISS. Една страница = една цел.
- Маркирай ясно кои твърдения са проверени в кода и кои са преценка.
- Репортът ти ще бъде верифициран от одитори — не преувеличавай.
