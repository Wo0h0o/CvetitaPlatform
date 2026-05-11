# Per-Competitor Page — Manual Smoke Test

Run these steps in a real browser session against production (or `npm run dev` locally) to verify the feature end-to-end. Each step has a clear pass/fail signal.

## Setup
- Make sure you are logged in as a member of the **Цветита Хербал** organization
- Have at least one competitor with scanned products (Gymbeam recommended — 40 products, 89 historical scans)

## Test 1 — Slug-based navigation
1. Open `/competitors`
2. **Expected:** see at least Gymbeam + Vemoherb cards
3. Click on the Gymbeam card body (NOT on Scan or Ad Library button)
4. **Pass:** URL is `/competitors/gymbeam` and you land on the detail page
5. Click „Всички конкуренти" link in hero
6. **Pass:** Back at `/competitors`

## Test 2 — Hero strip
7. On `/competitors/gymbeam`:
8. **Expected:** Name, domain link (`gymbeam.bg`), category badge, markets row (likely 🇧🇬 BG after first scan), last-scan timestamp, [Ad Library] + [Сканирай] buttons

## Test 3 — Overview tab
9. **Expected:** 4 KPI tiles — `Tracked продукти` / `Налични в склад` / `Mapped към наши` / `Непрочетени промени`
10. **Expected:** Markets card — flag chips per detected market; sister-domains list if any
11. **Expected:** „Последни tracked продукти" with up to 8 rows; external-link icon opens competitor product page

## Test 4 — Trigger a fresh scan
12. Click „Сканирай" button in hero
13. **Pass:** Toast „Сканирани N продукта" within ~30 seconds
14. **Pass:** Hero's last-scan timestamp refreshes to „току-що"
15. **Pass:** Markets in hero/overview may have populated from homepage hreflang

## Test 5 — Catalog Map tab — manual mapping
16. Click tab „Каталогна карта"
17. **Expected:** counter pills (e.g. „0 mapped / 40 unmapped")
18. **Expected:** Each row shows competitor product + ❌ „Свържи" button on the right
19. Click „Свържи" on any row
20. **Expected:** Modal opens, top section shows the selected competitor product (name + price)
21. On „Търси в каталог" tab: type 2+ chars (e.g. „магнезий")
22. **Pass:** Within 300ms results appear from our Shopify catalog
23. Click one of the results
24. **Pass:** Row highlights in green with a check mark
25. Click „Запази"
26. **Pass:** Modal closes; same row now shows ✅ + our product name + our live price + diff% badge (red if we're more expensive, green if cheaper)

## Test 6 — Catalog Map tab — AI suggest
27. Click „Свържи" on another unmapped row
28. Switch to „AI предложи" tab in the modal
29. Click „Предложи"
30. **Expected:** Loader for ~5-15s
31. **Pass:** Up to 3 suggestion cards rendered, each with title + reasoning (Bulgarian) + confidence %
32. Click one suggestion → it highlights → click „Запази"
33. **Pass:** Row shows ✅ + Sparkles icon (indicating ai_suggested origin)

## Test 7 — Unmap
34. Click the 🔗⃠ unlink icon on a mapped row → confirm
35. **Pass:** Row reverts to ❌ unmapped state

## Test 8 — Live diff updates
36. Map a product where you can see both competitor + our price clearly
37. **Expected diff math:** `diff% = ((ourPrice - theirPrice) / theirPrice) × 100`, rounded to nearest int
   - Positive (red) → we're more expensive
   - Negative (green) → we're cheaper
38. **Pass:** Math is correct against rendered prices

## Test 9 — Persistence
39. Refresh page (F5)
40. **Pass:** Mapped rows survive the refresh

## Test 10 — RLS isolation (admin only)
41. Log out, log in as a different member (e.g. office@cvetitaherbal.com)
42. Open `/competitors/gymbeam`
43. **Pass:** Same mappings visible — confirming shared org visibility (not user-scoped)

## Known v1 limitations
- Markets only populated after a fresh scan (existing scans before migration 023 did not capture markets)
- No Price Timeline tab yet (v2)
- No Change Log tab yet (v2)
- AI Suggest costs ~$0.05-0.10 per call (Claude Opus 4.6)
