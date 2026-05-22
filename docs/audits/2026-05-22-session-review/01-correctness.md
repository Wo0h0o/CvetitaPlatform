# Correctness Audit — Revamp Sprint 2026-05-22

**Ревизор:** Correctness/Data Agent  
**Обхват:** 10 commita, `36bb387..26b6433`  
**Дата:** 2026-05-22

---

## Резюме

Кодът като цяло е **надежден**. Критичната логика (`previousRange`, Sofia-tz math,
promise isolation, RLS схема, SSE streaming) е написана правилно. Build минава и
runtime logic-ата съвпада с намерението.

Намерен **1 функционален бъг** с умерен риск (placement API, пропусната `level`
директива), **2 оранжеви риска** (Meta token в URL за production calls; health
check тества различен auth path) и **3 жълти подобрения** (currency symbol, empty
error body, misleading field name). Нищо не счупва основния поток — /ads KPI strip,
deltas, trend chart, morning report cache и inbox deep-links работят коректно.

---

## Находки по тема

### 1. `/api/settings/health` — Probe коректност

**Статус: ДА, добре.**

- GA4 probe: извиква `runReport({ metrics: ["sessions"], startDate: "yesterday", ... })` — правилен, евтин, упражнява OAuth refresh chain.
- Meta probe: токенът се подава чрез `Authorization: Bearer` header (ред 96) — коректно за сигурност.
- Klaviyo probe: `Klaviyo-API-Key` header + revision — правилен формат на Klaviyo v3 API.
- Shopify probe: `X-Shopify-Access-Token` header — правилно.
- `Promise.all` с 4 independent async функции, всяка ловяща собствените си грешки и *всинаги resolving* → graceful degradation работи.

🟠 **Health probe тества различен auth path от production**  
`checkMeta` (health/route.ts:96) подава токена като `Authorization: Bearer` header.  
Всички production Graph calls в `meta.ts` (redове 248, 623, 658, 677) подават токена като URL query param (`access_token=...`).  
Meta приема и двата метода, но ако има token-scope или format проблем специфичен за единия метод, здравната проверка би показала "connected" докато реалните данни фейлват.  
Не е бъг на нов код — `meta.ts`-ът с URL params е предспринтов код — но inconsistency-то е рисков.

---

### 2. `/api/dashboard/ads/route.ts` — `previousRange` математика

**Статус: ВЯРНА.**

Верификация за 7-дневен прозорец:
- `period.start = "2026-05-15"`, `period.end = "2026-05-21"`
- `lenDays = round((21-15) * 86400000 / 86400000) + 1 = 7` ✓
- `until = addDaysIso("2026-05-15", -1) = "2026-05-14"` ✓
- `since = addDaysIso("2026-05-14", -(7-1)) = "2026-05-08"` ✓
- Резултат: 7-дневен прозорец 8–14 май, точно преди 15–21 май ✓

`preset=today` path:  
- `buildOverviewFromPostgres(ids, sofiaDate())` → `period: { start: today, end: today }` (hardcoded, ред 211 в ads-market.ts)
- `previousRange({start: today, end: today})` → `lenDays=1`, `until=yesterday`, `since=yesterday` ✓
- `buildOverviewFromPostgres(ids, prev.until)` → data за вчера ✓

Multi-account fan-out за previous (ред 134-138): `getMetaOverview(datePreset, id, prev)` — когато `timeRange` е подаден, `date_preset` се игнорира в spread (meta.ts ред 317-319). Коректно.

Env-default path (ред 87): `getMetaOverview(undefined, undefined, prev)` — `datePreset` defaults to `"last_7d"`, но e irrelevant защото `timeRange` overrides. Коректно.

Не чупи legacy `/ads/campaigns` и `/ads/adsets` (ids===null path е запазен непроменен).

---

### 3. `getMetaOverview` с `time_range`

**Статус: JSON форматът е валиден.**

`JSON.stringify({ since: "2026-05-08", until: "2026-05-14" })` произвежда валиден Meta
`time_range` JSON обект с точно `since`/`until` ключове — съгласно Meta Graph API
документацията. Switch-ът `date_preset` vs `time_range` е взаимно изключващ с conditional spread (meta.ts ред 317-319). ✓

---

### 4. `/api/dashboard/ads/trend` — data pipeline

**Статус: КОРЕКТЕН.**

- `addDaysIso` (ред 29-33): UTC math, без TZ drift ✓
- `sofiaDate()` за `until` — anchored в Sofia TZ ✓
- Missing-day handling: `byDate` Map → само дни с реални записи се включват, без zero-fill. Коментарът правилно документира това поведение ✓
- Division by zero: `roas: v.spend > 0 ? Math.round(...) : 0` ✓
- Env-default guard: ако `ids` е null (ред 52-54), връща `{ trend: [] }` — клиентът получава празен масив, не грешка ✓

Забележка: `preset=today` и `preset=yesterday` и двата дават 14-дневен прозорец (PRESET_DAYS). Умишлено е за rhythm context, добре документирано.

---

### 5. `/api/dashboard/ads/placements` + `getMetaPlacementBreakdown`

🟠 **Липсва `level: "account"` в placement breakdown call**  
`src/lib/meta.ts:426-432`

```ts
const rows = (await fetchInsights(
  {
    fields: "spend,actions,action_values",
    date_preset: datePreset,
    breakdowns: "publisher_platform",
    // ЛИПСВА: level: "account"
  },
  client
))
```

Meta Insights API-то defaultва до `level=ad` когато `level` е пропуснат. При `level=ad` +
`breakdowns=publisher_platform` API-то връща **един ред за всяка (ad, platform)
комбинация** вместо един ред за platform на account ниво.

**Практически ефект:** При акаунт с 50 активни реклами и 3 платформи (FB/IG/AN),
API-то ще върне до ~150 реда вместо 3. Сумирането в route.ts (редове 58-65) ще
даде правилните spend totals за всяка платформа — но:
1. **Консумира повече BUC budget** от необходимото
2. **Риск от pagination truncation** — при лимит=500 реда в `fetchInsights`, голям
   акаунт с >165 активни реклами на 3 платформи ще изпусне редове, и spend totals
   ще бъдат подценени
3. Не е грешен в small accounts, но не е intended behavior

**Fix:** Добави `level: "account"` в params обекта.

---

### 6. `/api/agents/morning-report` — GET кеш, POST persist, SSE

**Статус: КОРЕКТЕН.**

- GET graceful degradation (ред 72-76): Supabase query error → `logger.error` + `return { report: null }`. Страницата ще генерира нов доклад. ✓
- POST upsert `onConflict: "organization_id,report_date"` (ред 178) — съответства на `UNIQUE (organization_id, report_date)` в migration 045. ✓
- SSE `snapshot` събитие (ред 110): изпратено *преди* Claude стриминга, така KPI strip-ът се рендерира веднага. ✓
- `fullText` акумулация (ред 158-159): append-only, коректна. ✓
- Persist failure (ред 180-182): само логва, не спира SSE. User-ът получава streaming репорт дори при DB грешка. ✓
- `getUserContext` за org (ред 63): използва `supabase-ssr` client с cookies → дава `organizationId` от `organization_members`. ✓

---

### 7. Migration 045

**Статус: КОРЕКТНА.**

- FK: `organization_id REFERENCES organizations(id) ON DELETE CASCADE` ✓
- `UNIQUE (organization_id, report_date)` → поддържа upsert ✓
- RLS: `organization_id IN (SELECT user_org_ids())` — `user_org_ids()` е дефинирана в migration 001 и се използва консистентно в 20+ таблици. ✓
- Service-role writes not gated by RLS (INSERT/UPDATE са само за service-role key) — коректно и документирано в коментара. ✓
- Index: `(organization_id, report_date DESC)` — оптимален за "today's report for this org" lookup. ✓

---

### 8. `/inbox` `targetHref`

**Статус: КОРЕКТЕН.**

- `target_type = "market"`: `card.target_id || market` — fallback на market_code от stores join ✓
- `target_type = "product"`: `card.target_id ? /products/${id} : "/products"` — безопасен fallback ✓
- `target_type = "ad"`: `market ? /ads/${market}?focus=${id} : null` — без market не дава dead link, а null ✓
- `target_type = "adset"` / `"campaign"`: `market ? /ads/${market} : null` — бележката за "no focus handler yet" е документирана ✓
- `default`: `null` — инспект-only режим, правилно ✓

Няма dead links — при `null` бутонът "Прегледай" не се рендерира (ред 229).

---

### 9. Edge cases

**`getMetaOverview` empty rows — липсващ `cpa` в zero-path:**  
`src/lib/meta.ts:325-330` — zero-rows path не включва `cpa: 0`. Но `Overview` типа
(ads-market.ts:60) дефинира `cpa?: number` (optional). Страницата използва
`prev.cpa ?? 0` — runtime не се счупва. **Не е бъг, но е непоследователно** с
non-empty path.

**`CreativeHealthCard` score bucketing:**  
`SCORE_TIERS.findIndex((t) => a.score >= t.min)` върху sorted-descending array
[80, 60, 40, 20, 0] — работи коректно. Score=80 → tier 0, score=79 → tier 1. ✓

**`AdsBreakdown`: `total === 0` guard:**  
`PlacementCard: max = Math.max(...placements.map(p => p.spend), 1)` — `1` е fallback
против деление на нула. ✓  
`CampaignsCard: max = Math.max(...top.map(c => c.spend), 1)` — също ✓

**`previousRange` с `end < start` / NaN:**  
Ред 49 проверява `!Number.isFinite(start) || !Number.isFinite(end) || end < start` → `null`. ✓

---

### 10. Real Data Only (CLAUDE.md §5)

**Статус: Чист.**

Не са открити hardcoded числа, mock данни или фиктивни стойности. Единственото
hardcoded е `checkGoogleAds()` — константно `"disconnected"` с обяснение "директна
интеграция предстои". Документирано и легитимно.

---

### 11. Допълнителни наблюдения

🟡 **`/google-ads` mobile card — currency symbol липсва**  
`src/app/(dashboard)/google-ads/page.tsx` (новите редове в `MetricCell` вик):
```tsx
<MetricCell label="Spend" value={c.spend.toFixed(0)} />
```
Desktop таблицата форматира с `€` и `fmtMoneyShort`. Mobile card-ът показва само
число без символ. Не влияе на данните, но е UX inconsistency.

🟡 **`metaFetch` губи Meta error body при 400/403**  
`src/lib/meta.ts:253` — `await res.text()` drains but discards the body. При 400
грешка от placement breakdown (неправилни параметри), Meta error message-ът се
губи. Дебъгването ще изисква re-production. Препоръчително: логни body-то.

🟡 **`MorningSnapshot.shopify.salesToday` naming mismatch**  
`src/app/(dashboard)/morning-report/page.tsx:34` показва "Приход вчера" от
`s.shopify.salesToday`. Полето се зарежда с `shopifyDay: "yesterday"` data —
label-ът е верен, но field name-ът е misleading. Не е бъг.

---

## Какво е направено добре

- `previousRange` алгоритъмът — елегантен, data-driven (не guess preset semantics)
- Sofia-tz anchoring е консистентно в trend route (`sofiaDate()` + `addDaysIso`)
- Promise isolation в health route — всеки probe независим, graceful degradation работи
- Migration 045 — пълна: table, index, RLS, comments, backward-compatible
- SSE streaming pattern в morning-report — `snapshot` преди prose е правилен UX
- `aggregateOverview` — правилно recompute derived ratios от sums (не average на ratios)
- `buildOverviewFromPostgres` за `preset=today` — елиминира drift между KPI strip и TopBar
- `targetHref` null safety — никога dead links
- Chart tooltip refactor — `buildRechartsTooltip` е clean, type-safe abstraction

---

## Топ находки по severity

| # | Severity | Файл | Ред | Проблем |
|---|----------|------|-----|---------|
| 1 | 🟠 | `src/lib/meta.ts` | 426-432 | `getMetaPlacementBreakdown` липсва `level: "account"` — при голям акаунт данни се truncate |
| 2 | 🟠 | `src/app/api/settings/health/route.ts` | 96 vs meta.ts:248 | Health probe използва Bearer header; production calls използват URL param — различни auth paths |
| 3 | 🟡 | `src/app/(dashboard)/google-ads/page.tsx` | mobile MetricCell | Spend без currency symbol на mobile |
| 4 | 🟡 | `src/lib/meta.ts` | 253 | Error body се губи при Meta API 400 — debug-ът е по-труден |
| 5 | 🟡 | `src/app/(dashboard)/morning-report/page.tsx` | 34 | `salesToday` field name misleading (показва yesterday data) |
