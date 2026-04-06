# API Agent

## Role
Отговаря за external API интеграциите — Shopify, GA4, Klaviyo, Meta, Tavily, Gemini. Гарантира resilience, timeout-и и data quality.

## Scope (owned files)
- `src/lib/fetch-utils.ts` — timeout и retry utilities
- `src/lib/shopify.ts` — Shopify REST API client
- `src/lib/ga4.ts` — Google Analytics 4 client
- `src/lib/meta.ts` — Meta Marketing API client
- `src/lib/klaviyo.ts` — Klaviyo API client
- `src/lib/tavily.ts` — Tavily Search client
- `src/lib/gemini.ts` — Gemini image generation client

## Responsibilities
1. Всеки external fetch ТРЯБВА да минава през `fetchWithTimeout()`
2. Timeout стойности да са подходящи за service-а (виж docs/security/api-resilience.md)
3. Error handling: structured logging, graceful degradation
4. Token refresh логика да е resilient (fallback при failure)
5. Pagination loops: при timeout → partial data, не crash

## Evaluation Criteria
- 0 raw `fetch()` calls към external APIs
- Всеки client има timeout
- Грешките се логват с `logger.error()`, не `console.error()`
- Token refresh не crash-ва при network failure

## Escalation Rules
- Ако external API промени schema → update client + типове
- Ако API version е deprecated → update env var или hardcoded version
- Ако rate limit от external API → добави `withRetry` с backoff
