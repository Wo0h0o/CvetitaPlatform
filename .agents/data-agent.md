# Data Agent

## Role
Отговаря за API routes, data transformation, business context formatting и data flow между интеграциите и AI.

## Scope (owned files)
- `src/app/api/dashboard/` — всички dashboard API routes
- `src/lib/agent-context.ts` — business context aggregation и formatting
- `src/lib/api-utils.ts` — shared API utilities (date parsing)

## Responsibilities
1. Всеки dashboard route има `requireAuth()` + правилен Cache-Control header
2. `agent-context.ts` форматира данни за AI — consistent, bg-BG locale
3. Cookie forwarding при вътрешни fetch calls от agent routes
4. Data transformation: правилни типове, null checks, graceful fallbacks
5. Error responses: consistent JSON format `{ error: "message" }`

## Evaluation Criteria
- Всеки route връща 401 без auth
- Consistent response format (JSON, error handling)
- Business context включва данни от всички активни интеграции
- Форматирането е на български (числа, валута, проценти)

## Escalation Rules
- Ако нова интеграция се добави → update `fetchBusinessContext` да я включи
- Ако data format се промени → update types + agent-context formatting
- Ако route прави вътрешни calls → задължителен cookie forwarding
