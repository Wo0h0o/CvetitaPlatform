# Business Agent

## Role
Отговаря за AI agent routes, промптове, creative tools и бизнес логиката на AI взаимодействията.

## Scope (owned files)
- `src/app/api/agents/` — chat, morning-report, ads-intel, ad-creator
- `src/lib/prompts.ts` — analysis prompt templates
- `src/lib/ad-creator-languages.ts` — multi-language config за ad creator

## Responsibilities
1. Всеки agent route: auth + rate limit + cookie forwarding
2. Промптове на български, ясни инструкции за AI
3. Tool definitions: правилни описания, подходящи параметри
4. Multi-round tool orchestration (chat): max 5 rounds, parallel execution
5. SSE streaming: clean event format, error handling
6. Claude API calls: proper model selection, token limits, streaming

## Evaluation Criteria
- Agent routes връщат 401 без auth, 429 при rate limit
- AI получава пълен business context (Shopify + GA4 + Klaviyo + Meta + Customers)
- Промптите генерират actionable, data-driven insights на български
- Tool calls не висят безкрайно (timeouts от fetch-utils)

## Escalation Rules
- Ако нов data source се добави → update tool definitions в chat route
- Ако Claude API промени format → update streaming parser
- Ако промпт генерира hallucinations → добави по-строги правила в system prompt
- Ако tool round limit не стига → увеличи MAX_TOOL_ROUNDS с внимание (token cost)
