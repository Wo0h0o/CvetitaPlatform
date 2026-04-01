@AGENTS.md

# Cvetita Command Center — Development Guide

## Development Principles

### 1. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- If it doesn't look like something you'd proudly demo to a client, it's not done

### 2. Mobile First (Always)
- Design for 375px first, then scale up with `md:` and `lg:`
- Touch targets: 44px min. flex-wrap and overflow-x-auto for overflow
- Test mobile layout before committing any UI change

### 3. KISS
- One purpose per screen. No premature abstractions. No feature creep
- When choosing between two approaches, pick the simpler one

### 4. Ship > Perfect
- Get it working, get feedback, iterate. A deployed feature beats a perfect mockup
- "Done" = deployed and verified, not "I think it's ready"

### 5. Real Data Only
- Every number on screen must trace to a real API call. Never mock in production
- If an API is down, show a clear error — not stale/fake data

### 6. AI Sees Everything
- The superpower: AI with cross-platform context. Always feed it the full business picture
- Every new integration makes the AI smarter, not just the dashboard fuller

### 7. Progressive Disclosure
- Summary first, details on demand. KPI → drill-down, not 50 metrics on one screen

### 8. Graceful Degradation
- Each integration is independent — one failure doesn't cascade
- Loading states (Skeleton), error states, empty states — design all three

## What This Is

A unified AI-powered business Command Center for Cvetita Herbal. Replaces fragmented dashboards (Shopify, GA4, Klaviyo, Meta Ads, etc.) with one interface + AI that sees the entire business context.

## Quick Start

```bash
npm run dev        # Dev server on :3000
npm run lint       # ESLint (next lint)
npm run typecheck  # TypeScript strict check
npm run build      # Production build
```

## Architecture

- **Next.js 15.5** (App Router) + **TypeScript** + **Tailwind CSS 4**
- **Vercel** for hosting (auto-deploy from GitHub on push to `main`)
- **GitHub Actions CI** — lint + typecheck + build on every PR/push
- **No database** — real-time API pulls from Shopify, GA4, Klaviyo, Claude
- **Auth:** NextAuth with password-based login

## Key Directories

```
src/app/(dashboard)/     # Protected pages (Dashboard, Products, Traffic, Email, etc.)
src/app/api/             # Backend API routes (serverless)
src/components/layout/   # Shell, Sidebar (mobile drawer), TopBar (burger menu)
src/components/shared/   # Reusable: PageHeader, Card, Button, Badge, DateRangePicker
src/components/dashboard/# KPI cards, TopProducts, NewsFeed, MarketPulse
src/lib/                 # API clients: shopify.ts, ga4.ts, klaviyo.ts, auth.ts, prompts.ts
src/hooks/               # useDateRange (URL-based state)
src/providers/           # DataProvider (SWR prefetch with loading screen)
```

## Design System

- CSS vars in `globals.css`: `--accent: #22c55e`, `--bg`, `--surface`, `--text`
- Dark mode: `.dark` class on `<html>`, full color system
- Layout: Sidebar (260px / 72px collapsed) + TopBar (56px) + content (max 1400px)
- Mobile: burger menu → slide-in drawer, responsive grids, scroll tables
- Breakpoints: mobile-first, `md:` = 768px, `lg:` = 1024px
- Every page uses `<PageHeader title="...">` with optional filter slot

## Conventions

- Page titles are in `<PageHeader>`, NOT in TopBar
- Date filters go inside `<PageHeader>` on pages that need them (Products, Traffic, Email)
- Use `useDateRange()` hook for date filtering — persists in URL params
- Use `useSWR()` for data fetching with `revalidateOnFocus: false`
- API routes return JSON, handle errors gracefully with fallback messages
- Env vars are in Vercel dashboard, `.env.local` for local dev — never commit secrets

## Before Every Change

1. Read the files you're modifying
2. Follow existing patterns (component structure, naming, Tailwind usage)
3. Run `npm run lint` and `npm run typecheck` before committing
4. Commit with clear messages, push to trigger CI + Vercel deploy

## Integrations (env vars in Vercel)

| Service | Lib | Status |
|---------|-----|--------|
| Shopify GraphQL | `src/lib/shopify.ts` | Active |
| GA4 (OAuth) | `src/lib/ga4.ts` | Active |
| Klaviyo (OAuth) | `src/lib/klaviyo.ts` | Active |
| Claude API | `@ai-sdk/anthropic` | Active |
| Tavily Search | `src/lib/tavily.ts` | Active |
| Meta Ads | — | Not yet |
| Google Ads | — | Not yet |
