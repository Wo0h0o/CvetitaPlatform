# Sales Audit — Consolidated Action Plan

> Chief Auditor consolidation на 4-те специализирани одита от 2026-05-21 (Data / Mobile / Design / Reuse).
> Read-only verification — всеки finding е сверен срещу actual code в `src/`, `supabase/migrations/`, `qa-api-test.mjs`.
> Audience: cherbal.ppc@gmail.com.

## TL;DR

Преди да копираш каквото и да е от `/sales` към `/traffic`, `/products`, `/ads`, `/email` или `/customers`, направи 4 неща в този ред: **(1)** ротирай `SUPABASE_SERVICE_ROLE_KEY` + `ENCRYPTION_KEY` (са в plaintext в `qa-api-test.mjs:14-16`, repo root — security incident-ът от 2026-05 още не е чист); **(2)** напиши migration 044, която пренаписва `period_unique_customers` със същия v3 buyer-identity cascade като `read_store_sales_by_country` — иначе hero strip-ът показва **различен** брой клиенти от География-та за foreign stores; **(3)** изтегли 3 shared primitives — `jsonFetcher` (с `r.ok` check), `useAnalyticsSWR`, и канонични formatters в `lib/format.ts` — защото без тях copy-paste се multiplied 5-6×; **(4)** оправи `cooperativeGestures: false` на WorldMap (краде vertical page scroll на mobile). Всичко останало (chart-touch persistence, glass tooltip unification, asymmetric hero codification) може да чака — не блокира extension.

## Critical pre-extension blockers

Тези **трябва** да паднат преди какъвто и да е друг page work, защото blast-radius-ът им multiplied по всеки нов екран:

1. **Rotate plaintext secrets в `qa-api-test.mjs`** (Reuse D2). Това не е just hygiene — service-role key + encryption key стои в repo root от runaway incident-а. Memory вече има open TODO. Преди *каквото и да е* друго.
2. **Migration 044 — `period_unique_customers` v3 cascade** (Data #2). Hero strip-ът и География-та съобщават различни числа за GR/IT/RO/DE/UK/HU/SK. Без този fix, новата `/customers` page ще наследи bug-а директно.
3. **Извлечи `jsonFetcher` + `useAnalyticsSWR` + canonical `lib/format.ts`** (Data #4 ⨯ Reuse C1, C2, #2, #3). `src/lib/swr.ts` вече има `fetcher` export — но никой в /sales не го ползва. 44+ файла в repo имат собствен `const fetcher = ...`; 17 от тях са в /sales. На `/ads` ще станат 25.
4. **Map `cooperativeGestures: true` под `md`** (Mobile F9). Single-line fix. Без него `/sales` краде scroll на phone — *всеки* бъдещ map ще има същия гочa.

## Verified findings — priority order

### 1. `qa-api-test.mjs` съдържа plaintext service-role key и encryption key в repo root

- **From**: reuse (D2)
- **Severity**: critical
- **Size**: S
- **Risk**: high (security)
- **Verified**: ✅ confirmed. `qa-api-test.mjs:14-16` съдържа `SUPABASE_SERVICE_ROLE_KEY` JWT с exp 2091, и 64-char hex `ENCRYPTION_KEY`. Visible в repo. Memory `incident_2026_05_runaway_curl_script.md` flag-ва тази rotation като отворена.
- **Action**: (a) move-ни файла в `scripts/qa-api-test.mjs`; (b) замени literals с `process.env.SUPABASE_SERVICE_ROLE_KEY` / `process.env.ENCRYPTION_KEY` (чети от `.env.local` чрез `dotenv`); (c) rotate-вай **и двата** ключа в Supabase dashboard в същия PR; (d) update Vercel env vars; (e) grep за други plaintext occurrence-и — memory споменава 5+ файла.
- **Blocks / unblocks**: Не блокира друга работа, но всичко друго трябва да чака докато ключовете не са ротирани.
- **Payoff**: Сleanva 2026-05 runaway-incident TODO; премахва foot-gun за nова team-mate който clone-ва repo.

### 2. `period_unique_customers` RPC използва само email — undercount-ва foreign stores

- **From**: data (#2)
- **Severity**: critical
- **Size**: M (SQL migration + manual verification на hero strip за 7 stores)
- **Risk**: medium (production data — числата ще skoknat очаквано)
- **Verified**: ✅ confirmed. `supabase/migrations/029_sofia_tz_bucketing.sql:204-217` прави `COUNT(DISTINCT email)` без cascade. Migration 039 fix-ва това за geography RPC-тата но не докосва `period_unique_customers`. Memory `feedback_foreign_store_pii_redacted_payloads.md` потвърждава, че foreign stores нямат email в payload-а.
- **Action**: Migration 044 — пренапиши `period_unique_customers` използвайки СЪЩИЯ buyer-identity cascade като `read_store_sales_by_country` v3 (migration 039:95-103): `COALESCE(LOWER(NULLIF(TRIM(...email cascade...), '')), 'cust:' || raw_payload->'customer'->>'id')`. Verify ръчно за всеки foreign store на 30d window — очаквай **jump** в "Уникални клиенти".
- **Blocks / unblocks**: Блокира любой `/customers` build (по същия RPC). Не блокира shared-primitive extraction.
- **Payoff**: KPI "Уникални клиенти" става правдив за GR/IT/RO/DE/UK/HU/SK; "Стойност / клиент" в Signal Strip спира да е distorted; consistent semantic между hero и География.

### 3. SWR comparison cache miss — granularity suffix-ът е append-нат на different позиции

- **From**: data (#1)
- **Severity**: important
- **Size**: M (extract `buildAnalyticsUrl` helper, migrate 17+ call sites)
- **Risk**: low
- **Verified**: ✅ confirmed. `SalesTrend.tsx:138-141`: `compQs = ?...&from=X&to=Y` → URL becomes `?...&stores=Z&granularity=hour`. `SalesHeroStrip.tsx:510-513`: `compQs = ?...&from=X&to=Y&granularity=hour` → URL becomes `?...&granularity=hour&stores=Z`. Comment-ите твърдят "keys match" — невярно за hourly mode.
- **Action**: Извлечи `src/lib/analytics/urls.ts` с `buildAnalyticsUrl({ path, params })`, alpha-sort на param keys. Migrate-ни 17 SWR call sites в /sales към него. (Може да се направи заедно с item 4 `useAnalyticsSWR` extraction.)
- **Blocks / unblocks**: Блокира `useAnalyticsSWR` ако искаш string-identical keys гарантирани; иначе не. Unblocked by нищо.
- **Payoff**: Двойни comparison fetch-ове на "Днес"/"Вчера" hourly mode изчезват. На `/traffic` GA4-quota cost-ът се халява.

### 4. Дублиран `fetcher` × 17 в /sales, swallow всички network errors

- **From**: data (#4, #8) ⨯ reuse (C2, extraction #2)
- **Severity**: critical (Principle 5 violation — "Real Data Only")
- **Size**: S (utility + hook) + S per migration site
- **Risk**: low
- **Verified**: ✅ confirmed. `src/lib/swr.ts:12` вече exports `fetcher` за този exact use case — но 44 файла в repo имат собствен copy (от които 17 в /sales). Всеки swallow-ва `!res.ok`. `SalesTrend.tsx` няма error fallback (`SalesTrend.tsx:180-189` чете `isLoading` only).
- **Action**: (a) Извлечи `src/lib/swr/json-fetcher.ts` с `ApiError` class + `r.ok` check + `body.error` check. (b) Извлечи `src/lib/hooks/useAnalyticsSWR.ts` (виж reuse extraction #2). (c) Извлечи `<ErrorState />` shared component. (d) Replace 17 sales call sites + 11 от тях добавят `if (error) return <ErrorState />`.
- **Blocks / unblocks**: Single largest unblocker — touches 17 files в /sales but pre-empts ~25 на следваща page. Премахва нужда от item 3-style URL helper ако keys се build-ват consistent.
- **Payoff**: Real errors finally surface (currently 11 от 13 component-а silent на 500). Add error/timeout/abort cross-cutting once.

### 5. WorldMap `cooperativeGestures: false` краде vertical page scroll

- **From**: mobile (F9)
- **Severity**: critical (Mobile First — Principle 2)
- **Size**: S (one-line fix + matchMedia guard)
- **Risk**: low
- **Verified**: ✅ confirmed. `WorldMap.tsx:405` — `cooperativeGestures: false`. Phone scrolling през 400px map → пано-ва картата, скриране на /sales.
- **Action**: `cooperativeGestures: window.matchMedia("(max-width: 767px)").matches` или просто `true` под `md`. MapLibre auto-overlay-ва "Use two fingers" message.
- **Blocks / unblocks**: Стандартна practice за всеки бъдещ map.
- **Payoff**: Phone scroll на /sales най-после работи безотказно през map area.

### 6. Hero strip vs Signal strip vs Trend — 12 формата на `fmtEur` дрифт-ват

- **From**: reuse (C1, extraction #3) ⨯ design (drift fix)
- **Severity**: important (blocks consistency-across-pages)
- **Size**: M (rewrite `lib/format.ts` + 12 файла migration)
- **Risk**: low
- **Verified**: ✅ confirmed. `src/lib/format.ts` exports `fmtMoney` / `fmtMoneyShort` с " €" suffix; 12 file-local copies в /sales всички използват " EUR" suffix. Memory rule explicit: "EUR / никога BGN / лв". `lib/format.ts` е unused в /sales precisely защото suffix mismatch.
- **Action**: Rewrite `src/lib/format.ts` за да match-ва actual /sales usage — `fmtEur` / `fmtEurFull` / `fmtInt` / `fmtPct` / `fmtCompactEur` / `fmtBgDate` / `fmtBgDateWithWeekday` / `fmtHourFromIso`. Delete `fmtMoney*`. Delete 12 local copies. Add `formatBgDate` alias в `dates.ts` if легаси usage спира някъде извън /sales.
- **Blocks / unblocks**: Блокира /traffic, /ads, /email tile development. Unblocked by нищо.
- **Payoff**: Един "EUR vs €" rule. ~60 lines изтрити от /sales. /ads дrev 1 ще started clean.

### 7. §8 — "срв." vs "спрямо" mismatch

- **From**: design (Inconsistencies #1, §8 FAIL) ⨯ reuse (C6)
- **Severity**: important (contract violation на най-visible vocabulary)
- **Size**: S
- **Risk**: low
- **Verified**: ✅ confirmed. `SalesTrend.tsx:217` пише `срв. пр. период`; `SalesDayPulse.tsx:213` пише `срв. пр. ден`; `Delta.tsx:23` (canonical) пише `спрямо пр. период`. Two languages за същото нещо на същия екран.
- **Action**: Извлечи `<DeltaInline pct={…} label="спрямо пр. период" />` 11px variant в `Delta.tsx`, replace 3 custom badges (SalesTrend / SalesDayPulse / SalesRhythm WeekdayRow). Standardize на "спрямо" — е по-natural BG (memory `feedback_natural_bg_copy.md`).
- **Blocks / unblocks**: Не блокира друго work. Може да се направи в same PR като item 6.
- **Payoff**: Един phrase за comparison в всичкi-те /sales + готов primitive за /traffic /ads.

### 8. `useChartScrubber` — pointer-capture без gesture intent detection

- **From**: mobile (F2)
- **Severity**: important (UX flash на vertical scroll)
- **Size**: M (intent threshold + hysteresis test)
- **Risk**: medium (regression risk на existing chart-touch behavior)
- **Verified**: ✅ confirmed. `useChartScrubber.ts:78-90` — `onPointerDown` веднага извиква `setActiveIdx(indexFromEvent(e))`. Tooltip flash-ва за 1 frame при vertical scroll старт.
- **Action**: Не write-вай `activeIdx` в `onPointerDown`. Add ref-based gesture-intent gate: запази `pointerDownX` + `pointerDownY`; в `onPointerMove`, write-ни `activeIdx` само ако `|dx| > 6 && |dx| > |dy|`. Track-ва Apple Maps / Stripe Dashboard pattern.
- **Blocks / unblocks**: Не блокира друго. Direct hook edit.
- **Payoff**: Чист vertical scroll през chart-а на phone. (`SalesTrend`, `SalesDayPulse`, `SalesRhythm` всички печелят защото share hook-а.)

### 9. Tap targets под 44px на metric chips и DateRangePicker chips

- **From**: mobile (F4)
- **Severity**: important (CLAUDE.md Principle 2 violation)
- **Size**: S
- **Risk**: low
- **Verified**: ✅ confirmed. `SalesRhythm.tsx:506,517` — `px-2 py-0.5` ≈ 18px. `DateRangePicker.tsx:57` — `px-2 py-1 sm:px-3 sm:py-1.5` — mobile e реално ~22-24px. Под CLAUDE.md "44px min".
- **Action**: (a) Add Tailwind preset utility `.tap-44` (или `min-h-[44px]` на всеки `<button>` под `md`). (b) Replace SalesRhythm toggle, DateRangePicker chips, metric chip, "Виж всички" link, SubTile нумерация. Алтернативно — invisible padded hit area via `::before { inset: -10px }` за visual-compact компоненти.
- **Blocks / unblocks**: Pairs with item 11 (`<MetricChips>` extraction).
- **Payoff**: Phone usability на низко-светло environment, principle compliance.

### 10. Ритъм averaging today-inclusion bias

- **From**: data (#3)
- **Severity**: important (numbers are subtly wrong при mid-day гледане)
- **Size**: S (add `excludeToday` opt to `countWeekdaysInRange`)
- **Risk**: low
- **Verified**: ✅ confirmed. `dates.ts:158-167` итерира всички inclusive дни. Mid-day Четвъртък гледане → divisor=4 Thursdays, числителят has only morning data → "Typical Thursday" разводнен с ~50%.
- **Action**: Add `opts.excludeToday` flag на `countWeekdaysInRange` и `daysInRange`. На /sales (analytical view) — default exclude. На `/traffic` (live view) — keep + surface badge "Включва текущ ден (частично)". Operator decides — виж open questions.
- **Blocks / unblocks**: Не блокира.
- **Payoff**: "Typical Thursday" става честно число.

### 11. `<MetricChips>` повторен × 3 в /sales, ще стане × 6 на /ads/email/traffic

- **From**: reuse (extraction #1)
- **Severity**: important (multiplier)
- **Size**: S
- **Risk**: low
- **Verified**: ✅ confirmed. `sales/page.tsx:117-137`, `SalesRhythm.tsx:501-526`, `SalesHourHeatmap.tsx:178-200` — identical shape (rounded surface-2 panel, p-0.5, shadow-xs on active).
- **Action**: Извлечи `src/components/analytics/MetricChips.tsx` с generic `<T extends string>` value/options/onChange + `size?: "sm" | "md"`. Migrate 3 sites.
- **Blocks / unblocks**: Pairs naturally with item 9 (tap-target fix).
- **Payoff**: -180 lines /sales code; готов building block за /ads (Spend/Impressions/Clicks), /email (Sends/Opens/Clicks), /traffic.

### 12. §11 Glass tooltip vocabulary — duplicate между GlassTooltip и WorldMap.TooltipShell

- **From**: design (§11 amendment) ⨯ reuse (C3, C4)
- **Severity**: important (design contract gap; visual drift между chart popup и map popup)
- **Size**: M (extract `<GlassPanel>` primitive + 2 shells)
- **Risk**: medium (WorldMap MapLibre positioning е sticky)
- **Verified**: ✅ confirmed. `GlassTooltip.tsx` живee в `src/components/charts/`; `WorldMap.tsx:929-985` повтаря same vocabulary inline (`TooltipShell` + 5 *TooltipBody*). `SalesHeroStrip.tsx:124-198` локален `SparkTooltip` повтаря trety път.
- **Action**: Split в 3 файла — `src/components/charts/GlassPanel.tsx` (visual skeleton, just className-и), `GlassTooltip.tsx` (Recharts wrapper, 5-line shell), `WorldMap.tsx` impоrtва `GlassPanel` for TooltipShell. Refactor `SparkTooltip` в `SalesHeroStrip` to consume `GlassTooltip`. Codify §11 в design contract.
- **Blocks / unblocks**: Не блокира /traffic. Но е highest-leverage codification — следваща pop-up на всяка page ще импровизира четвърта vocabulary без този primitive.
- **Payoff**: ~130 lines премахнати. Един source of truth за glass aesthetic. /products page-а може да build-ва hover popup-и без impроviation.

### 13. WorldMap §10.3 — single-size markers, contradicts contract

- **From**: design (§10.3 FAIL, inconsistencies #4)
- **Severity**: nice-to-have (defended in code, contract revision option е по-clean от code revert)
- **Size**: S (contract amendment)
- **Risk**: low
- **Verified**: ✅ confirmed. `WorldMap.tsx:590-592` — `circle-radius: 5` за всички unclustered points. Defended at lines 580-583 с argument "cluster sizing tells magnitude". Cluster layer DOES използва interpolated radius (also forbidden by §10.3).
- **Action**: Revise design contract §10.3 — "if clusters carry magnitude, individual markers may be uniform; cluster radius is allowed to interpolate when it aggregates multiple T-tiers". Не променяй code. Codify в amendment list.
- **Blocks / unblocks**: Operator decision (виж open questions).
- **Payoff**: Contract отчита реалност; следваща map (ако някога има) пое pattern-а direct.

### 14. `useStoreSelection` localStorage в useMemo → hydration drift + double fetch

- **From**: data (#5)
- **Severity**: important (бavi мрежa на първа навигация; multiplied across pages)
- **Size**: S
- **Risk**: medium (UX trade-off — губиш "remember my store" освен ако се parameterise по generalize)
- **Verified**: ✅ confirmed. `useStoreSelection.ts:11-21` чете localStorage в useMemo. SSR returns "all"; първи client render returns localStorage value; double-fetch.
- **Action**: Option A (operator-recommend) — `useState` от "all", `useEffect` устанoвява от localStorage on mount. Single source of truth. Премахва hydration warning. Plus rename за reuse extraction #8 — `useEntitySelection({ paramName, storageKey })` — generic за `/ads` (Meta accounts), `/email` (Klaviyo lists).
- **Blocks / unblocks**: Не блокира.
- **Payoff**: Един extra render on mount вместо два fetches.

### 15. Adaptive view per date range — §15 amendment

- **From**: design (§15 amendment)
- **Severity**: nice-to-have (codification of existing pattern)
- **Size**: S (doc only)
- **Risk**: low
- **Verified**: ✅ confirmed. `SalesRhythmPanel.tsx:27-31`, `SalesTrend.tsx:127-128`, `SalesHeroStrip.tsx:494-495` всички flip-ват на hourly когато `from === to`. Pattern работи; контрактът не го codify-ва.
- **Action**: Add §15 към `docs/analytics-design-contract.md` — "1 data point ⇒ adapt granularity или vis-class; detect by resolved range, not by preset name; comparison overlay на same granularity".
- **Blocks / unblocks**: Pairs with codification batch (§11, §12, §13, §16, §17, §18).
- **Payoff**: Следваща page (/traffic single-day sessions chart) не imprоviation-ва.

## Findings demoted or rejected

- **Data #6 — "Today" hourly demote not reflected in client SWR key**. Rejected as immediate work. Server-side normalisation е defensive; SWR keys self-consistent in current code; не виждам real-world manifestation. Defer към `/traffic` if Meta hourly multi-day surface-ва strange cache state.

- **Data #7 — Top products title merge case-sensitive**. Demoted to nice-to-have. Hypothesis-driven (verify), не confirmed bug. Defer to `/products` page kick-off; решение зависи от Shopify line_items variant_id consistency, която не сме верифицирали.

- **Data #9 — `period_unique_customers_by_store` migration 045**. Demoted. Сегашната surface не request-ва per-store customers tile. Може да чака докато `/customers` page-а build-нем — N+1 за ~7 stores е приемливо за now.

- **Data #10 — Geo cities homoglyph collision**. Demoted. Hypothesis-driven. Add unit test когато `/customers` page touch-ва city dimension; tackle then.

- **Data #11 — `store-performance` ignores stores=**. Demoted. Convention drift, не bug. Cleanup-ed в same PR като item 14 if effort allows.

- **Mobile F3 — `aria-live` spam**. Demoted important → nice-to-have. Real a11y concern, но screen-reader testing на BG VoiceOver не е priority blocker; add `role="status" aria-atomic="true"` в same PR като item 11.

- **Mobile F5 — Hero SubTile 375px congestion**. Demoted. Theoretical "would break with 6-digit values". Compact format helper (`fmtCompactEur`) вече exists; switch on `< md` if/when real overflow surface-ва.

- **Mobile F6 — "Dual pinned popups" anti-pattern**. **Conflict with design §18 "Persistence on release"** — design wants persistence codified, mobile says it creates mental load. **Resolution: design wins.** Persistence is the right default (Apple Health / Robinhood pattern). Mobile concern е valid но за future — add discrete "Пинирано" affordance (item F6 option (a)) когато второ chart на /traffic surface-ва проблема за реален operator. Postpone explicit dismiss button.

- **Mobile F7 — WorldMap popup hides marker**. Demoted. Real но fixable когато pop-up vocabulary unification (item 12) lands — shrink to 2 rows, add pulse ring on selected marker.

- **Mobile F8 — Native date picker UX**. Demoted to /traffic kickoff. Real но scope-heavy (`react-day-picker` ~30kB). Existing flow workable for operator who knows it.

- **Mobile F10/F11/F12/F13/F14/F15** — все polish. Combine batch когато /traffic build-ва.

- **Design Inconsistencies #6, #7, #8, #10, #11, #14, #15** — codify в design contract amendments batch, не immediate code work.

- **Reuse extraction #6 `<ComparisonAreaChart>`, #10 `useDateRangeAdaptive`** — Premature. Defer until 2-nd consumer на /traffic кикnel-ва.

## Cross-audit themes

### Theme A: Shared primitives layer не съществува — copy-paste се multiplied

`src/lib/swr.ts` exports `fetcher`, но **никой** не го import-ва. `src/lib/format.ts` exports `fmtMoney` с " €" suffix докато всеки /sales consumer пише own `fmtEur` с " EUR". `useChartScrubber`, `GlassTooltip`, `Delta` са вече generic — но `<MetricChips>`, `<DimensionListPanel>`, `<TopList>`, `<ComparisonAreaChart>` още живеят в /sales. Темата е една: **между "вече generic" и "още coupled" има 6-8 component-а, които да се промот-нат сега, преди copy-paste да се повтори на 4 следващи pages**. Това е the single biggest leverage point.

### Theme B: Foreign-store data fidelity е inconsistent между RPC-та

Migration 039 fix-на geography buyer-identity cascade. Migration 040+ продължи в same direction за други geography RPC-та. Но `period_unique_customers` (migration 029) остана с email-only logic — резултат: hero KPI и geography card show different customer counts. Темата е по-голяма от един RPC: **buyer-identity expression-ът трябва да живee на едно място** (SQL function или documented snippet в `docs/db/buyer-identity.md`). Иначе бъдещи migration authors ще го преоткриват.

### Theme C: Mobile chart-touch contract е добра, но gaps остават

`useChartScrubber` + `MobileScrubber` + globals.css mute-ване на Recharts native — chain-ът работи. Но (i) `touch-action: pan-x` на slider противоречи на own comment-а; (ii) pointer-capture без intent detection flash-ва tooltip при vertical scroll; (iii) `cooperativeGestures: false` на map краде scroll. Темата: **decide once where touch-action lives**, codify в `globals.css` + design contract §17, и фиксирай 3-те leak-а преди да копираш pattern-а на /traffic.

### Theme D: Design contract трябва да поеме 8 нови §-и преди разширение

Дизайн одитът предлага §11–§18 amendments. От тях: **must** — §11 (Glass tooltip vocabulary), §17 (chart-touch synergy), §18 (Persistence on release), §16 (Per-occurrence averaging w/ n=X). **Should** — §12 (Headline-in-header), §13 (Asymmetric hero), §15 (Adaptive view), §14 (Snap-scroll strip). **May** — §10.3 revision allowing uniform markers when clusters encode magnitude. Темата: **contract трябва да опише actual practice, не aspirational**. /sales вече прави всичко; contract-ът е behind.

## Suggested execution order (sprint plan)

### Chunk 1 — Security & data fidelity (must land FIRST)
- Items: **1** (rotate qa secrets) + **2** (migration 044 `period_unique_customers`)
- Size: S + M ≈ 3-4h
- Unblocks: All other work safely; `/customers` page kickoff не вече блокиран от bug
- **Done means**: ключовете ротирани в Supabase + Vercel; `qa-api-test.mjs` moved + uses `process.env`; migration 044 deployed; manual verification на hero strip за GR/IT/RO/DE/UK/HU/SK на 30d window показва new (higher) customer counts

### Chunk 2 — Shared primitives (highest leverage)
- Items: **6** (rewrite `lib/format.ts`) + **4** (jsonFetcher + useAnalyticsSWR + ErrorState) + **3** (buildAnalyticsUrl) + **11** (MetricChips)
- Size: M + S + M + S ≈ 6-8h
- Unblocks: /traffic, /ads, /email tile development; cache-key correctness; error surface
- **Done means**: 0 local `fmtEur` definitions in `/sales/components`; 0 local `fetcher` в `/sales` (всичко минава през `useAnalyticsSWR`); SWR keys param-sorted; all 11 silent-fail components show `<ErrorState />` on 500

### Chunk 3 — Mobile-first fixes
- Items: **5** (cooperativeGestures) + **8** (gesture intent) + **9** (tap-44 utility) + **14** (useStoreSelection useEffect)
- Size: S + M + S + S ≈ 4-5h
- Unblocks: Phone usability; hydration warning gone; ready for `useEntitySelection` generalisation
- **Done means**: phone scroll через map работи; vertical scroll through chart-а не flash-ва tooltip; всеки `<button>` под `md` >= 44px

### Chunk 4 — Design contract codification + drift fixes
- Items: **7** (срв → спрямо + DeltaInline) + **12** (GlassPanel split) + **10** (`excludeToday` opt) + **15** (§15 amendment) + write §11/§16/§17/§18 amendments in `docs/analytics-design-contract.md`
- Size: S + M + S + S + M (docs) ≈ 6-8h
- Unblocks: `/traffic` дизайн kickoff с complete contract; future map popups reuse `GlassPanel`
- **Done means**: design contract has §11-§18; 3 inline delta badges replaced with `<DeltaInline>`; no "срв." string remaining in `src/components/sales/`; WorldMap TooltipShell consumes `<GlassPanel>`

### Chunk 5 — Polish (optional batch, do когато /traffic kickoff)
- Items: 13 (§10.3 revision text), demoted items от mobile (F3 a11y, F5 compact format, F7 popup shrink, F10 skeleton text), reuse extraction #5 (`<TopList>`), #4 (`<DimensionListPanel>`), #9 (`findPeak<T>`), C3 (SparkTooltip → GlassTooltip), C7 (PeakChip).
- Size: L (~ 1 ден)
- Не блокиращ; нop-в за докато /traffic не започне

## Open questions for the operator

1. **Migration 044 deploy comms.** Item 2 ще direct-но промени hero strip "Уникални клиенти" числата за всеки foreign store по 30d window. Operator-ът ще види jump утре сутрин. **Option A**: deploy в късно вечер с announcement в Slack/email "От утре hero KPI ще покаже истинския брой foreign-store клиенти; географията вече го показва, hero-ат догонва". **Option B**: silent deploy, operator открива сам. **Recommendation: A** — premium product, expectations matter.

2. **Today-inclusion в Ритъм averaging.** Item 10 — три варианта в data audit #3. **Option A**: exclude-today (honest, loses live signal). **Option B**: partial-today scaling (`hour_of_now/24` fractional). **Option C**: surface a "Включва текущ ден (частично)" badge. **Recommendation: B за /sales (mathematically clean), C за /traffic** когато live signal-ат matters. Operator решава кое предпочита.

3. **`useStoreSelection` hydration fix.** Item 14 — **Option A**: useState+useEffect (запазваш "remember my store", добавяш един extra render). **Option B**: URL-only (loose remembering, bookmark-уеми links, no localStorage). **Recommendation: A** — UX value на "запомни моя store" е по-висока от теоретична bookmark-ability за internal tool.

4. **WorldMap §10.3 — revise contract or implement T1/T2/T3 ladder?** Item 13. **Option A**: revise §10.3 to allow uniform markers when clusters encode magnitude (current code stays; contract relaxes). **Option B**: implement T1/T2/T3 tier system в `marker-dots` layer (more visual diff). **Recommendation: A** — current "office-level dots are all small dots" pattern reads cleanly; tier ladder adds noise where most points represent 1-15 orders.

5. **Persistence on release vs dual-pin affordance.** Conflict between design §18 (codify persistence) и mobile F6 (dual-pin mental load). **Option A**: codify persistence as §18, add discrete "● Пинирано" prefix when popup persists past pointer release (visual signal it's pinned). **Option B**: revert to auto-dismiss after 10s idle. **Recommendation: A** — pin-able popups are the right UX (Apple Health pattern); the affordance is the missing piece, not the persistence.

6. **`fmtEur` vs `fmtMoney` naming.** Item 6 — rewrite `lib/format.ts`. **Option A**: keep `fmtMoney*` names (current `lib/format.ts`), rewrite to output "EUR" suffix, migrate sales callers. **Option B**: rename canonical to `fmtEur*` (matches actual /sales code + memory rule "always EUR"). **Recommendation: B** — name-ът explicit за memory rule, и e how the code already calls it.

---

*End of consolidated action plan.*
