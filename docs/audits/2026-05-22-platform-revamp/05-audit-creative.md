# Creative / Product Одит — Platform Revamp 2026-05-22

> Одитор: Creative / Продуктов верификатор
> Дата: 2026-05-22
> Роля: Верифицира преценките от Data/API (01), Mobile (02) и Design (03) агентите — не файл:ред, а дизайнерска логика, приоритети и продуктова визия.
> Мерило: `analytics-design-contract.md` (13 правила) + `/sales` еталон + ЦРУ-like intelligence hub визия.

---

## Резюме

Трите агента са извършили **технически солиден одит** — с конкретни цитати, добра покритост и честна маркировка на „проверено" срещу „преценка". Приоритизацията е в по-голяма степен правилна, но се виждат два типа грешки: (а) функционалните „quick wins" са надценени като P0 когато не са „vision-critical"; (б) модулите, които дефинират *характера* на платформата като intelligence hub — `/morning-report`, `/analysis`, `/inbox` — са подценени или изобщо не са разгледани от правилния ъгъл.

Най-важните несъгласия:
- `/ads` дизайн одитът е маркиран P0 заради core usage — **съгласен**, но конкретната обосновка (Score colors blue/orange) е козметика, не P0. Истинското P0 в `/ads` е липсата на delta в KPI strip-а.
- `/google-ads` combo chart мобилен проблем = P0 **от mobile агента** — правилно. Но от продуктов ъгъл, `/google-ads` като цяло е страница с идентитетен проблем: построена на GA4 last-click данни и представена като „Google Ads". Това е по-дълбок проблем от мобилния table.
- `/morning-report` е маркиран P1 от data агента, P2 от design агента — **трябва да е P0** за ЦРУ визията: тя е единствената страница, която обобщава целия бизнес в едно. Без нея intelligence hub-ът е само колекция от отделни таблици.
- `progressive disclosure` принципът (CLAUDE.md §7) е почти невидим в трите репорта — нито един агент не е проверил дали overview→drill-down пътеката е последователна между страниците.

---

## 1. Целеви състояния — потвърдени / оспорени

### Потвърдени целеви състояния

| Страница | Формулировка от агентите | Присъда |
|---|---|---|
| `/` Home | „Командно табло с cross-platform KPIs, badge за inbox, Klaviyo revenue" | Потвърдено — реалистично, конкретно, добра стъпка напред |
| `/inbox` | „Действена inbox с deep-links, deliverability сигнали, GA4 traffic drop alerts" | Потвърдено — inbox е централният нерв на ЦРУ хъба; тази формулировка е правилна |
| `/products` | „Multi-source продуктов анализ: Shopify + GA4 sessions + inventory alerts" | Потвърдено — три независими въпроса в едно, добро scope |
| `/traffic` | „GA4 с geo, hour-weekday rhythm, landing page funnel" | Потвърдено — правилна vision, изпълнима без нови интеграции |
| `/google-ads` | „GA4-based Google Ads докато реалният API чака" | Потвърдено като временно решение — но виж оспорено по-долу |
| `/settings` | „Live integration health check вместо хардкодан статус" | Потвърдено и правилно маркирано P0 |
| `/morning-report` | „Persist + structured KPI output" | Потвърдено — но целта е подценена; виж оспорено |

### Оспорени целеви състояния

**`/agents` — твърде плитка цел.**
Трите агента описват `/agents` като „добавяне на run stats и cost tracker" (data: P2, mobile: P2, design: P2). Това е правилно за краткосрочно, но целевото състояние за ЦРУ хъб изисква различна концепция: `/agents` трябва да е **контролна зала за AI слоя** — дали агентите работят, кога последно са генерирали сигнали, какви решения са взети. В момента е статична nav gallery. „Добавяне на timestamp chip" я прави по-добра gallery, но не й дава нова функция. Предлагам целта да се формулира по-амбициозно: `/agents` = „AI mission control" с live feed от последните agent actions → директно в `/inbox`. Обемът е M, не S.

**`/competitors` — P2 е надценена (виж Конкурент раздел по-надолу).**
Design агентът предлага dot plot + price history sparklines (L обем, P2). Това е правилно за „nice-to-have" ако `/competitors` е secondary page. Но за бизнес с множество пазари и конкурентна среда, конкурентната intel е **стратегически слой** на ЦРУ хъба. Целевото състояние трябва да включва автоматичен дневен scan + price trend (stepped line, §9.3) + alert → inbox. Тогава `/competitors` се трансформира от „ръчен scan списък" в „автоматизиран watchdog". Приоритетът за автоматизацията е P1, не P2.

**`/email` — целта е правилна, но scope-ът е твърде тесен.**
Data агентът предлага deliverability KPIs и revenue time series (P1). Design агентът предлага Open Rate trend и Revenue Attribution Funnel. Двете заедно са добри, но нито един агент не отговаря на въпроса: „Какво е здравословното ниво на Klaviyo база-та?" — т.е. subscriber growth, list quality, suppression rate. Тези метрики превръщат `/email` от „кампания tracker" в „имейл канал здраве". Добавянето им е M effort, но трябва да е в целевата формулировка.

**`/morning-report` — целта е сбъркана в низходяща посока.**
Data агентът: „persist + structured output" (P1). Design агентът: „breadcrumb или sidebar nav" (P2). И двете са верни. Но истинската цел е: **Morning Report е единствената страница в платформата, която отговаря на „Как е бизнесът днес?"** — тя трябва да е P0 за vision, да е в sidebar под „Основни" (между Дашборд и Входящи), и да се зарежда мигновено от Supabase кеш (не генерира нов call). Structured output трябва да включва clickable KPI cards, всяка от които е deep link към съответната страница. Без тази трансформация платформата няма „daily briefing" слой — а именно той е сърцевината на ЦРУ hub-а.

---

## 2. Нови визуализации — присъда

| Визуализация | Агент | Страница | (а) Решава реален въпрос? | (б) §9 vocabulary? | (в) Scope creep? | Присъда | Бележка |
|---|---|---|---|---|---|---|---|
| **Geo heatmap** (GA4 country) | Data | `/traffic` | ДА — 10+ пазари, задължителен | ДА — choropleth е правилен за geographic density | НЕ | **ДА** | 1 GA4 заявка, без нова интеграция; аналог на `/sales` geography |
| **Hour × weekday rhythm heatmap** | Data, Design | `/traffic` | ДА — „кога се случва X?" е точно §9 vocab | ДА — `HeatmapGrid`, вече компонент | НЕ | **ДА** | Внимание: §12 per-occurrence averaging задължително |
| **LTV distribution histogram** | Data | `/customers` | ДА — средната стойност скрива bimodality | ДА — `<Bar>` с pre-bucketed data | НЕ | **ДА** | Стойностно добавяне; AOV/LTV distribution e ключова за segmentation |
| **Price history chart (competitors)** | Data, Design | `/competitors` | ДА — stepped line за state-change | ДА — §9.3 `stepAfter` | НЕ | **ДА** | Данните вече са в DB; само UI wire-up |
| **Placement breakdown card** | Data | `/ads/[market]` | ДА — Feed vs Stories vs Reels е primary creative decision | ДА — horizontal bars + share% (§9 Top X) | НЕ | **ДА** | P0 за creative optimization workflow |
| **Dot plot (competitor pricing)** | Design | `/competitors` | ДА — относителна позиция без смислена нула | ДА — §9 dot plot | Потенциален scope | **ДА, но по-късно** | Изисква данни за common products между Cvetita и конкуренти; сложен data layer |
| **Progress arc (нето vs таргет)** | Design | `/` Home | ДА — pacing е стратегически въпрос | ДА — §9 progress arc | НЕ | **ДА** | Изисква дефиниция на месечен таргет в Settings; ако таргет не е конфигуриран — fallback reference line |
| **Spend + ROAS trend (combo chart)** | Data, Design | `/ads/[market]` | ДА — tempo context пред masonry | ДА — §9.4 combo: spend bars + ROAS line (causally linked) | НЕ | **ДА** | Данните вече са в Supabase `meta_insights_daily`; 0 нови API calls |
| **Age/gender breakdown** | Data | `/ads/[market]` | Условно — полезно за audience decisions | ДА — donut или horizontal bars | Граничен | **ДА, но по-късно** | Добро, но placement breakdown е по-директно actionable; добавяй след него |
| **Revenue Attribution Funnel (Klaviyo)** | Design | `/email` | ДА — flow→покупка е ключова funnel | ДА — FunnelChart §9 | НЕ | **ДА** | Klaviyo API поддържа conversion data per flow; виза нова заявка |
| **Open Rate / Click Rate trend line** | Design | `/email` | ДА — тренд е по-информативен от snapshot | ДА — smooth area за continuous metric | НЕ | **ДА** | Изисква `group_by: ["send_date"]` в Klaviyo API |
| **Inbox signal trend sparkline** | Design | `/inbox` | Условно — aggregate брой сигнали по дни | ДА — bars за counts §9.2 | Леко | **ДА, но по-късно** | Вторичен. Inbox трябва да се фокусира върху deep-links и routing, не върху своята аналитика |
| **Overtime trend chart** | Data | `/hr` | НЕ за ЦРУ хъб — HR е вътрешен util | ДА технически | ДА за vision | **НЕ** | HR модулът не е в intelligence hub слоя; scope creep спрямо ЦРУ визията |
| **`/analysis` chat session persistence** | Data | `/analysis` | ДА — UX критично | N/A (не е chart) | НЕ | **ДА** | Не е визуализация, но е важна feature; включена за completeness |
| **Morning Report KPI strip** | Data | `/morning-report` | ДА — structured output е задължителен | N/A (KPI cards, не chart) | НЕ | **ДА** | Трябва да е clickable deep-links към страниците |

**Обобщение по категории:**
- **ДА (имплементирай):** geo heatmap, hour×weekday rhythm, LTV histogram, price history, placement breakdown, spend+ROAS trend, revenue attribution funnel, open rate trend, morning report KPI strip, progress arc (с таргет fallback)
- **ДА, но по-късно:** dot plot конкуренти (нужен data layer), age/gender breakdown, inbox signal sparkline
- **НЕ:** overtime trend chart за HR (извън ЦРУ scope)

---

## 3. Корекции на приоритети

### Потвърждавам P0

| Елемент | Агент | Обосновка за P0 |
|---|---|---|
| `/settings` хардкоднат статус | Data P0 | Нарушение Real Data Only; всяко счупено integration е невидимо. Бързо S fix с висок диагностичен value |
| `/google-ads` combo chart мобилен | Mobile P0 | §9.4/§9.6 нарушение + 900px table — страницата е буквално неизползваема на mobile |
| `/google-ads` campaign table min-w-900px | Mobile P0 | 9-колонна таблица зад scroll на 375px; primary content е недостъпен |

### Оспорвам — трябва промяна

**`/products` = P0 (от data агента) → предлагам P1.**
Data агентът го маркира P0 заради липса на GA4 + multi-store. Технически правилно, но `/products` в момента **работи** — показва реални данни от BG store, дава revenue/orders/AOV. Липсата на GA4 sessions per product е важна, но не спира операционното използване. P0 означава „сайтът е счупен или взима лоши решения заради тази страница" — не е точно тук. Препоръчвам P1 с висок приоритет в рамките на P1.

**`/ads` дизайн = P0 (от design агента) → потвърждавам P0, но с различна обосновка.**
Design агентът дава P0 заради „core usage" и Score colors (blue/orange). Score colors са реален договор нарушение, но козметичен fix (S effort). Истинският P0 проблем в `/ads` е **липсата на delta/comparison в KPI strip-а** (§4 нарушение за core metrics: spend, ROAS, CPA без тренд = операторът не може да каже дали Понеделник е добър или лош ден). Плюс липсата на trend chart (0 нови API calls — данните са в Supabase). Тези две неща заедно са P0 за usage quality.

**`/morning-report` = P1 (data) + P2 (design) → предлагам P0 за vision.**
Обосновка: платформата е „intelligence hub" — операторът трябва да може да влезе всяка сутрин, да прочете briefing за 2 минути и да знае какво да направи. В момента `/morning-report` не е в sidebar-а, генерира нов AI call при всяко зареждане, и показва само markdown без структурирани данни. Три различни P1/P2 fixes, всяка тривиална сама по себе си, но заедно = трансформация на ключова страница. Правилното third е да се обедини в P0 execution sprint: sidebar nav + Supabase persist + structured KPI output + deep links. Обемът е M; impact-ът е съществен за daily-use pattern.

**`/analysis` = P1 (data) → потвърждавам P1, но изисква sidebar.**
Без sidebar navigation `/analysis` е невидима за оператора. Това трябва да е условие №1 преди chat persistence или нови tools. Chat session persistence е P1 по-важна от нови tools.

**`/inbox` deep-link = P1 (data) → потвърждавам, уточнявам като P0 за UX.**
Inbox без deep-links е broken UX — операторът вижда „CPM е високо" но не може да кликне директно към проблемния ad. `target_id` е в schema, `focus` param pattern работи в `/ads`. Wire-up-ът е S effort. Комбинацията „сигнал без навигация" прави inbox по-малко полезен от email notification. Това е P0 за UX качеството на hub-а.

### Надценени P0 елементи

**`/products` multi-store expand (data P0) → P1.**
Важно, но BG store работи. Multi-store expand е P1 architectural work, не P0 fix.

**Design contract нарушения (§3 icons, §2 font sizes) навсякъде → приоритетът е верен (P1-P2), но изпълнението трябва да е системно, не страница по страница.**
Вместо 6 отделни P1/P2 ticket-а за „премахни icons от MiniKpi", по-ефективно е 1 shared component sprint: обнови `MiniKpi`, `KpiWithChange`, `KpiTile` с `analytics` prop, след което всяка страница се поправя при reuse. S effort, cross-platform fix.

---

## 4. Какво липсва във визията

Трите агента са направили страница-по-страница одит, но НЕ са разгледали следното:

### 4.1 Cross-page navigation и информационна йерархия

**Никой агент не е разгледал как страниците се свързват помежду си.** В ЦРУ хъб, навигацията е workflow: Inbox сигнал → `/ads/bg?focus=<id>` → Campaign drill-down → Google Ads confirmation. Тази верига не е описана нито като existing path, нито като gap. Платформата в момента е 12 изолирани страни с обща sidebar. Липсва:
- Breadcrumb навигация от `/products/[handle]` обратно към `/products`
- Cross-source linking: `/traffic` top page → `/products/[handle]`
- Inbox → всяка страница с focus parameter
- Agents page → `/morning-report` и `/analysis` с ясни CTA

### 4.2 AI overlays дисциплина

Memory файл `feedback_analytics_no_ai_overlays.md` казва: „никакви insights barove на /traffic; AI живее в агентите." Нито един агент не е проверил дали тази дисциплина е последователно спазена. Design агентът предлага „performance badge" за `/agents` — добре. Но data агентът предлага GA4 traffic drop сигнал → `agent_briefs` (правилно). Трябва explicit rule в audit-а: AI insights = само в `/inbox` и `/morning-report`, никога inline в analytics страниците.

### 4.3 Empty / loading / error state консистентност

Design агентът набляга на нехомогенни error states (т. 10 в топ дизайн проблеми). Но никой агент не е проверил **loading skeleton quality** систематично. `/sales` еталонът има `<Skeleton>` за всеки компонент. Другите страници — смесено. При бавни connections операторът вижда различни loading experiences на различни страницис — некохерентно. Нужна е: единна skeleton strategy (може да е `useAnalyticsSWR` pattern от `/sales`, разширен за другите страницис).

### 4.4 URL state consistency

`useDateRange` hook пази датите в URL-а — добре. Но `/email` и `/customers` датите са in-component state (не URL-базиран по дефолт — трябва проверка). Операторът не може да сподели/bookmark конкретен view. За ЦРУ hub, state-ът трябва да е в URL-а за всички filter комбинации (дата + store + market). Нито един агент не е разгледал URL state consistency cross-platform.

### 4.5 Onboarding и first-run experience

Нова инсталация: какво вижда операторът при `/settings` с нулеви интеграции? Нито един агент не е разгледал first-run flow. Ако Settings показва хардкоднат „connected" за всичко (изрично критикувано в одита), нов потребител ще е объркан. Lipsa на onboarding checklist или setup wizard е gap за product vision, не за техническия одит.

### 4.6 Notifications / real-time awareness

Inbox polling е 60 секунди. Но няма браузърна нотификация, badge на browser tab, нито toast при нов P0 сигнал. За intelligence hub в реален бизнес, операторът е рядко на екрана — трябва push/badge. Не е нито малко, нито голямо — но е напълно пропуснато от всички агенти.

### 4.7 `/analysis` идентитет — пропуснат продуктов въпрос

Design агентът критикува `purple-500` (правилно). Но по-дълбокият въпрос е: `/analysis` е chat, т.е. **различен interaction paradigm** от analytics pages. Платформата не е взела решение дали chat-ът трябва да е визуално различим от analytics (и ако да — с кой token). Промяна на purple → accent означава chat messages изглеждат като позитивни trending данни. Предлагам: chat surface получава `--ai` CSS token (дефиниран в globals.css), отделен от `--accent`. Тогава правилото е спазено, а chat-ът запазва identity.

---

## 5. Кои 3-4 страници са истинският гръбнак на ЦРУ хъба

ЦРУ hub функционира само ако операторът може да: (1) разбере как е бизнесът **сега**, (2) види **какво се е объркало**, (3) разбере **защо** и (4) **предприеме действие**. Тези четири стъпки се mapват точно на:

**1. `/morning-report` — daily briefing.** Отговаря на „как е бизнесът днес" в 2 минути. В момента е скрита страница с markdown output. Трансформирана с persist + KPI strip + sidebar nav — тя е входната точка на целия hub. Без нея операторът трябва да обходи 5 страницис за да добие картина.

**2. `/inbox` — сигнална система.** Отговаря на „какво се е объркало". Deep-links, severity tiers, auto-generated сигнали от всички интеграции. В момента работи, но е изолирана — сигналите нямат навигация към действие. С deep-links и Klaviyo/GA4 сигнали, inbox-ът се превръща в оперативен dashboard.

**3. `/sales` — финансов backbone.** Вече е еталонът. Трябва само да остане качествен reference и да получи drill-down consistency с останалите страницис.

**4. `/ads` + `/google-ads` — разходен контрол.** Рекламният бюджет е най-контролируемата операционна променлива. `/ads` с trend chart + placement breakdown + delta KPIs + `/google-ads` с search terms — заедно те отговарят на „защо ROAS е паднал" и „какво да направя". Без тях операторът взима рекламни решения на база gut feeling, не данни.

**Бонус гръбнак:** `/analysis` (команден чат) — ако е в sidebar-а, persist-ва session-ите и има пълни tools, тя e универсалният „разследващ инструмент" за всеки въпрос, на който нито една page не отговаря директно. Потенциал за primary value prop на цялата платформа.

**Извод:** `/traffic`, `/products`, `/customers`, `/email` са важни отчетни страниции, но не са гръбнак на intelligence hub-а. Те могат да се развиват итеративно. Гръбнакът изисква `/morning-report` + `/inbox` + `/ads` да бъдат на нивото на `/sales` преди всичко друго.

---

## Финална матрица: реален приоритет (след корекции)

| Страница | Агент P | Creative P | Разлика | Обосновка |
|---|---|---|---|---|
| `/settings` live health | P0 | P0 | = | Нарушение Real Data Only; S fix |
| `/morning-report` (persist+sidebar+KPI strip) | P1+P2 | **P0** | ↑ | Гръбнак на daily briefing; M effort |
| `/inbox` deep-links | P1 | **P0** | ↑ | Broken UX без navitation; S fix; кратко ROI |
| `/google-ads` mobile (combo+table) | P0 | P0 | = | §9.4/§9.6 + 900px нарушение |
| `/ads` KPI delta + trend chart | P0 | P0 | = | Core usage; delta e задължителен за comparison |
| `/analysis` sidebar + session persist | P1 | P1 | = | Критично за discovery; S+M fix |
| `/products` GA4 + design contract | P0 | **P1** | ↓ | Работи с BG store; важно, не блокиращо |
| `/traffic` geo + rhythm | P1 | P1 | = | Правилен приоритет |
| `/email` deliverability + delta | P1 | P1 | = | Правилен приоритет |
| MiniKpi §3 системен fix (shared component) | P1-P2 | P1 | ~ | По-ефективно като 1 component sprint |
| `/competitors` auto-scan + price trend | P2 | **P1** | ↑ | Автоматизацията е стратегически слой |
| `/agents` live status | P2 | P2 | = | Правилен; не е гръбнак |
| `/hr` overtime trend | P2 | **не** | ↓ | Извън ЦРУ scope |

---

*Одит завършен: 2026-05-22*
*Следваща стъпка: Priority matrix (04-report-priorities.md) трябва да абсорбира корекциите от тази секция, особено повишаването на `/morning-report` и `/inbox` deep-links до P0.*
