# 01 — UX for Multi-Store / Multi-Account Switching

_Research brief for the Cvetita Command Center Ads section (generalizes to Sales, Traffic, Email)._

---

## 1. Takeaways from studied products

- **Meta Ads Manager** — a dropdown of 100+ ad accounts, searchable by name or ID. _Works:_ persistent across sessions, fuzzy-search by ID. _Doesn't:_ no aggregation across accounts, losing which account you're in is the #1 agency pain point; third-party tools exist almost entirely to paper over this.
- **Google Ads MCC (Manager Accounts)** — a tree of accounts with a true "All accounts" aggregate view and per-account drill-down. _Works:_ aggregate-first is the default, labels let you slice by brand/region. _Doesn't:_ the UI density is hostile to non-experts.
- **Shopify Admin** — store switcher is a global dropdown in the top-left, opens each store in a fresh context (full reload, own sidebar). _Works:_ zero ambiguity about which store you're in — the chrome recolors. _Doesn't:_ no cross-store view at all; merchants with 3+ stores tab-hop.
- **Vercel** — team switcher in TopBar, URL-scoped (`/[team]/[project]`), Cmd-K jumps between teams/projects instantly. _Works:_ URL is the source of truth, shareable links, prefetched project list. _Doesn't:_ the scope indicator (breadcrumb) is small enough to miss.
- **Linear** — workspace switcher in sidebar header, Cmd-K has `Switch workspace…`. _Works:_ keyboard-first, tight hit target, recent workspaces float to top.
- **Stripe Dashboard** — account switcher in top-left, _colors the entire TopBar_ per test/live and per account color. _Works:_ the chrome itself signals context — no "which account am I in?" moments. Strong pattern for a brand with sub-brands.
- **GitHub / Cloudflare / PostHog / Notion** — all converge on the same pattern: top-left switcher, URL-scoped, searchable, with an optional "All organizations" aggregate (GitHub, PostHog) vs forced-pick (Cloudflare, Notion).
- **Plausible / Fathom** — small-N analytics; a simple site dropdown with per-site color dot. Minimal, fast, no aggregate. Fine for ≤5 sites, breaks down at 20+.

**Synthesis:** The consensus is _URL-scoped context + global switcher in the top chrome + Cmd-K_. Aggregation is the hard part — only Google Ads MCC, PostHog, and GitHub do it well, and all three make it a _first-class route_ (`/all`, `/dashboard`), not a toggle.

## 2. Proposed UX pattern for Cvetita

### Component hierarchy

```
Shell
├── Sidebar (260px)
│   └── [unchanged — navigation]
├── TopBar (56px)
│   └── [burger] [WorkspaceSwitcher] [breadcrumb] … [live] [cmd-k hint] [theme] [user]
└── Content
    └── Page scoped by `workspace` param in URL
```

`WorkspaceSwitcher` is a button showing the current scope with a small colored dot (bg: Bulgaria red, gr: Greek blue, ro: Romanian gold, all: brand green, proteinbar: orange). Click opens a command palette-style menu; `⌘K` anywhere opens the same menu with `Switch to…` preselected.

### URL structure (source of truth)

```
/ads                       → redirects to /ads/all (or last-used, see §Persistence)
/ads/all                   → aggregate, all Shopify-backed stores
/ads/bg    /gr    /ro      → single market
/ads/proteinbar            → separate brand, Meta-only (no Shopify)
/ads/compare?w=bg,gr       → side-by-side (≤4)
/ads/campaigns/:id         → always scoped; campaign belongs to exactly one account
```

Same `[workspace]` slug works for `/sales/[workspace]`, `/traffic/[workspace]`, `/email/[workspace]` — one mental model.

### Switcher menu contents (top → bottom)

1. `All stores` (aggregate, brand-green dot) — default for most pages
2. Shopify-backed markets: `Bulgaria`, `Greece`, `Romania` with flag + EUR / currency label
3. Sub-brands without Shopify: `ProteinBar` (Meta-only), muted label "ads only"
4. Divider
5. `Compare stores…` → opens multi-select, up to 4
6. Search input at top; fuzzy match on name, flag code, currency

### Mobile behavior

- TopBar too narrow at 375px to show a long workspace name. Switcher collapses to just the colored dot + chevron (44px touch target). Tap opens a bottom sheet with the same menu — native-feeling, thumb-reachable.
- Breadcrumb hides on mobile; the dot color is the only scope indicator (Stripe pattern).

### Keyboard shortcuts

- `⌘K` — universal palette with "Switch to…" as first action
- `⌘⇧1 / 2 / 3 / 4 / 0` — jump to BG / GR / RO / ProteinBar / All
- `⌘/` — focus search in switcher
- `g a` then `b` (vim-style) — "go to ads → bg" (optional, power users)

### Persistence

- **URL is canonical** — every shared link is reproducible.
- When the user lands on bare `/ads`, resolve in this order: (1) last-used workspace from a `cvetita_ws` cookie, (2) aggregate `/all` if the user has 2+ stores, (3) their single store if only one. Store last-used in Supabase `user_prefs` for cross-device continuity.
- Cookie never overrides an explicit URL — sharing `/ads/gr` always shows GR, regardless of recipient's last-used.

### Performance

- SWR keys include workspace: `['/api/ads/kpis', workspace, dateRange]`. No cross-workspace cache collisions.
- Prefetch the workspace list at Shell mount (tiny payload, rarely changes). Prefetch each workspace's KPI payload on hover/focus in the switcher — sub-100ms switch feel.
- Aggregate queries run per-account in parallel on the server, then reduce. Never block on the slowest account: show partial results with a "1 of 3 loading" pill.

## 3. Aggregate vs per-store — strong opinion

**Default to `All stores` on `/ads` and `/sales`. Default to single-store on drill-downs.**

Reasoning: the Command Center's thesis is _"AI sees everything"_ — if the default view is a single store, the aggregate is a hidden feature and the unique value proposition is buried. Google Ads MCC, PostHog, and (for internal Shopify merchants with 2+ stores) even Shopify's own "Analytics > Cross-store" all default to aggregate. Plausible/Fathom are the counter-example and they explicitly serve single-site users.

Caveat: on `/ads/campaigns` and `/ads/adsets`, a campaign belongs to exactly one ad account — aggregate is meaningless. These pages force a workspace pick (the switcher shows "Pick a store" if you arrived from `/all`).

## 4. Edge cases

- **ProteinBar (no Shopify store)** — lives in the switcher under a `Sub-brands` section with a muted "ads only" tag. Routes that need Shopify data (`/sales`, `/traffic` if GA4-linked) hide ProteinBar from their switcher; routes that don't (`/ads`, `/email` if Klaviyo exists) show it. Source of truth: a `capabilities: ['shopify','meta','ga4','klaviyo']` array per workspace in Supabase.
- **Duplicate BG accounts (old + new)** — _do not_ show both in the switcher. One is canonical (tagged `primary: true`); the other is accessible only inside `/ads/bg/settings/accounts` as "Legacy account (read-only history)". Aggregate queries union both for historical continuity, clearly labeled in the chart legend.
- **Personal USD account** — excluded from all workspace views by default (flag `hidden: true` in Supabase). Visible only under `/settings/accounts/all` for the admin. It is not a business workspace.
- **Future stores** — adding DE or PL is a Supabase insert plus a flag entry; no code change. The switcher enumerates from the DB. Write a seed/migration script now so this is a one-command op.

## 5. Risks and what to test

- **Risk: aggregate math is misleading across currencies.** All three Shopify stores are EUR, so this is OK _today_, but the moment a non-EUR store is added, the aggregate ROAS / revenue chart needs a currency-normalization layer. Test with a deliberately-toggled fake BGN store in staging.
- **Risk: the switcher dot color is the only mobile scope cue.** Test with 3–5 users on 375px: ask them "which store are you viewing right now?" after a mid-flow distraction. If >1 fails, add a text label back.
- **Risk: Cmd-K discoverability.** Ship a one-time toast on first `/ads/all` visit: "Tip: ⌘K to switch stores." Measure uptake in week 1.
- **Risk: last-used cookie fighting the URL.** Write a test: open `/ads/gr`, close tab, open `/ads` → must go to `gr`, not `all`. Open incognito → must go to `all`.
- **Risk: aggregate latency.** If the slowest Meta account takes 6s, the page feels broken. Partial-results UI (loading pill per account) is mandatory, not optional. Test with throttled network.
- **Risk: accidental cross-workspace action.** If in future we add write actions (pause campaign etc.), the switcher color must bleed into the action button (Stripe pattern) so the user sees _"Pause campaign in Bulgaria"_ is a BG-colored button, not a neutral one.

---

**Open questions for round 2:**
1. Should the aggregate include ProteinBar (different brand, different P&L) or stay Cvetita-only? Lean: Cvetita-only by default, with a `/ads/all?include=proteinbar` override.
2. Is there a case for a _portfolio view_ (all workspaces as cards on a single page, small-multiples style)? Linear and Vercel both ship this and it's unexpectedly useful for weekly reviews.
