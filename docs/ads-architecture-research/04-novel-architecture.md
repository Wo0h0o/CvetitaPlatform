# 04 — Novel Architecture: Speculative Provocations

> **Role:** Speculative product architect. Three other agents handle UX patterns, data architecture, and AI agents. This doc deliberately pushes against the default paradigm.

---

## 1. Core Provocation

**The assumption most worth challenging: that "store" is a top-level container at all.**

Every competitor (Triple Whale, Motion, Varos, Glew, Polar) treats a store as a *first-class namespace* — you log in, you pick a store (or "All Stores"), then you see its dashboard. This is a direct port of Shopify's own mental model, inherited from 2013-era SaaS. It is lazy.

For Cvetita the *real* atomic unit is a **product-market-channel triple**: "Neven Forte × Greece × Meta." A store is just one projection of that triple. The sub-brand ProteinBar vs. Cvetita distinction, the BG/GR/RO market distinction, the Meta vs. GA4 vs. Klaviyo distinction — these are all *dimensions*, not containers. Treating them as containers is what forces 6 ad accounts into 6 tabs and makes cross-store analysis a feature request instead of the default.

**If store_id is just a dimension on every row of the event log, the entire "store switching" UX evaporates.** What replaces it is a slicing grammar: the same grammar Tableau, Looker Studio, and Hex use for every other analytical problem.

---

## 2. Five Concrete Novel Ideas

### Idea A — Dimensional, not Containered (Tableau-style slicing)
- **Inspiration:** Google Analytics 4 "Explorations," Tableau, Hex. GA4 already proved that treating `property_id` as a filter (not a login scope) scales to massive portfolios.
- **For Cvetita:** Every metric row in Supabase carries `brand`, `market`, `store_id`, `channel`, `product_id`, `campaign_id` as first-class dimensions. The homepage is a single pivot-table-ish surface with pinnable slices. "Cvetita GR" is a saved filter, not a route.
- **MVP slice (1 week):** One page — `/explore` — with a filter bar (Brand, Market, Store, Channel, Date) and three default charts (Revenue, Spend, ROAS) that re-render on filter change. Kill the per-store dashboards for a week and see if anyone misses them.
- **Risk:** Power-user feel may alienate non-analyst stakeholders. Mitigation: ship curated "Views" (saved filter + chart bundles) as the default landing — the grammar is underneath, not in your face.

### Idea B — Command Palette as Primary Interface
- **Inspiration:** Linear, Raycast, Superhuman, Arc's Cmd-T. Linear specifically proved that a SaaS tool can make Cmd-K the *primary* interface with menu navigation as the fallback, not the inverse.
- **For Cvetita:** Cmd-K opens a natural-language prompt that routes to either (a) a canned query ("GR ads 7d") or (b) an LLM that generates SQL against Supabase and renders a chart inline. The "page" is ephemeral — generated on demand, pinnable if you want to keep it.
- **MVP slice (1 week):** Cmd-K component with ~20 hardcoded intents ("compare {storeA} vs {storeB} on {metric}, last {N}d"). LLM fallback disabled for v1. Measure: what % of page visits come from Cmd-K vs. sidebar in week 2?
- **Risk:** Discovery. Users don't know what to type. Fix: inline example chips and a visible command log.

### Idea C — Generative UI Dashboards (AI-composed views)
- **Inspiration:** Vercel AI SDK's `generative UI`, v0, Thesys/Crayon, Tambo AI. Tinybird + Thesys has a public demo of analytics dashboards generated from a prompt. CopilotKit ships a declarative-schema pattern production-ready.
- **For Cvetita:** Instead of coding a page per integration, the LLM returns a structured layout spec (e.g. JSON describing a grid of `<KpiCard>`, `<Sparkline>`, `<SmallMultiples>`) which the client renders from a whitelisted component library. User says "weekly landing page view by market with conversion overlay" → a page appears.
- **MVP slice (1 week):** 8-10 whitelisted components, a layout-spec JSON schema, one LLM call that fills it. Ship it as a `/lab` route, not replacing anything.
- **Risk:** Quality variance. Hallucinated charts are worse than no charts. Guardrail: schema validation + human-readable "data contract" (columns the LLM is allowed to reference).

### Idea D — Event Log as the Source of Truth (push, not pull)
- **Inspiration:** Segment's customer data platform, ClickHouse/Tinybird event architectures, Supabase + Inngest patterns. Motion and Triple Whale both ingested-and-normalized-to-warehouse under the hood; the difference is UX, not infra.
- **For Cvetita:** Meta + Shopify webhooks + GA4 intraday export → Inngest/Trigger.dev → Supabase event table (`events(ts, source, store_id, payload_jsonb)`). Dashboard never calls Meta Graph API at render time — it reads a denormalized materialized view. Latency 1-5 min, but UI is instant and consistent.
- **MVP slice (1 week):** Shopify orders webhook → Supabase table → one "Real-time orders" strip on the dashboard. Prove the pipe, then add Meta.
- **Risk:** Backfill and reconciliation. Webhooks drop; GA4 corrects historical data. Mitigation: nightly reconciliation job + a "stale until" column on every metric.

### Idea E — Small Multiples Everywhere (no "All Stores" roll-up)
- **Inspiration:** Edward Tufte's small multiples; Observable Framework's grid-of-sparklines dashboards; Apple Stocks widget pattern.
- **For Cvetita:** The "portfolio" view is not a summed KPI card. It's a 3-column grid (BG, GR, RO) of identical mini-dashboards. Eye catches the anomaly pre-cognitively — no aggregation math needed. Same at brand level: Cvetita vs. ProteinBar side-by-side.
- **MVP slice (3 days):** Replace the current "All Stores Revenue" number with a 3-up sparkline strip. Ship behind a toggle.
- **Risk:** Screen real estate on mobile. Acceptable — this is desktop-first analytics.

---

## 3. Ranked Shortlist

**Ship in the next 3 months:**
1. **Idea E — Small Multiples** (3-day ship, immediate pattern-recognition value, zero new infra). Low-risk way to re-educate users that "portfolio" ≠ "sum."
2. **Idea D — Event Log Push Architecture** (unglamorous but foundational). Every other idea on this list gets cheaper and faster if D lands first. Triple Whale's moat is their warehouse, not their charts.

**Mark for later (3-9 months):**
3. **Idea B — Command Palette** (needs A or D underneath to be powerful; premature without a consistent data model to query).
4. **Idea C — Generative UI** (real but hype-heavy; wait until the layout-spec schema in the ecosystem stabilizes — Vercel AI SDK UI is still churning in 2026).
5. **Idea A — Full Dimensional Refactor** (philosophically correct, organizationally expensive — a 2-3 month rewrite, not a weekend. Do this when a second private-label SaaS customer forces the issue).

---

## 4. Anti-Patterns (Evaluated and Rejected)

- **"Figma-like spatial canvas for dashboards"** (Frame 7). Cute, but analytics is not a design tool — repeated side-by-side with drag-pin is just a worse version of small multiples. Users don't want spatial memory; they want fast defaults.
- **"No sidebar, context-aware nav"** (Frame 9). Inferring nav from behavior sounds smart; in practice every product that tried it (Google Inbox, early Arc) confused users. Discoverability wins over cleverness.
- **"Everything is one AI chat with a card sidebar"** (Frame 10). Dust.tt and Glean tried this shape for enterprise search. Works for Q&A, fails for monitoring — you can't "chat at" a 24/7 anomaly feed. Chat is a tool, not the shell.
- **"AI continuously watching and surfacing a newsfeed of anomalies"** (Frame 6). Not rejected, but deferred — this is an *AI agents* concern, already owned by another research agent. Don't duplicate.

---

## 5. The Moat Question

Of the five ideas, **D (event log) + A (dimensional model)** together are the only combination Triple Whale / Motion / Varos would find genuinely hard to copy — not because the tech is novel, but because it would force them to rewrite their ingestion layer and re-explain their pricing model to a 20k-customer install base. Their moat becomes our moat-inverter.

**B, C, E are features.** Competitors can ship any of them in a quarter. They're good *product*, but not *defensibility*.

The real moat, honestly, is **owning the end-to-end content → ad → store → analytics loop for Bulgarian herbal ecommerce** — the data and the domain, not the dashboard. The architecture should serve that loop, not pretend it's a generic analytics tool.

---

**Sources:**
- [CopilotKit — Developer's Guide to Generative UI in 2026](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)
- [Tinybird — Generative analytics UI with Thesys](https://www.tinybird.co/blog/generative-analytics-ui-with-tinybird-and-thesys)
- [Triple Whale — Data Platform architecture](https://www.triplewhale.com/data-platform)
- [Triple Whale — January 2026 product updates](https://www.triplewhale.com/blog/triple-whale-product-updates-january-2026)
- [Untitled UI — 16 Best React Dashboards in 2026](https://www.untitledui.com/blog/react-dashboards)
