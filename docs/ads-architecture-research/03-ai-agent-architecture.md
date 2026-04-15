# 03 — AI Agent Architecture for Multi-Store Cvetita

## 1. The core trade-off

Every multi-tenant agent design sits on one axis: **context breadth vs. reasoning focus**. Stuff all stores into one prompt and the model drowns (hallucinations, $$$, 40s latency). Spin up a store-scoped agent per request and you lose cross-store reasoning ("which store deserves the next €1k?"). The elegant answer is not more agents — it is **one reasoning agent, many scoped tools, and a map-reduce escape hatch for portfolio questions**. Anthropic's own research system showed 90.2% improvement using Opus-as-lead + Sonnet-as-workers, but only because the lead could delegate; 95% of our queries never need delegation.

## 2. Recommended topology

```
                 ┌────────────────────────────────┐
                 │      Router (Haiku 4.5)        │  (optional, cheap intent classifier)
                 │  single-store? portfolio? RAG? │
                 └──────────────┬─────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
  ads-intel (1 store)    portfolio-intel (N)     market-intel (web)
   Sonnet 4.6             Opus 4.6 + map-reduce    Opus 4.6 + Tavily
    (today)                   (new)                 (today)
        │                       │
        └──────── shared tool layer ────────┐
                                            ▼
                                 ┌──────────────────────┐
                                 │  Scoped tool server  │  (lib/tools/*)
                                 │  meta.*  shopify.*   │
                                 │  ga4.*   klaviyo.*   │
                                 │  — every tool takes  │
                                 │    store_id          │
                                 └──────────────────────┘
```

**Three agents, not six.** `ads-intel` stays single-store (most questions are). `portfolio-intel` is the new one — it owns the map-reduce pattern for cross-store questions. `market-intel` is unchanged. The Router is optional; for now, the UI dispatches explicitly ("Ask about which store?"). When we add the Router, it is Haiku 4.5, ~$0.001 per query, and it picks which of the three agents handles the turn.

**Portfolio-intel internals.** When invoked, it does not itself call Meta/Shopify. It emits N parallel `Task`-style sub-invocations of `ads-intel` (one per store), collects structured JSON summaries, then synthesizes. Sub-invocations use Sonnet 4.6 (cheaper, faster, plenty for summarizing one store's data). The synthesizer uses Opus 4.6. Identical to Anthropic's orchestrator-worker pattern.

## 3. Tool design (Anthropic tool-use JSON)

Every tool takes an explicit `store_id` — the model picks it, not the client. The registry maps `store_id → {meta_account_id, shopify_domain, ga4_property, klaviyo_pk}` server-side so the LLM never sees credentials.

```jsonc
// 1
{ "name": "list_stores",
  "description": "Return all stores the user has access to with country, brand, status.",
  "input_schema": { "type": "object", "properties": {}, "required": [] } }

// 2
{ "name": "get_ads_overview",
  "description": "Meta Ads KPIs (spend, revenue, ROAS, CPA, CTR) for one store.",
  "input_schema": { "type": "object",
    "properties": {
      "store_id": { "type": "string", "enum": ["cvetita-bg","cvetita-gr","proteinbar","ina"] },
      "date_range": { "type": "string", "enum": ["today","last_7d","last_28d","last_90d"] }
    }, "required": ["store_id","date_range"] } }

// 3
{ "name": "get_ads_breakdown",
  "description": "Campaign + ad-level insights with scoring. Costly — call only when drilling down.",
  "input_schema": { "type": "object",
    "properties": {
      "store_id": { "type": "string" },
      "date_range": { "type": "string" },
      "level": { "type": "string", "enum": ["campaign","adset","ad"] },
      "limit": { "type": "integer", "default": 20 }
    }, "required": ["store_id","date_range","level"] } }

// 4
{ "name": "get_ga4_traffic",
  "description": "Sessions, users, conversions split by channel/landing page.",
  "input_schema": { "type": "object",
    "properties": { "store_id":{"type":"string"}, "date_range":{"type":"string"},
                    "dimension":{"type":"string","enum":["channel","landingPage","device","country"]} },
    "required": ["store_id","date_range","dimension"] } }

// 5
{ "name": "get_shopify_revenue",
  "description": "Orders, AOV, revenue, top products for a store.",
  "input_schema": { "type": "object",
    "properties": { "store_id":{"type":"string"}, "date_range":{"type":"string"} },
    "required": ["store_id","date_range"] } }

// 6
{ "name": "compare_stores",
  "description": "Portfolio primitive. Returns one metric across all stores in a single call — use instead of N individual calls.",
  "input_schema": { "type": "object",
    "properties": {
      "metric": { "type": "string", "enum": ["roas","cpa","ctr","revenue","orders","aov"] },
      "source": { "type": "string", "enum": ["meta","shopify","ga4"] },
      "date_range": { "type": "string" },
      "store_ids": { "type": "array", "items": { "type": "string" } }
    }, "required": ["metric","source","date_range"] } }

// 7
{ "name": "explain_delta",
  "description": "Drill-down: why did this metric change between two periods? Returns top contributing campaigns/ads/segments.",
  "input_schema": { "type": "object",
    "properties": { "store_id":{"type":"string"}, "metric":{"type":"string"},
                    "period_a":{"type":"string"}, "period_b":{"type":"string"} },
    "required": ["store_id","metric","period_a","period_b"] } }

// 8
{ "name": "invoke_store_agent",
  "description": "Used only by portfolio-intel. Spawn a single-store sub-agent and await its JSON summary.",
  "input_schema": { "type": "object",
    "properties": { "store_id":{"type":"string"}, "question":{"type":"string"} },
    "required": ["store_id","question"] } }
```

Key point: `compare_stores` is the anti-fan-out primitive. It answers 60% of portfolio questions with one SQL-like pre-aggregated call, skipping the map-reduce entirely. Only use `invoke_store_agent` when the question requires *reasoning* per store, not just numbers.

## 4. Context strategy — what caches, what streams

Anthropic prompt caching has a 5-minute TTL (or 1 hour with `ttl="1h"`) and hits **Tools → System → Messages** in that order. We exploit it aggressively:

| Layer | Content | Cache TTL | Size |
|---|---|---|---|
| **Tools block** | All 8 tool JSON schemas | 1h | ~2k tokens |
| **System — static** | Role, brand rules, tone, scoring system v2, store registry | 1h | ~3k tokens |
| **System — semi-static** | Daily business context (yesterday's revenue, weekly baselines) | 5m | ~1k tokens |
| **System — dynamic** | Current date, user's active store filter | none | ~100 tokens |
| **Messages** | Conversation + freshly fetched tool results | none | variable |

Place cache breakpoints at the end of the 1h block and the end of the 5m block (max 4 breakpoints per request). Every follow-up question in the same session re-uses ~5k cached input tokens at ~10% of full cost. **This is the single biggest cost lever** — more than model choice.

What stays out of the prompt entirely: raw ad creatives, full campaign lists, GA4 event-level data. Those come in via tool calls, scoped and paginated, only when needed. Raw numbers live in the tool result, not the system prompt. The 1M context window is a safety net, not a loading dock.

RAG is **not** used for numbers — it is the wrong tool for time-series. It is used for one thing: retrieving prior agent answers / weekly briefs from a Postgres `agent_memory` table, so the agent remembers "last week we paused ad X because frequency was 6.2." That lookup is a tool call, not an auto-injected context block.

## 5. Three end-to-end traces

### Trace A — "What's my Meta ROAS across all stores this week?"

1. UI sends message to `/api/agents/portfolio-intel` (or Router routes there).
2. Opus 4.6 with tools. System prompt cached (1h hit). Opus calls `compare_stores({metric:"roas", source:"meta", date_range:"last_7d"})`.
3. Tool server fans out internally: 4 parallel Meta API calls, pre-aggregates to `{store_id, roas, spend, revenue}[]`. ~800ms.
4. Opus writes 2-paragraph comparison with ranking + one-line recommendation.
5. **No sub-agents spawned.** 1 LLM turn, 1 tool call.
   **Latency:** ~3s. **Cost:** ~$0.02 (cached input + ~400 output tokens).

### Trace B — "Why did GR CTR drop on Tuesday?"

1. Routes to `ads-intel` with `store_id=cvetita-gr` (single-store).
2. Sonnet 4.6. Calls `explain_delta({store_id:"cvetita-gr", metric:"ctr", period_a:"2026-04-07", period_b:"2026-04-14"})`.
3. Tool returns top 3 campaigns with worst delta + a creative-level breakdown.
4. If the answer needs landing-page context, Sonnet calls `get_ga4_traffic({dimension:"landingPage"})`.
5. Sonnet synthesizes. **Latency:** ~6s. **Cost:** ~$0.015.

### Trace C — "Should I increase spend on ProteinBar or Cvetita BG?"

1. Routes to `portfolio-intel` — this is a *judgment* call, not a lookup.
2. Opus calls `compare_stores` for ROAS + CPA + spend.
3. Seeing the two are close, Opus calls `invoke_store_agent` twice in parallel: "What's the headroom on ad creative fatigue?" (one per store).
4. Each sub-agent (Sonnet) pulls frequency, audience saturation, creative freshness score, returns a 150-word JSON summary.
5. Opus synthesizes: "ProteinBar — lower frequency, newer creatives, ceiling higher. Scale there."
   **Latency:** ~12s (dominated by parallel sub-agents). **Cost:** ~$0.08. **This is the only trace that needs map-reduce.**

## 6. Cost & latency

| Query class | Agents | LLM cost | Latency |
|---|---|---|---|
| Single-store factual | 1 × Sonnet | ~$0.01 | 2–4s |
| Single-store drill-down | 1 × Sonnet (2 tool calls) | ~$0.02 | 5–8s |
| Portfolio factual (compare_stores) | 1 × Opus | ~$0.02 | 3–5s |
| Portfolio judgment (map-reduce) | 1 × Opus + N × Sonnet | ~$0.08 | 10–15s |
| Daily morning brief (all stores) | 1 × Opus + 4 × Sonnet (nightly cron) | ~$0.15 | 30s (async) |

Expected blended cost at ~300 queries/day: **~$8/day**, dominated by morning brief. Prompt caching cuts this by roughly 60%.

## 7. What NOT to build (and why)

- **One Opus agent per store** (6 agents, 6 endpoints). Rejected: duplicates system prompts, no shared caching, impossible to ask portfolio questions without a meta-orchestrator. The store-ness belongs in the *tool parameter*, not the *agent identity*.
- **One monolith "cvetita-agent" with every tool.** Rejected: system prompts would balloon (role conflicts between "be a market researcher" and "be an ads optimizer"), and tool choice under 20+ tools degrades measurably. Three agents with 6–8 tools each is the sweet spot.
- **Auto-inject all stores' KPIs into every system prompt.** Rejected: 10k tokens of mostly-irrelevant data per turn, breaks caching whenever *any* number updates.
- **Per-store vector DB / RAG over ad copy.** Rejected for now — premature. When we hit 10k+ ads, revisit. Today, SQL over Meta insights is faster and exact.
- **LangGraph / AutoGen framework.** Rejected: adds a heavy runtime for what is 3 endpoints + a shared tool module. Anthropic's raw tool-use API plus `Promise.all` in a Next.js route is ~200 lines of code and zero new dependencies. We stay on the native SDK.
- **Hard-coded `account_id` in tools.** Rejected (explicit anti-pattern). Every tool takes `store_id`, server-side registry resolves credentials. This is the difference between a 6-week multi-store migration and a 2-day one.

---

**Sources:**
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Anthropic — Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic — Prompt caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [LangGraph supervisor + map-reduce patterns](https://aipractitioner.substack.com/p/scaling-langgraph-agents-parallelization)
- [Multi-tenant agent infrastructure that scales](https://medium.com/@vamshidhar.pandrapagada/how-to-deploy-multi-tenant-ai-agent-infrastructure-that-actually-scales-433f44515837)
- [AWS — Tenant isolation with Bedrock Agents](https://aws.amazon.com/blogs/machine-learning/implementing-tenant-isolation-using-agents-for-amazon-bedrock-in-a-multi-tenant-environment/)
