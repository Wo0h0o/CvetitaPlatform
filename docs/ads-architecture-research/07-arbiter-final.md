# 07 — Arbiter's Final Ruling

_Synthesis of 01 (UX), 02 (Data), 03 (Agents), 04 (Novel), 05 (Pragmatist audit), 06 (Coherence audit) through the business-owner lens: **shortest path to the most insightful information.**_

---

## 1. The one-line answer

**Build one page (`/` — Owner Home) that shows Petar, in under 3 seconds, where he's up, where he's bleeding, and what to do about it today — backed by three pieces of infrastructure that unlock all 6 Meta accounts behind the scenes.**

> **Post-ruling corrections (applied 2026-04-15):**
> - **ProteinBar is a BG sub-brand, not an orphan.** Revenue from ProteinBar ads lands on the BG Shopify store (`p0xgx1-ic.myshopify.com`). Binding: Cvetita BG, `role='secondary'`. Only GR and RO have their own Shopify stores. Home page shows **3 store cards (BG/GR/RO), not 4**.
> - **Card drill-down hierarchy locked (Option A):** whole card tap → `/sales/store/[storeId]` (Shopify business view, already built). Secondary "Виж реклами →" link top-right of card → `/ads/[market]` (new in W3). Sparkline metric = Shopify revenue; ROAS badge in corner = blended Meta ROAS across all bound accounts.
> - **Platform language = Bulgarian** for all user-visible strings. English only for code, logs, technical identifiers, and brand names (Shopify, Meta, ROAS). See `memory/feedback_platform_bulgarian_ui.md`.
> - **W1 + W2 shipped (2026-04-15).** Migrations 008-010 applied, 6 Meta accounts seeded (5 active, correct bindings after ProteinBar fix), `meta.ts` refactored with optional `integrationAccountId`, `/api/cron/meta-sync` daily at 03:00 UTC with BUC rate-limit parser, Bulgarian `FreshnessDot` component ready. Full W3 task list at [08-week3-plan.md](08-week3-plan.md).

Everything else — Cmd-K as primary nav, dimensional refactor, generative UI, event-log architecture, chrome recolor, `invoke_store_agent` map-reduce, `meta_async_jobs` polling — is deferred.

## 2. Rulings on the 5 contradictions

| # | Contradiction | Ruling |
|---|---|---|
| 1 | Aggregate default (01) vs small multiples (04 E) | **Small multiples win.** A summed ROAS hides the one store that tanked. Petar's eye finds a red sparkline in 1 second; a sum needs him to already know there's a problem. |
| 2 | URL-scoped routes (01) vs dimension-as-filter (04 A) | **URL-scoped for v1. Dimensional refactor deferred to multi-tenant SaaS phase.** The `store_id` query is already "event log filtered by store" under the hood — they converge later without a visible break. |
| 3 | `compare_stores` SQL view (02) vs LLM tool (03) | **Same primitive, two layers.** Ship the SQL view first; the LLM tool is a thin wrapper. |
| 4 | 3 agents (03) vs always-watching anomaly agent (04 Frame 10) | **Not a 4th agent — a nightly cron that pre-writes action cards into `agent_briefs`, consumed by the home page.** Same Opus endpoint, different system prompt, runs at 6am. |
| 5 | 5m/15m/1h/24h ingestion SLA (02) vs "instant UI" (04 D) | **Compatible. Ingest ≤5m, render ≤500ms.** The UI always reads materialized views; ingest freshness is a separate axis surfaced via the freshness dot. |

## 3. The Owner Home page (the whole product, v1)

### Above the fold — laptop

1. **Top strip, "Today at a glance":** `Yesterday revenue €X (+Y% vs prior same-weekday) • Meta spend €X (ROAS Z) • Orders N • Anomalies K` — the last tile pulses red when K > 0.
2. **Hero row, small multiples:** 3 cards side-by-side for BG / GR / RO (+ muted 4th card for ProteinBar). Each card: 14-day revenue sparkline, today's point highlighted, tiny ROAS in the corner, **colored left-border** from a z-score baseline (green / amber / red). This is the single biggest owner-UX upgrade in the whole pack.
3. **Action row, "Do this today":** 2–4 AI-pre-written cards from the nightly brief. Each: **title** (e.g. "Pause `BG - TOF - Video 3`"), **why** (one-sentence cause), **one-click action** (Pause / Open in Meta / Dismiss). This is the delta + cause + action payload Petar actually wants.

### Mobile (375px)

- Top strip: 2×2 grid.
- Hero row: vertical stack (flag + name + sparkline + z-score dot per row).
- Action row: swipeable carousel of 2–4 cards.
- No horizontal scroll for numbers. No switcher on this page — the cards **are** the switcher (tap to drill into `/ads/bg`).

### Time-to-insight

- **~1s:** Petar sees the bleeding store (red border).
- **~3s:** he reads the action-card title and understands the cause.
- **One tap:** Pause, Open, or Dismiss.

All four owner questions ("up/down vs yesterday, which store bleeding, which ad winning, what to act on") are answered above the fold. No store switcher required for the daily check-in. The switcher exists only in the TopBar of drill-down pages (`/ads/bg`, `/sales/gr`) where the question is already "which store?"

## 4. What infrastructure is required (ship in parallel with the page)

Three pieces. ~3 tables, ~400 LOC total, zero new runtimes.

1. **`integration_accounts` + `store_integration_bindings` tables + `meta.ts` refactor** (from Doc 02 §5 steps 1–3). This unlocks all 6 Meta accounts behind the existing single-account UI. It's also the only structural refactor — TypeScript surfaces every caller when `getAccountId()` becomes `getAccountId(integrationAccountId)`. Smallest unlock with largest reach.

2. **`meta_insights_daily` (shared table in `public`) + nightly cron** (Doc 02 §2–§3). Per-account fan-out with `Promise.allSettled`, batch endpoint for creative hydration, BUC header parsing for rate limits. Writes once, reads many — small multiples render without 6 live Graph calls per page load.

3. **`compare_stores` SQL view + single `portfolio-intel` endpoint + nightly `agent_briefs` job** (Doc 03 §3 + §6). One Opus agent with 6 tools (`list_stores`, `get_ads_overview`, `get_shopify_revenue`, `compare_stores`, `explain_delta`, `get_ga4_traffic`). The nightly brief runs the same endpoint with a different system prompt and writes action cards to Postgres for the home page to read synchronously.

## 5. What's explicitly cut from v1

| Proposal | Why cut |
|---|---|
| `⌘K` as primary nav (04 B) | Analyst fantasy on mobile; keep as desktop accelerator only |
| Stripe chrome-recolor | Colored dot + bold name is enough; CSS plumbing has no ROI |
| `/ads/compare?w=bg,gr` multi-select | Small multiples replace it; no user asked for 4-way compare |
| `invoke_store_agent` map-reduce | Showcase, not need — `compare_stores` answers the same questions |
| Router agent (Haiku) | Explicit UI dispatch is cheaper, debuggable, matches KISS |
| `meta_async_jobs` + polling | No 90d backfill request yet — defer until 60s cap actually trips |
| FX rates table / view | All 3 stores are EUR — ship a stub, expand when non-EUR lands |
| Dual-run migration ceremony | Solo-shop; single cutover + rollback script is faster and honest |
| Generative UI `/lab` (04 C) | 2027 maturity; Vercel AI SDK UI still churning in 2026 |
| Event-log push architecture (04 D) | 6-week infra project; pull + nightly materialization is 80% of the benefit at 10% of the cost |
| Full dimensional refactor (04 A) | 2–3 month rewrite; revisit when 2nd private-label tenant arrives |
| Per-ad vector RAG | Premature — SQL over `meta_insights_daily` is exact and fast at our volume |

## 6. Do we need more agents?

**No.** One Opus endpoint (`portfolio-intel`) with six tools, plus a nightly cron that uses the same endpoint with a different system prompt to write action cards. The `ads-intel` and `market-intel` routes already exist and stay; they handle drill-downs and web research respectively.

The user's instinct — "do we need more agents?" — is the right question. The answer: more agents is the wrong lever. **Better tools is the right lever.** `compare_stores` as a pre-aggregated SQL primitive answers ~60% of portfolio questions in one call, with no fan-out and no map-reduce.

## 7. How agents avoid being overwhelmed

- **Store-ness lives in the tool parameter, not the agent identity.** Every tool takes `store_id`. The registry maps `store_id → {meta_account_id, shopify_domain, ga4_property, klaviyo_pk}` server-side. The LLM never sees 6 ad accounts' worth of data at once.
- **Prompt caching (1h for tool schemas + static system, 5m for daily business context).** Expected 30–40% input-cost savings on follow-up turns in the same session. The single biggest cost lever.
- **Materialized `meta_insights_daily` + freshness SLAs.** Tools read Postgres, not live Graph, for anything ≥ 1 day old. The agent asks for "last 7 days" and gets 7 rows back — not 6 accounts' raw JSON.
- **`compare_stores` beats fan-out.** The agent never asks for 6 accounts in parallel; it asks for "ROAS across all stores for last 7d" and gets a 3-row pre-aggregated answer.

## 8. Decisions locked with Petar

1. **Action cards — confirm-first modal, no silent mutations.** Modal shows the exact target object (ad / ad set / campaign ID and name), the current value, and the new value. No one-click execution in v1.
2. **Scale action — fixed menu (+25% / +50% / +100% / custom).** Rejected per-card LLM-computed specific targets: each would require an Opus call to calibrate headroom, and 2–4 such calls per nightly brief multiplies cost without meaningful accuracy gain. Presets + one manual override covers the real decision space.
3. **ProteinBar in "Today at a glance" — rolled into the totals.** Same brand umbrella operationally; visually separated only in the hero row small multiples (muted 4th card) for a quick at-a-glance slice.
4. **Canonical BG Meta account — `act_280706744248197`** (the one currently wired). `act_334527788845228` (NEW) binds with `role='legacy'`. Revenue funnels to the same brand regardless, so aggregate numbers stay correct either way; the distinction matters only for campaign-level drill-down continuity.
5. **Anomaly threshold (locked):** rolling **last-24h ROAS** ÷ **14-day median of 24h ROAS** windows. Red < 70%, Amber 70–90%, Green ≥ 90%. No spend floor — the rolling 24h window guarantees real volume in any active account. Revisit with z-score once `meta_insights_daily` has 30+ days of history.

6. **Time frames on the home page — hybrid, purposeful:**
   - **Top strip** = today-in-progress (running totals from midnight local time). Tracks the tempo of the day. For each metric shows: (a) running total, (b) delta vs "typical [weekday]" at matched hour = average of the last 4 same-weekdays at the same hour-of-day, (c) projected day total based on current pace. Labels read simply: `▲ +12% vs typical Wed`.
   - **Card borders** = last 24h rolling window (health signal, independent of calendar).
   - Each surface is optimized for its job: top strip for daily pacing, cards for real-time pulse.

## 9. Shippable plan (4–6 weeks, solo-dev-friendly)

- **Week 1:** migrations 008–010 (`integration_accounts`, `store_integration_bindings`, `meta_insights_daily`). Seed from `/me/adaccounts`. Refactor `src/lib/meta.ts` to require `integrationAccountId`.
- **Week 2:** `/api/cron/meta-sync` nightly fan-out with BUC-header rate limiting. `meta_insights_by_store` SQL view. Freshness dot component.
- **Week 3:** Owner Home page layout (small multiples, top strip, action row stubs). `compare_stores` tool on existing `ads-intel` route.
- **Week 4:** `agent_briefs` nightly job writing action cards. Action-card component. One-click "Dismiss" (defer Pause/Scale).
- **Week 5:** mobile pass (375px), z-score baseline tuning with Petar, anomaly threshold calibration.
- **Week 6:** cutover from `META_AD_ACCOUNT_ID` env var to `integration_accounts`. Delete env vars. Ship.

---

**North-star check:** every feature answers "does Petar see it, or does he have to ask for it?" If he has to ask, it's in a drill-down. If he sees it and can't act on it, the AI hasn't done its job yet.
