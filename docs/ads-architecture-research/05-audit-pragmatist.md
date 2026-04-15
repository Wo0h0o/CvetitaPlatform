# 05 — Audit: Pragmatist's Red-Pen Pass

_Lens: the business owner is not an analyst. Every proposal must shorten time-to-answer on a phone, in a morning, with zero mental tax._

---

## 1. Summary verdict

- **Most solid:** `02-data-architecture.md`. The `integration_accounts` + `store_integration_bindings` split is real work that solves a real ProteinBar/legacy-BG problem today. Not speculative.
- **Shakiest:** `04-novel-architecture.md`. Internally contradicts the defaults in 01 and 03, and ranks a foundational rewrite (Idea D, event log) as "ship in 3 months" without confronting the Vercel/Inngest cost and timeline.
- **Ship now:** per-account Meta fetch wired via `integration_accounts` (doc 02 §1), freshness dot (doc 02 §4), `compare_stores` SQL primitive (doc 03 §3), small multiples view (doc 04 Idea E).
- **Cut:** `invoke_store_agent` map-reduce for v1, `⌘⇧1/2/3/4/0` keyboard shortcuts, Stripe-style chrome recolor, `/lab` generative UI, `/ads/compare?w=bg,gr`.
- **Defer:** Router (Haiku) — wait for signal, add in v2. Full dimensional refactor (Idea A) — only when the 2nd private-label tenant arrives. Generative UI (Idea C) — too early in 2026. Async-jobs table — only when 90d backfill is actually requested.

## 2. Specific holes

### Doc 01 — UX
- **⌘K is an analyst fantasy for this owner.** He reads the morning number on a phone in Bulgarian, on a 375px screen. No command palette, no `⌘⇧3`. Keep `⌘K` on desktop only, do not call it "universal."
- **Stripe chrome-recolor is over-engineering.** A colored dot + bold store name in a 44px TopBar is enough. Recoloring the entire chrome per store costs CSS variable plumbing for a signal already carried by the dot.
- **Aggregate-as-default can hide one store going sideways.** The doc asserts "AI sees everything" justifies aggregate; the owner wants "where is the problem?" The honest default is small multiples (doc 04 E), not a sum.
- **`/ads/compare?w=bg,gr` is a feature without a user.** An owner with 3 stores already sees all 3 in small multiples. A 4-store multi-select is an analyst tool. Cut it from v1.

### Doc 02 — Data
- **5 new tables, some speculative.** `integration_accounts` + `store_integration_bindings` + `meta_insights_daily` are needed. `meta_async_jobs` and its polling cron and state machine are only justified by a 90d ad-level backfill the owner has not asked for — defer until a real request trips the 60s Vercel cap.
- **Dual-run migration is ceremonial in a solo shop.** Two weeks of dual-write for one production user reading one dashboard is overkill. A single cutover on a Tuesday morning with a rollback script is faster and honest.
- **Partial-results "1 of 3 loading" pill adds noise.** For an owner, "loading" is a spinner; "done" is a number. A per-account pill trains him to notice when one account is slow — analyst behaviour. Show the data when it's ready, one freshness dot, that's it.
- **FX table is premature.** All three stores are EUR today. Ship a `fx_rates_daily` stub (single-row EUR=1) and expand only when a non-EUR store lands. Don't build the view join now.

### Doc 03 — Agents
- **"60% of portfolio questions" is a claim, not a measurement.** No data behind it. Ship `compare_stores`, instrument it, measure for a month, then decide whether map-reduce is ever needed.
- **Three agents for ~300 queries/day is over-structured.** One agent with 6-8 tools handles all of Trace A and B. `portfolio-intel` is a new endpoint for one trace (C) that happens weekly. Start with one agent; split only when routing ambiguity bites.
- **60% prompt-cache savings is optimistic.** Real hit rates fall off whenever the semi-static daily-context block ticks (every 5 min). Budget 30-40% savings, plan accordingly.
- **`invoke_store_agent` is a showcase, not a need.** "Should I scale ProteinBar or BG?" is answered by looking at frequency + ROAS in `compare_stores` output. No per-store reasoning sub-agent required for v1.

### Doc 04 — Novel
- **Idea A (dimensional) is a 2-3 month rewrite sold as aspiration.** Fine — but then do not put it on the same page as Idea E (a 3-day ship). They're not comparable.
- **Idea D (event log) buries webhook reliability.** "Webhooks drop; GA4 corrects historicals" is one line; in practice it's the whole project. Polar and Triple Whale built teams for this. A solo shop should not start here.
- **Idea C (generative UI) is 2027 maturity, not 2026.** The doc even admits "Vercel AI SDK UI is still churning." Cut entirely from the roadmap until schemas stabilize.
- **Idea E (small multiples) is the only ship-now item** and it quietly invalidates doc 01's aggregate-first default. That contradiction should be resolved in the owner's favour: small multiples.

## 3. Business-owner lens (does each proposal shorten time-to-insight?)

- URL-scoped `/ads/bg` — **lengthens** (he's not sharing URLs, he's opening the app).
- `⌘K` store switch — **lengthens** on mobile; neutral on desktop.
- All-stores aggregate default — **lengthens** when a single store regresses (hidden in the sum).
- Small multiples (3 stacked cards) — **shortens**. Eye finds the red sparkline in <2s.
- Freshness dot on every card — **shortens**. Trust is latency.
- `compare_stores` tool — **shortens**. One agent call, one answer.
- `portfolio-intel` map-reduce — **lengthens** (12s latency, $0.08). Not a morning-on-the-phone tool.
- Stripe chrome recolor — neutral.
- Event-log push architecture — **shortens render** but **lengthens delivery by ~6 weeks**. Defer.
- Generative UI — **lengthens** (non-determinism is mental tax).
- Dual-run migration — neutral for owner, lengthens delivery.

## 4. Contradictions between docs

1. **Aggregate default.** Doc 01 §3 strongly argues "default to All stores." Doc 04 Idea E rejects aggregation outright ("portfolio view is not a summed KPI card"). Both can't be the landing page. Owner-first pick: **small multiples, no aggregate sum.**
2. **Store as container vs dimension.** Doc 02 designs `store_integration_bindings` as a first-class container. Doc 04 Idea A says "store is just a dimension." If A ever lands, 02's schema needs a partial rewrite. Ship 02 knowing A is a later refactor, not a blocker.
3. **Agent count vs simplicity.** Doc 03 insists "three agents, not six" as simplification; doc 04 Idea B implies one Cmd-K LLM should handle everything. For v1 one endpoint is enough — ship one agent with tools, add a router only if signal emerges.

## 5. Shortest-path-to-insight counter-proposal (v1)

One route: `/dashboard`. Above the fold on a 375px phone:

1. One vertical stack of 3 store cards (BG, GR, RO). Each card: today's revenue, spend, ROAS, plus a 7-day sparkline. A colored dot (green/amber/red) for "vs last week."
2. One fresh-as-of timestamp at the top. If any store is stale, amber dot on that card only.
3. One Ask button → text box → single agent with `list_stores`, `get_ads_overview`, `get_shopify_revenue`, `compare_stores`, `explain_delta`. No router, no portfolio agent, no `invoke_store_agent`.

Data: ship `integration_accounts` + `store_integration_bindings` + `meta_insights_daily` + nightly cron. Skip `meta_async_jobs`, FX view, compare route, ⌘K, chrome recolor, generative UI, event-log architecture.

Three days of work, not three months. Add complexity only when a specific owner question proves the current surface can't answer it.
