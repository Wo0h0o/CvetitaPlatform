# Mobile UX & Interaction Audit — /sales

> Дата: 2026-05-21
> Scope: mobile (375 / 390 / 412 / 414 px). Hand-on-phone симулация на /sales след днешния chart-touch + scrubber + glass-popup рефактор.
> Цел: преди да копираме pattern-ите към /traffic /products /ads /email — да затегнем гайките там, където пукат.

---

## Executive summary

Pattern-ът „scrubber + chart-touch → един activeIdx + glass popup докиран над слайдъра" е концептуално солиден и вече работи в три chart карти (SalesTrend, SalesDayPulse, SalesRhythm hour strip). Map fade-out + bottom-dock popup-ът също е елегантно решение на overflow clipping проблема. Но има ~10-12 точки, на които ще се спънем, ако ги копираме както са:

1. **Touch-action mismatch**: chart-wrapper-ите ползват `touch-pan-y` (правилно), но `.chart-scrubber` в `globals.css` декларира `touch-action: pan-x`. Коментарът в `useChartScrubber.ts:29` казва същото като wrapper-а. CSS коментарът на скрубъра обаче казва „let the page scroll vertically while the thumb tracks horizontally" — което е лъжа на самия себе си: `pan-x` означава „браузърът обработва само хоризонтални пан жестове, а вертикални скрол жестове върху thumb-а **отиват на компонента**, не на страницата". Резултат на тесен viewport: ако пръст падне точно на thumb-а, вертикалното скролиране се блокира за момент.
2. **Pointer-capture без gesture intent detection**: hook-ът прави `setPointerCapture` на pointerdown, което означава „каквото и да става след това — мое е". Ако оператор стартира вертикален скрол ВЪРХУ chart-а, ще види briefly flash на tooltip за първите 1-2 пиксела движение, преди браузърът да изпрати `pointercancel`.
3. **MobileScrubberRow `aria-live="polite"`** е сложен върху обвивката която съдържа popup-а — но при бърз scrubbing screen reader-ът ще се опита да чете 24 различни stack-нати "Поръчки X EUR" анонса в секунда. Трябва debounce или `aria-live="off"` с manual announcement on release.
4. **Tap targets под 44px** на DateRangePicker preset chips на mobile (`px-2 py-1` ~ 22-24px ефективна височина), на metric chip-ите във „География" (`px-2.5 py-1` ~ 24px) и на „Приходи/Поръчки" toggle в Ритъм (`px-2 py-0.5` ~ 18px). CLAUDE.md принцип #2 е категоричен. Минимум на стара жена в тъмната хол е тествано — недостатъчно.
5. **Hero strip на 375px**: SubTile-ите (Поръчки + Среден чек) са `col-span-1` от `grid-cols-2`, т.е. ~174px ширина минус gap. На тази ширина "2,345 EUR" + sparkline + delta + label вече се борят за място; "Среден чек" + "199,99 EUR" + delta на текст-2 + bars/step area = 5 неща в 174×180px. На low-light hero числото губи фокус.
6. **Persistence on release**: при втория chart по-надолу (SalesRhythm hour strip), оператор който е „пинвал" точката на SalesTrend, превърта надолу и попада на втори popup, който показва съвсем различен бакет. Без визуален „reset" affordance, two pinned popups на една и съща страница четат като bug.
7. **WorldMap tooltip dock**: bottom-dock-ът покрива до 4 country list реда зад картата визуално (popup е width=full, h ~ 110-130px със shadow). Не клипва защото е извън CardBody overflow, но позиционно е над bottom Card на CountryListPanel? Не — list panel е вдясно (`lg:col-span-4`) на desktop, ПОД картата на mobile. Bottom-dock-ът sit-ва ВЪТРЕ в map container; long press на marker отблизо до bottom edge скрива marker-а зад popup-а — няма visual indication „кой marker гледам сега".
8. **DateRangePicker custom popover ширина**: `min-w-[260px]` + позициониран `right: 0` на mobile (375px - safe area - main padding ≈ 343px) пада ОК. Но native `input[type=date]` дава OS-picker, който на iOS може да закрие custom popover-а изцяло (full-screen wheel picker). User flow „pick from, pick to" → две OS picker-а един след друг + Apply — три tap-а без визуална continuity.
9. **MapLibre `cooperativeGestures: false`** — на mobile означава, че двупръстов scroll през страницата ще zoom-не картата вместо да скролне страницата. На 600px-high map (mobile `h-[400px]`), при момент в който потребителят се опитва да скрол past chart-а, ще zoom-не картата.

Останалото е по-малко (т.6-15 по-долу).

Препоръка: фиксирай 1, 2, 4, 6, 9 преди да копираш pattern-а на /traffic. Останалите са кулминативни — по едно на спринт.

---

## Findings

### F1. `touch-action: pan-x` на скрубъра противоречи на коментара му

- **Severity**: important
- **Device / breakpoint**: всички mobile breakpoints (<768px)
- **Where**: `src/app/globals.css:205-215`, `src/components/charts/MobileScrubber.tsx:42-83`
- **Evidence**:
  ```css
  .chart-scrubber {
    ...
    touch-action: pan-x;
    ...
  }
  ```
  В `useChartScrubber.ts:29`: „chart wrappers using this hook should add the `touch-pan-y` Tailwind class". `touch-pan-y` на wrapper-а е консистентно с „пръст по wrapper-а → horizontal движение драйва scrubber, вертикалното идва от страницата".
  Но `touch-action: pan-x` на самия `.chart-scrubber` (input range) казва обратното: на range input-а позволявай само horizontal пан, вертикалното задръж за UI control. Което означава, че ако пръстът падне точно върху thumb-а, started vertical scroll **не отива на page** — той се абсорбира от input-а като no-op (range не консумира vertical pan). На иначе 28px тънка thumb лента, lock на vertical scroll за 5-10ms преди пръстът да излезе извън нея е реална frustration на 22:00 в тъмното.
- **Recommendation**: смени `.chart-scrubber { touch-action: pan-x }` → `touch-action: manipulation`. Това позволява tap + horizontal drag (родното поведение на range), без да блокира vertical scroll. Или иначе: ако наистина искаш explicit, използвай `touch-action: pan-x pan-y` за изричен dual-axis.

### F2. Pointer-capture без intent detection → tooltip flash при vertical scroll през chart

- **Severity**: important
- **Device / breakpoint**: всички mobile breakpoints
- **Where**: `src/components/charts/useChartScrubber.ts:78-90`
- **Evidence**:
  ```ts
  const onPointerDown = useCallback((e) => {
    if (e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const idx = indexFromEvent(e);
    if (idx !== null) setActiveIdx(idx);  // <-- immediate state write
  }, [indexFromEvent]);
  ```
  Когато оператор скролне страницата с пръст, започвайки от chart-а (а chart-ът заема 240-260px на mobile, шансът е голям), първото нещо което hook-ът прави е да напише `activeIdx` от X координатата на pointerdown. Recharts cursor + ReferenceLine + popup всички се появяват за 1 frame преди браузърът да реши „това е vertical pan" и да изпрати `pointercancel`.
- **Recommendation**: добави gesture intent prag — не write-вай activeIdx докато pointermove не премести `Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)`. Същата техника която Apple Maps / Stripe Dashboard ползват за horizontal-scroll списъци вътре в vertical scroll контейнери.

### F3. `aria-live="polite"` на scrubber popup → screen-reader spam

- **Severity**: important (a11y compliance), nice-to-have за реална употреба
- **Device / breakpoint**: всички mobile breakpoints с VoiceOver / TalkBack
- **Where**: `src/components/charts/MobileScrubber.tsx:114-122`
- **Evidence**:
  ```tsx
  <div ... aria-live="polite">
    {popup}
  </div>
  ```
  Popup-ът се пре-rendira-ва за всеки промяна на activeIdx. При scrubbing през 24 часа = 24 announce-а в ~500ms. VoiceOver queue-ва — операторът ще чуе „Поръчки 14, Приходи 1230 EUR" 5-6 пъти подред с lag.
- **Recommendation**: вместо `aria-live` на самия popup, направи родителя `role="status" aria-atomic="true"` (announce-ва пълното текущо състояние, не diff) и debounce-вай с 250ms throttle. Или още по-добре: премести live region на скрубъра като `aria-valuetext` на range input-а — браузърът сам да решава кога да чете (обикновено след idle).

### F4. Tap targets под 44px на филтър chips и toggle бутони

- **Severity**: important
- **Device / breakpoint**: всички mobile breakpoints
- **Where**:
  - `src/components/shared/DateRangePicker.tsx:56-67` — `px-2 py-1` на mobile = ~22-24px effective height
  - `src/app/(dashboard)/sales/page.tsx:124-131` — metric chip „Приходи/Поръчки/Клиенти", `px-2.5 py-1` ~ 24px
  - `src/components/sales/SalesRhythm.tsx:506-525` — Ритъм toggle, `px-2 py-0.5` = ~18px (!)
- **Evidence**: CLAUDE.md принцип #2: „Touch targets: 44px min." Дори с тълпа от другите бутони наоколо, на дамски maintain hands at 22:00 е реална трудност. Особено `py-0.5` на Ритъм toggle-а е под Apple HIG (44pt) И Material (48dp).
- **Recommendation**:
  1. DateRangePicker chips: increase mobile padding до `px-3 py-2.5` (горната ред в PageHeader така или иначе е 56px на mobile с burger, така че допълнителна височина не пука).
  2. Metric chip в /sales/page.tsx: `py-1` → `py-2 sm:py-1` (compact на desktop, comfy на mobile).
  3. Ритъм toggle: `px-2 py-0.5` → `px-2.5 py-1.5 sm:py-0.5`. Кадифено compact desktop, mobile стига до 28-32px+.

Алтернативно: ползвай invisible padded hit area (CSS technique: `position:relative; ...::before { content:""; position:absolute; inset:-10px }`). Декопling visual size от tap area, същия принцип като map markers §10.4 в design contract.

### F5. Hero strip SubTile сгъстеност на 375px

- **Severity**: nice-to-have
- **Device / breakpoint**: 375px / 390px
- **Where**: `src/components/sales/SalesHeroStrip.tsx:430-449, 585-627`
- **Evidence**:
  SubTile-ите на mobile са `col-span-1` от 2-колонен grid с `gap-3` (12px) и main padding 16px. На 375px виewport: (375 - 32 main - 12 gap) / 2 = **165.5px** на тайл. В това: label 12px + value 24px + delta + sparkline (h-[48px]). Value е "199,99 EUR" (среден чек) — на 24px font-bold с tabular-nums = ~125-140px wide. Остава ~25px дясно. Това все още работи. Но „1 234,56 EUR" с 6 значещи цифри + EUR суфикс ще пробие или ще се truncate-не.

  Същевременно `truncate` не е сложен на value (`text-[24px] md:text-[28px] font-bold tracking-tight text-text leading-none tabular-nums`) — ще препокрие.

- **Recommendation**: На < md, value-то на SubTile-а смени от full EUR до compact (`fmtEur(n, 0)` → `fmtCompactEur(n)`, "1,2k EUR"). Или: hero числото запазва full EUR, SubTile-ите минават в compact на mobile (вече има helper `fmtCompactEur` в `SalesRhythm.tsx:91`).

### F6. Persistence on release създава „dual pinned popups" anti-pattern

- **Severity**: important
- **Device / breakpoint**: всички mobile breakpoints
- **Where**: `src/components/charts/useChartScrubber.ts:102-112` (комент), всички 3 chart карти
- **Evidence**:
  Hook-ът explicitly запазва activeIdx на release per the new contract. Но на /sales има **три** независими scrubber state-а (SalesTrend, SalesDayPulse, SalesRhythm hour strip). На multi-day window, hero strip + trend + rhythm hour strip = три scrubber-а наведнъж. Операторът пинва ден „12 май" на trend, скролва надолу, scrub-ва hour strip и пинва „14:00 ч." там. Връща се горе → вижда стария popup на „12 май". Без affordance „aftermark на ден 12" / „clear" / „това е pinned не текущо".

  Worse: persistance след focus blur (`input[type=range]` губи focus на първото туване извън него) — popup-ът ВИНАГИ е visible след първо взаимодействие, без visual indication това е „pin" не „current".
- **Recommendation**: или:
  - (a) Add a discrete „pinned" affordance — малък ✕ бутон в popup-а, или dashed border around the popup, или leading "● Пинирано" prefix in the header.
  - (b) Revert към auto-dismiss след N секунди idle (5-10s) — popup затвори се с opacity fade.
  - (c) Single global pinned-tooltip slot — пинване на втори chart auto-disable-ва първия (page-level Zustand или React context state).

Препоръчвам (a) — visual indication, без да губиш персистенцията която hook коментарите защитават.

### F7. WorldMap bottom-dock popup закрива marker-а който описва

- **Severity**: important
- **Device / breakpoint**: всички mobile breakpoints
- **Where**: `src/components/sales/geography/WorldMap.tsx:850-908`, `src/app/globals.css:145-154`
- **Evidence**:
  Map height на mobile е `h-[400px]`. Bottom-dock popup-ът на office tooltip е ~130px (heading + дивайдер + 3 reda + zip). Това = top 270px от картата за гледане на marker-и. Ако marker-ът е в долния трет (примерно София с офиси), пръстът + popup-ът заедно покриват marker-а изцяло.

  Нещо повече: popup-ът няма pointer / arrow / connector към marker-а. „Кой office гледам?" е невъзможно да се отговори визуално без mental map.
- **Recommendation**:
  - Като минимум: shrink mobile popup-а — `office` tooltip има 3-4 реда + heading, може да compact-нем до 2 (orders + revenue). Спестяване ~50-60px.
  - По-добре: добави visible flash / pulse на selected marker — accent ring around the clicked dot, persistent докато popup-ът е отворен.
  - Best: docking-ът да избира top vs bottom въз основа на marker Y-coordinate в screen-а. Marker в горната половина → dock at bottom (current). Marker в долната половина → dock at top. Същия pattern като Apple Maps callout.

### F8. DateRangePicker custom popover + native date picker UX-bottleneck

- **Severity**: nice-to-have (но visible в наблюденията)
- **Device / breakpoint**: всички mobile breakpoints, особено iOS Safari
- **Where**: `src/components/shared/DateRangePicker.tsx:102-138`
- **Evidence**:
  Two `input[type=date]` отварят два native picker-а един след друг на mobile. Между тях popover-ът остава отворен. На iOS Safari, native date picker заема ~50% от viewport-а — popover-ът е invisible зад него. След „От" → „До" → „Приложи" = 4 sequential taps + 2 OS picker preludes.

  Допълнително: native date picker няма range mode — операторът не вижда визуално „избрах 5 май - 12 май", само две дати в раздалечени полета.
- **Recommendation**: за compact mobile mode, switch към dedicated lightweight range picker (react-day-picker, или собствен compact 2-month grid). Това е по-голям scope; в краткосрочен план: добави display на „общо X дни" под двете полета, и persist preset highlighting докато оператор не натисне „Приложи" — за да види ясно, че е още в edit mode.

### F9. MapLibre `cooperativeGestures: false` краде vertical scroll през картата

- **Severity**: critical
- **Device / breakpoint**: всички mobile breakpoints
- **Where**: `src/components/sales/geography/WorldMap.tsx:405`
- **Evidence**:
  ```ts
  cooperativeGestures: false,
  ```
  Без cooperativeGestures, scroll/touchmove в map контейнера се обработва изцяло от MapLibre — single-finger drag пано-ва картата, two-finger pinch zoom-ва. **Една пръстова drag НЕ стига до browser-а** → ако оператор скрол-ва /sales отгоре надолу и пръстът падне в map контейнера за дори 1 frame, скрол-ът спира и страницата „залепва".

  MapLibre препоръчва `cooperativeGestures: true` на mobile именно затова. С това enabled, single-finger drag passes through to scroll и операторът трябва да направи изричен two-finger жест (с "Use two fingers to move the map" overlay).
- **Recommendation**:
  ```ts
  cooperativeGestures: window.matchMedia("(max-width: 767px)").matches,
  ```
  Или винаги true — desktop също се ползва (нямаме много touchpad pinch проблеми, а UX gain е голям). Виж handling в Google Maps embeds.

### F10. WorldMap loading skeleton на mobile е 400px празно квадратче

- **Severity**: nice-to-have
- **Device / breakpoint**: всички mobile breakpoints
- **Where**: `src/app/(dashboard)/sales/page.tsx:62-69`
- **Evidence**:
  ```tsx
  loading: () => (
    <Card className="h-full">
      <Skeleton className="h-full w-full rounded-xl" />
    </Card>
  )
  ```
  При първо зареждане (MapLibre dynamic import + topojson parse) на slow 4G, операторът вижда 400px празен шиммер за 2-4s. Без landmark — не знаеш дали грешка или зареждане.
- **Recommendation**: добави inline label „Зареждам карта на пазарите..." в центъра на skeleton-а (text-text-3 text-[13px]) — същият pattern като empty state-ите в дизайн контракта (§8 graceful degradation).

### F11. SignalStrip snap-scroll няма „more on the right" affordance

- **Severity**: nice-to-have
- **Device / breakpoint**: всички mobile breakpoints
- **Where**: `src/components/sales/SalesSignalStrip.tsx:137-164`
- **Evidence**:
  Коментарът „a faded last tile" обещава affordance но не го имплементира. Реалност: 4-5 тайла, всеки `min-w-[180px]`, на 375px viewport се виждат 1.9 тайла. Последен tile може да е „Топ пазар" с meaningful data, който оператор изобщо да не открие защото нищо не казва „има още".

  Scrollbar на mobile е скрит (системно), snap-mandatory работи, но user discovery е лоша.
- **Recommendation**:
  - Right edge fade: добави `mask-image: linear-gradient(to right, black 90%, transparent)` на scroll container-а, така последно видимият tile се fade-ва — естествен сигнал „има още".
  - Или: добави малък bullet pagination dots под strip-а (`flex justify-center gap-1 mt-1`) — 1 dot за всеки tile, accent за активния. Visible при `md:hidden`.

### F12. Top product „виж всички" button-ите са под tap-target минимум

- **Severity**: nice-to-have
- **Device / breakpoint**: всички mobile breakpoints
- **Where**: `src/components/sales/TopProductsAggregate.tsx:154-170`
- **Evidence**:
  ```tsx
  <button className="text-[12px] text-text-2 ... pt-1">
    Виж всички {products.length} →
  </button>
  ```
  Само `pt-1` padding, height = 12px font + 4px top = ~18px. Tap target = текст-ширина × 18px. На phone това е миниатюрно.
- **Recommendation**: `py-2 -mx-2 px-2 inline-block` + увеличи clickable area, без visual padding пробив.

### F13. CountryListPanel rows на mobile — двойно truncate-ване

- **Severity**: nice-to-have
- **Device / breakpoint**: 375px / 390px
- **Where**: `src/components/sales/geography/CountryListPanel.tsx:140-163`
- **Evidence**:
  Row layout: flag (16px) + gap-3 + display name (truncate) + value (no truncate) + ArrowRight (only when selected). Под него: "X поръчки · Y клиенти" + share %.

  На 375px след map (full width на mobile) с outer card padding = ~310px useful width. Flag + gaps = ~40px. Остава 270px за text. "Чешка Република" + "12 345 EUR" + ArrowRight = pressure points. На selected state ArrowRight идва в DOM и сжижва space-а с още 22px. Реален „layout jitter" при toggle.
- **Recommendation**: reserve ArrowRight slot винаги (или visibility:hidden when not selected). Или sub-line („X поръчки · Y клиенти") може да се сгъстие до „X • Y клиенти" с по-малък сепаратор.

### F14. SalesRhythm „Час от деня" mini-chart на 375px

- **Severity**: nice-to-have
- **Device / breakpoint**: 375px
- **Where**: `src/components/sales/SalesRhythm.tsx:541-568, 588-697`
- **Evidence**:
  WeekdayRow has `w-10 + flex-1 + w-20 + w-14` = 40 + flex-1 + 80 + 56 = **176 fixed + flex** на mobile usable ~310px → flex-1 = ~134px. На 134px wide × 36px tall, 24h ритъм sparkline area-chart става нечетим — особено когато оператор сравнява 7 паралелни ритми вертикално.

  Допълнително: right-most колоната („Δ" 11px font) се чете на тъмно когато виж са „▼ 100%" на 56px column width = възможно truncate на „▼ 100%" → " 100" (липсва arrow на edge случаи, ако са негативни числа с 3 цифри). Не съм проверил empirically, but tight.
- **Recommendation**:
  - На mobile, увеличи row height (`h-9` → `h-11`) so sparkline има повече сила.
  - Или: на mobile, switch към horizontal bars вместо smooth area (1 bar per 3h aggregated = 8 bars), което чете по-clear на phone (виж design-contract §9.6 „Bars > линии на 375px").
  - Reserve fixed minimum width на right-rail колоните (`w-14` → `w-16` за Δ).

### F15. Sales page chart-ите имат три independent scrubber state-ове — risk на бъдеща inconsistency

- **Severity**: nice-to-have (architectural)
- **Device / breakpoint**: всички
- **Where**: `SalesTrend.tsx:177-178`, `SalesDayPulse.tsx:175-176`, `SalesRhythm.tsx:425-431`
- **Evidence**: всеки chart има свой `useChartScrubber`. Не е грешно — separation of concerns. Но за бъдещ extension на /traffic /products където може да има 5-6 chart-а в една страница, „dual pinned popups" в F6 ще се multiplied to 5-6. Single source of truth pattern (active = (cardId, idx) singleton в URL state или React context) ще предотврати бъдеща chaos.
- **Recommendation**: пред копирането към /traffic, помисли за `<ChartScrubberProvider>` context, който държи `{cardId, idx}` — само един `cardId` може да е active за един път. Натискане на втори chart auto-clear-ва първия. Решава F6 fundamentally.

---

## Touch interaction model summary

Списък на всеки touch-driven interaction в /sales днес:

| # | Зона | Жест | Резултат | State |
|---|---|---|---|---|
| 1 | PageHeader → DateRangePicker preset chip | tap | `setPreset(p.id)` → URL update | ✅ работи, но tap target малък (F4) |
| 2 | PageHeader → DateRangePicker „Период" | tap | toggle popover; outside-tap затваря | ✅ работи; F8 за inner picker UX |
| 3 | PageHeader → StoreSelector | tap | toggle dropdown; outside-tap + Esc затваря | ✅ работи |
| 4 | SignalStrip | horizontal snap-scroll | scroll cards | ✅ работи; F11 affordance gap |
| 5 | SalesTrend chart wrapper | pointer-drag | `setActiveIdx` → ReferenceLine + Dot + popup | F1, F2, F6 |
| 6 | SalesTrend MobileScrubber | drag thumb | същият setActiveIdx | ✅ работи; F3 a11y |
| 7 | SalesTrend MobileScrubber | release | persist activeIdx | F6 |
| 8 | SalesDayPulse chart wrapper | pointer-drag | `setActiveIdx` (combo) | F1, F2, F6 |
| 9 | SalesDayPulse MobileScrubber | drag/release | persist activeIdx | F6 |
| 10 | SalesRhythm hour strip wrapper | pointer-drag | `setActiveIdx` за hour | F1, F2, F6 |
| 11 | SalesRhythm hour strip scrubber | drag/release | persist | F6 |
| 12 | SalesRhythm weekday rows | (nothing) | няма interaction — само visual | ✅ design choice |
| 13 | SalesRhythm Приходи/Поръчки toggle | tap | switch metric | F4 (твърде малък) |
| 14 | Geography metric chip | tap | switch metric → paint map + list | F4 |
| 15 | WorldMap | single-finger drag | pan map (заради `cooperativeGestures: false`) | F9 — краде page scroll |
| 16 | WorldMap | pinch | zoom | ✅ работи |
| 17 | WorldMap | tap marker / cluster | trigger hover state → popup bottom-dock | F7 (popup закрива marker) |
| 18 | WorldMap | tap country | select; map paints accent stroke | ✅ работи |
| 19 | CountryListPanel row | tap | select country (bidirectional sync) | F13 (jitter) |
| 20 | TopProductsAggregate „виж всички" | tap | expand list | F12 |
| 21 | TopBar burger | tap | open mobile sidebar drawer | ✅ работи |

Общо: **21 touch interaction-а**. От тях:
- 3 имат critical concern (F9 — page scroll, F1 — touch-action mismatch, F2 — pointer flash)
- 5 имат important concern (F3 a11y, F4 tap targets, F6 dual pins, F7 popup hide, F11 discoverability)
- 5 имат nice-to-have polish (F5, F8, F10, F12, F13, F14)

---

## Cross-component mobile patterns to enforce before extension

Преди да копираме pattern-ите към /traffic, /products, /ads, /email — кодифицирай тези **седем правила**:

### P1. Chart-touch hook = unified, gesture-detected, persistence-aware

Обнови `useChartScrubber.ts` с:
1. Intent detection (F2): не set-вай `activeIdx` от pointerdown — само от първи `pointermove` с `dx > 6 && |dx| > |dy|`.
2. Optional `dismissOnOutside` flag — за карти, които не искат persistence (e.g. embedded в drill-down дрyер).
3. Single shared context за page-level active state, optional. Default = local.

### P2. Mobile-only `touch-action` discipline

Всеки chart wrapper: `touch-pan-y`. Всеки interactive slider: `touch-action: manipulation`. **Никога** `pan-x` сам по себе си (краде vertical scroll). Записано в `globals.css` коментар + design contract §9.6.

### P3. Tap target floor

Всеки `<button>` на mobile (`< md`) задължително:
- `min-height: 44px` ИЛИ
- invisible padding via `::before { inset: -10px }` за visual-compact компоненти.

Добави Tailwind preset class `.tap-44` за това. Replace всички `py-0.5 / py-1` на mobile chips.

### P4. Map cooperative gestures

`cooperativeGestures: true` под `md`. Always. Никога blocking page scroll.

### P5. Popup positioning intelligence

Bottom-dock на марker popup-и → smart top/bottom избор spred Y координата на target-а. Visible affordance „кой обект гледам" — pulsing ring на selected marker докато popup е open.

### P6. Snap-scroll discoverability

Всеки `overflow-x-auto snap` контейнер на mobile задължително има или:
- `mask-image: linear-gradient(to right, black 90%, transparent)` right edge fade, ИЛИ
- bullet pagination dots под него.

### P7. Skeleton + empty + error states имат **текст**

Празен skeleton box на 400px = bad UX. Винаги inline label в text-text-3 text-[13px] centered. Design contract §8 вече казва това — но визуално не се прилага consistent.

---

## Open questions

1. **Persistence vs auto-dismiss**: операторите харесват „пинвал съм точката, не я загуби". Но F6 показва, че pinning на 3 chart-а едновременно е mental load. Кое от: explicit dismiss bтн, 10s idle timeout, single-active context? Изисква user signal — на следващия operator demo, пинни 3 chart-а и попитай „кой е active сега?".

2. **Native date picker vs custom range UI**: F8. iOS Safari/Chrome date picker UX е катастрофално за range selection. Worth ли е дa внасяме `react-day-picker` (~30kB gzipped) за единствено този use case? Алтернативно: ние имаме само 3 не-preset use cases — може би custom range да се ограничи до „последни N дни" slider с N ∈ [1, 365]?

3. **MapLibre cooperative gestures + desktop touchpad UX**: ако `cooperativeGestures: true` always, desktop touchpad pinch + scroll work-ва същ начин — но „use two fingers" overlay е visible винаги, което е visual noise за desktop. Може би: `true` само на coarse pointers (`pointer: coarse` media query).

4. **Scrubber on multi-chart pages**: /traffic ще има sessions trend + device breakdown + landing pages — 3-4 chart-а на page. Един шаред scrubber context или per-chart? F15 препоръчва shared, но shared = pinning chart A clear-ва chart B → губим cross-comparison („какъв е sessions при peak на conversion?"). Може би multi-scrubber, но с visual indicator „пинирано на 3 места".

5. **Hero strip 5-th tile (Топ пазар)**: на multi-store views, тя се появява само ако `isAll`. На phone в low light, операторът може да я пропусне (F11 discoverability). Може ли да дублира тази информация във визуален bridge tile с map?

6. **Bottom safe-area** (notched devices): `padding-bottom: env(safe-area-inset-bottom)` не съм видял никъде в Shell.tsx. На iPhone 14 Pro в landscape — последният chart card е под home indicator bar. Изисква отделен audit; ако не е, добави го в Shell.

7. **Dark mode on phone in low light**: всички осветления тук са в light mode. Dark mode tests pending. Особено `bg-surface/85 backdrop-blur-xl` на popup-а — в dark mode `--surface = #1c1c1e` с 0.85 opacity става ~`rgba(28,28,30,0.85)` → почти черно, добра четимост. Но gradient overlay-ите на charts могат да isaesthet от accent-soft (зелено) на черен фон — visual brightness flash при mobile dark mode през нощта.
