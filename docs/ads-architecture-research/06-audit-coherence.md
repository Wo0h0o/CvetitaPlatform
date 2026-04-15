# 06 — Coherence & Fit Audit

_Evaluating whether docs 01–04 hang together as one architecture, and whether they fit Cvetita's codebase, principles, and Petar's actual morning._

---

## 1. Verdict on coherence

**The four docs are ~70% coherent — one shared backbone with three unreconciled surface-level conflicts.** They agree on the important things: (a) split the data source from the "store" concept, (b) `store_id` must be a parameter, not hardcoded, (c) aggregate is not a naive SUM, (d) the AI sits on top of a normalized event/insights layer, not on top of live Graph calls. Doc 02's `integration_accounts` table, Doc 03's `compare_stores` tool, and Doc 04's event-log all describe the same substrate from different angles.

Where they fragment is the **surface** — URL-as-scope vs. dimension-as-filter, aggregate-default vs. small-multiples-default, three agents vs. an implied fourth. These are not architectural rivalries so much as unanswered UX questions that each doc answered in isolation. An arbiter picking a single line on each makes them one design.

## 2. Concrete contradictions — and rulings

**(i) URL-scoped routes (01) vs. dimension-as-filter (04 Idea A).** Doc 01 makes `workspace` part of the URL (`/ads/bg`); Doc 04 argues a store is just a filter on an event log. **Ruling: 01 wins for v1, 04 wins for v3.** URL-scoped routes ship in days; a dimensional refactor is a 2–3 month rewrite. Doc 04 itself defers Idea A. Keep the URL segment; under the hood, the query IS already "event log filtered by store" — they can converge later without a user-visible break.

**(ii) `compare_stores` as SQL view (02) vs. as an LLM tool (03).** Not a contradiction — these are the **same primitive at two layers**. Doc 02's `meta_insights_by_store` view is the implementation of Doc 03's `compare_stores` tool. Ruling: land the view first (02), then expose it to the agent (03). The tool is a thin SQL wrapper.

**(iii) Default to aggregate (01) vs. small multiples (04 Idea E).** **Ruling: small multiples win at the top level, aggregate wins one click down.** The Google Ads MCC precedent in Doc 01 (`/all`) is correct, but the payload of `/all` should be Tufte-style small multiples (per-store sparklines), not a single summed number. A non-analyst owner reads pattern-divergence pre-cognitively; they cannot read a hidden-by-SUM bleeding store. This is the single biggest owner-UX upgrade in the whole research pack.

**(iv) Three agents (03) vs. implied always-watching anomaly agent (04 Frame 10).** Doc 04 defers this; Doc 03 doesn't cover it. **Ruling: the anomaly watcher is not a 4th agent — it's a nightly cron that pre-writes "what to notice" into a `agent_briefs` table, consumed by `portfolio-intel` when Petar opens the app.** No new model; recycles the "daily morning brief" line already in Doc 03 §6.

**(v) Freshness SLAs (02: 5m/15m/1h/24h) vs. "1–5 min, UI instant" (04 Idea D).** These are **compatible.** Doc 02's 5-minute SLA for today's spend is the ingestion target; Doc 04's "UI is instant" is the render target — the UI reads the materialized view in <500ms regardless. Ruling: no conflict; document both as "ingest ≤5m, render ≤500ms."

## 3. Fit with existing codebase

**Additive (safe):**
- `integration_accounts` + `store_integration_bindings` (02) compose cleanly with `stores` + `store_credentials` — neither is touched, the new tables sit beside. `store-config-loader.ts` keeps working for Shopify; a sibling `loadIntegrationAccount()` handles Meta/GA4/Klaviyo.
- Shared `meta_insights_daily` (02) in `public` is the right call — it respects the existing hybrid: schema-per-tenant for orders/products (already in `store_${market_code}`), shared for ads. No migration of existing data.
- Three-agent topology (03) slots next to today's `ads-intel`/`market-intel` routes under `src/app/api/agents/`. ~200 LOC each.

**Rewrite (unavoidable, but small):**
- `src/lib/meta.ts` must lose its module-level `getAccountId()`/`getToken()` and accept an `integrationAccountId` at every call site. TypeScript will surface every caller; mechanical fix. This is the only structural refactor in the stack and it's exactly the "smallest first step" (Doc 02 §5 steps 1–3).
- `META_AD_ACCOUNT_ID` / `META_ACCESS_TOKEN` env vars move into `integration_accounts.credentials`. Two-week dual-run is the right caution.

**Distraction (don't do now):**
- **Doc 04 Idea C (generative UI).** Honest read of the team's capacity given Cvetita's core mission (content → ad → store loop per `CLAUDE.md` principle 6): schema-driven AI dashboards are a research project, not a shipping feature. Doc 04 itself ranks it 4th/5th. Skip until after the primary loop is solid.
- **Doc 04 Idea B (command palette as primary interface).** Ship Cmd-K as a switcher accelerator (Doc 01 already specifies `⌘K`), not as the primary nav. Linear-style Cmd-K-first fails when the user is not a power user.
- **Router agent (03 §2, optional).** Explicit UI dispatch beats an LLM router for v1 — cheaper, debuggable, matches principle 3 (KISS).

**Principle check:** The composite design respects all eight principles in `CLAUDE.md`. Graceful degradation (principle 8) is explicitly honored by 02's "rate-limited → serve stale with freshness dot." Progressive disclosure (7) is honored by small-multiples → single-store drill-down. Real data only (5) is honored by the event-log + reconciliation. Mobile-first (2) needs attention: small multiples on 375px = a vertical stack of 3 sparklines, not a 3-column grid.

## 4. The owner's dashboard, sketched

**Route:** `/` (the Command Center homepage, not `/ads`). When Petar opens the app at 8am he should not pick a section — the section is the page.

**Above the fold, laptop (1440×900):**
- **Top strip — "Today at a glance."** One line, 4 tiles: `Yesterday's net revenue €X (+Y% vs prior Wed) • Meta spend €X (ROAS 3.2) • Orders 142 • Anomalies 2`. Each tile clickable, the last one pulsing red if >0.
- **Hero row — small multiples.** 3 cards side-by-side: **Bulgaria / Greece / Romania**. Each card: a 14-day revenue sparkline with today's point highlighted, a tiny ROAS number in the corner, a colored left-border (green/yellow/red) based on a z-score baseline ("is this store bleeding?"). A 4th muted card for ProteinBar. Eye instantly finds the bleeding one — no math.
- **Action row — "Do this today."** 2–4 AI-written action cards, pre-computed by the nightly `agent_briefs` cron (ruling iv above). Each card: **title** ("Pause `BG - TOF - Video 3`"), **why** ("CPA €18.40, up 140% over 7d, below store median"), **one-click action** ("Pause" / "Open in Meta" / "Dismiss"). This is the Petar-first payload — delta + cause + recommended action, exactly as the brief specifies.

**Below the fold:** weekly trend (revenue vs spend, all stores overlaid), top 5 products, fresh winners (new ads with ROAS > 3 on <€50 spend). No store switcher needed yet — the small multiples ARE the switcher; click a card to drill into `/ads/bg`.

**Mobile (375×812):** collapse the hero row to a vertical stack of three compact rows (flag + name + sparkline + z-score dot). Action cards become a swipeable carousel of 2–4. The "Today at a glance" strip becomes a 2×2 grid. No horizontal scrolling for numbers.

**Time-to-insight:** app-open → Petar sees the bleeding store in ~1 second (color), the cause in ~3 (action card title), the fix in one click. The four owner questions (up/down vs yesterday/week/year, which store bleeding, which ad winning, what to act on) are all answered above the fold.

## 5. Unified first-principles recommendation (ship in 4–6 weeks)

**Build one page: `/` — the Owner Home — backed by three boring pieces of infrastructure.**

**The page (weeks 3–6):** the sketch in §4. Small multiples + action cards + freshness dots. No store switcher on this page. A switcher in the TopBar (per Doc 01) exists only for drill-downs (`/ads/bg`, `/sales/gr`).

**The three pieces of infrastructure (weeks 1–4, in parallel):**
1. **`integration_accounts` + `store_integration_bindings` tables + meta.ts refactor** (Doc 02 §5 steps 1–3). This unlocks all six Meta accounts behind the existing single-account UI. Smallest unlock with largest reach.
2. **`meta_insights_daily` + nightly cron** (Doc 02 §2–§3). Writes once, reads many. Enables small multiples without 6 live Graph fan-outs per page load.
3. **`compare_stores` SQL view + `portfolio-intel` agent with a single `agent_briefs` nightly job** (Doc 03 §3+§6). Writes tomorrow's action cards while Petar sleeps.

**What we explicitly defer:** full dimensional `/explore` (Doc 04 Idea A), generative UI (Idea C), Cmd-K as primary nav (Idea B), cross-currency aggregation (irrelevant today, all EUR), per-ad vector RAG (Doc 03 §7), multi-account OAuth flow (one app token works for now).

**Why this satisfies all three lenses:**
- **Owner-first:** app-open to insight in 1–3 seconds, actions pre-written, no clicks to switch stores to find a problem.
- **Coherent:** resolves all five contradictions in §2 with the smallest surface. The four docs become one design.
- **Shippable:** ~3 tables, ~200 LOC of cron, ~200 LOC of agent, ~1 new page. Fits the existing Next.js 15 / Supabase / SWR stack with zero new runtimes. Respects KISS and Ship > Perfect.

**The north star:** every feature should answer "does Petar see it, or does he have to ask for it?" If he has to ask, it's in a drill-down, not on the homepage. If he sees it and can't act on it, the AI hasn't done its job yet.
