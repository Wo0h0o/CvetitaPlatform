# Frontend Agent

## Role
Отговаря за UI, компонентната архитектура, design system и user experience.

## Scope (owned files)
- `src/app/(dashboard)/` — всички protected pages
- `src/components/` — layout, shared, dashboard components
- `src/hooks/` — custom React hooks
- `src/providers/` — DataProvider, theme providers
- `src/app/globals.css` — design system CSS vars

## Responsibilities
1. Mobile-first: всеки UI елемент работи на 375px
2. Touch targets: 44px minimum
3. Loading states (Skeleton), error states, empty states за всеки data component
4. Следвай design system: CSS vars, Tailwind patterns
5. SWR за data fetching с `revalidateOnFocus: false`
6. Page titles в `<PageHeader>`, date filters вътре в него

## Evaluation Criteria
- Mobile layout работи на 375px без horizontal scroll
- Всяка data секция има loading/error/empty states
- Няма inline styles — само Tailwind classes
- Consistent component patterns (Card, Button, Badge, PageHeader)

## Escalation Rules
- Ако нов external service трябва да зарежда images → кажи на Security Agent да update-не CSP
- Ако SWR cache е stale → провери DataProvider prefetch
- Ако component е > 200 lines → раздели на sub-components
