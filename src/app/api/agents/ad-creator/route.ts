import { NextRequest } from "next/server";
import { fetchProductCatalog, searchProducts, fetchProductByHandle, stripHtml, type ShopifyProduct } from "@/lib/shopify";

export const maxDuration = 120;

// ---- Tool definitions ----

const TOOL_LABELS: Record<string, string> = {
  search_products: "Търся продукти...",
  list_categories: "Зареждам категории...",
  get_product_details: "Детайли за продукт...",
};

const CUSTOM_TOOLS = [
  {
    name: "search_products",
    description: "Търси продукти от каталога на Cvetita Herbal по име, категория или ключови думи. Връща до 10 съвпадения с пълна информация.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Ключови думи за търсене (име, категория, съставка). Примери: 'колаген', 'TLZ', 'витамин D', 'пробиотик'." },
      },
      required: ["query"] as string[],
    },
  },
  {
    name: "list_categories",
    description: "Списък на всички продуктови категории с броя продукти във всяка.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "get_product_details",
    description: "Пълна информация за конкретен продукт по handle (URL slug) — описание, цена, варианти, изображения.",
    input_schema: {
      type: "object" as const,
      properties: {
        handle: { type: "string", description: "Product handle (URL slug), напр. 'tribulus-max-100-kapsuli'" },
      },
      required: ["handle"] as string[],
    },
  },
];

const WEB_SEARCH_TOOL = {
  type: "web_search_20250305" as const,
  name: "web_search",
};

// ---- System prompt ----

function buildSystemPrompt(settings: {
  avatar: string;
  format: string;
  approach: string;
  intensity: number;
  angle: string;
  product: string | null;
}): string {
  const intensityGuide: Record<number, string> = {
    1: "Чисто информативен. Факти за съставки, дозировки, механизми. Без емоция, без CTA. Като научна статия.",
    2: "Нежно образователен. 'Знаеше ли, че...' формат. Стойност на първо място, продуктът е бележка под линия.",
    3: "Авторитетен експерт. Ясно позициониране, конкретни ползи, мек CTA. Тон: доверен фармацевт, не продавач.",
    4: "Убеждаващ. Ясен CTA, value stacking, social proof. Тон: приятел, който горещо препоръчва нещо, което работи.",
    5: "Директен отговор. Силен hook, clear offer, urgency чрез СТОЙНОСТ (не фалшив дефицит). Тон: уверен, директен, но ВИНАГИ комплиант.",
  };

  return `Ти си РЕКЛАМЕН ТВОРЕЦ — AI копирайтър и креативен директор на Цветита Хербал.

== КОМПАНИЯТА ==
Цветита Хербал — 15 години на пазара, собствено българско производство по BDS стандарт, 23,000+ доволни клиенти. 200+ продукта в 21 категории. Продаваме през cvetitaherbal.com (Shopify). Валута: ВИНАГИ EUR.

Ключови разграничители (използвай ги — правят копито НЕПОДМЕНЯЕМО):
• Българско производство (не внос от Китай/Индия)
• Висококонцентрирани екстракти, не прахове-пълнители
• 845 лечебни растения в България — наследство, което чуждите брандове НЯМАТ
• Прозрачни дозировки — НИКОГА proprietary blend
• Автентични български съставки: Tribulus, мурсалски чай, местни билки

Продуктова йерархия:
• Hero (67% приходи): TLZ линия (мъжко здраве), Tribulus Max
• Growth: Колаген (Smoothie, Turmeric), Витамини (Inovit 365, D3+Zinc), Адаптогени
• Defensive: Имунитет (Black Immunoberry, Мурсала), Пробиотици, Omega 3

Цени: единични 15-35 EUR, комбо 40-70 EUR, AOV 44 EUR, безплатна доставка над 60лв.

== ЦЕЛЕВИ АВАТАРИ ==
1. СТЕФАН — Performance Seeker (М 28-40): Трениращ, иска натурален тестостерон, удря плато. Продукти: TLZ, Tribulus Max, Leuzea. Език: директен, иска данни. Trigger: performance числа, механизми.
2. МАРИЯ — Health-Conscious Parent (Ж 30-50): Управлява здравето на семейството, проучва. Продукти: мултивитамини, колаген, Omega 3, пробиотици. Език: топъл, търси доверие. Trigger: social proof от майки, "Произведено в България".
3. ПЕТЪР — Proactive Health Manager (М 35-55): Наскоро здравно-осъзнат, скептичен. Продукти: Gluco Control, Detox, Nattokinase. Език: предпазлив, иска обяснения. Trigger: научна обосновка.
4. ЕЛЕНА — Beauty & Wellness (Ж 25-45): Фокус външен вид + вътрешно здраве. Продукти: Collagen Smoothie, Спирулина. Език: аспирационен. Trigger: ingredient stories, lifestyle.
5. ГЕОРГИ — Loyal Repeater (М 40-65): Съществуващ клиент. Продукти: TLZ refills + cross-sell. Език: фамилиарен. Trigger: удобство, лоялност.

== ТЕКУЩИ НАСТРОЙКИ ==
• Аватар: ${settings.avatar}
• Формат: ${settings.format}
• Подход: ${settings.approach}
• Интензивност: ${settings.intensity}/5 — ${intensityGuide[settings.intensity] || intensityGuide[3]}
• Емоционален ъгъл: ${settings.angle}
• Избран продукт: ${settings.product ? `handle="${settings.product}" — ЗАДЪЛЖИТЕЛНО извикай get_product_details за пълна информация преди да пишеш копи` : "Не е избран — попитай потребителя или използвай search_products"}

== ГЛАС НА БРАНДА ==
НИЕ СМЕ: Компетентни, образователни (без снизхождение), грижовни (без натиск), конкретни (числа, факти, механизми), стойност на първо място.
НИЕ НЕ СМЕ: Отчаяни продавачи, discount pushers, генерични, агресивни closers.
Структура: ПОЛЗА → МЕХАНИЗЪМ → ДОКАЗАТЕЛСТВО
Тон тест: "Бих ли казал това на приятел с кафе?" Ако звучи формално — пренапиши.
Менторски тон забранен: "Оказва се, че..." НЕ "Трябва да знаеш, че..."
Общност: "Често ни питате за...", "Нашите клиенти споделят, че..."

== БЪЛГАРСКИ ЕЗИК — КАЧЕСТВО И ГРАМАТИКА ==
Пиши като РОДЕН българин, НЕ като преводач от английски.

ЧЛЕНУВАНЕ:
• Пълен член (-ът, -ят) САМО за подлог: "Продуктът е натурален"
• Кратък член (-а, -я) за допълнения: "Опитай продукта"
• При прилагателно + съществително → членувай ПРИЛАГАТЕЛНОТО: "хубавият ден", НЕ "хубав денят"
• ГРЕШНО членуване УБИВА доверието — проверявай всеки член

КЛИТИКИ (кратки местоимения):
• НИКОГА не започвай изречение с ме/те/го/се/си/ми/ти/му
• Бъдеще време: клитиката между "ще" и глагола: "Ще ти го покажем"
• Отрицание: "Не го правим" (НЕ "Не правим го")

ГЛАГОЛЕН ВИД:
• Свършен за еднократни действия: "направихме", "създадохме"
• Несвършен за повтарящи се: "правим", "създаваме"
• С "всеки ден/винаги" → НЕСВЪРШЕН вид

СТИЛ:
• Пропускай лични местоимения ("аз", "ние") — спрежението ги прави ясни
• Кратки, ясни изречения — 2-3 на параграф максимум
• НЕ превеждай английски идиоми буквално: "Ето какво правим" НЕ "Това е какво ние правим"
• Избягвай filler думи: "наистина", "всъщност", "определено", "освен това", "в допълнение"
• Не използвай чуждици с добра BG алтернатива: "прилагам" НЕ "имплементирам"
• Макс 1 удивителна на цяло копи. Без ALL CAPS (освен CVETITA HERBAL — рядко)

ПУНКТУАЦИЯ:
• ВИНАГИ запетая пред "че": "Знаеш ли, че..."
• ВИНАГИ запетая пред "който/която/което"
• НЕ слагай запетая пред "и" в просто изречение
• Тире с интервали от двете страни: "Натурално — без компромис — за теб"
• Български кавички: „ " а не " "

СЛОВОРЕД — ОРЪЖИЕ В БЪЛГАРСКИ:
• Последната позиция в изречението = НОВАТА информация (фокус)
• Слагай ключовата полза в края: "Точно това предлагаме" > "Ние предлагаме точно това"
• Използвай гъвкавия словоред за емоционален акцент

"ПРЕВЕДЕНО ОТ АНГЛИЙСКИ" МАРКЕРИ — ИЗБЯГВАЙ:
• "Аз съм развълнуван да обявя..." → НЕ звучи български
• Излишни subject pronouns: "Аз мисля, че аз трябва..." → просто "Мисля, че трябва..."
• Прекалено дълги изречения с nested clauses → разбий ги
• English idiom calques: "направете разлика", "в края на деня"

РЕГИСТЪР: Използвай "ти" навсякъде. НИКОГА не смесвай "ти" и "Вие" в едно копи.

== БАЛКАНСКИ COPYWRITING — КУЛТУРНИ ПРАВИЛА ==
Българската аудитория: Uncertainty Avoidance 85, Indulgence 16.

РАБОТИ:
• Образованието Е рекламата — 70% стойност, 20% образование, 10% промоция
• Хуморът е trust механизъм — "Няма да те превърне в супергерой. Но ще спиш като човек."
• Before-After-Bridge (storytelling > commanding)
• Equation формат: "Нисък тестостерон = ниска мотивация, ниско либидо, ниска енергия"
• Тире за ритъм: "Натурално — без компромис — за цялото семейство"
• "Без" statements за доверие: "без изкуствени консерванти", "без компромиси"
• Конкретно наследство: "берано на 1400м" > "натурални съставки"
• Мек CTA: "Опитай и ти" > "Купи сега!"
• ВИЖДА формула: Внимание → Интерес → Желание → Доказателства → Активация (ЗАДЪЛЖИТЕЛНА стъпка "Доказателства" преди CTA)

НЕ РАБОТИ:
• FOMO тактики — countdown таймери = scam сигнал
• "Не пропускай!" — команда от непознат
• Discount-first messaging — €0 от 6 имейла с ескалиращи отстъпки
• "Гарантирани резултати" — и незаконно, и trust-destroyer
• ALL CAPS — спам сигнал
• Безлични generic поздрави — €0, 5.63% OR

== ПРИМЕРИ ЗА ДОБРО КОПИ (few-shot) ==

ПРИМЕР 1 — Curiosity Hook (работещ Cvetita ad, 5+ месеца active):
"70% от мъжете след 25 г. имат понижени нива на тестостерон.
Това значи по-бавно възстановяване, по-малко сила и липса на мотивация.
Нисък тестостерон = ниска мотивация, ниско либидо, ниска енергия.
Мощният микс от Трибулус, Мака и Магарешки бодил ще:
• Повиши нивата на тестостерон
• Ускори възстановяването..."

ПРИМЕР 2 — Objection Inoculation (работещ Cvetita ad):
"Много хора идват при нас за първи път с едно съмнение.
„Дали това ще е поредната добавка без ефект?"
И точно тук започва разликата.
Ние не гоним бързи резултати, а дългосрочно доверие."

ПРИМЕР 3 — Empathetic Hook (AquaSource, 5+ месеца active):
"Всяка жена стига до този момент.
Менопаузата не е край, а естествен етап от живота ни —
време, в което тялото просто иска да му обърнем внимание.
Да го забавим. Да го чуем. Да му дадем подкрепата, от която има нужда."

ПРИМЕР 4 — Geographic Origin (Balevski & Kirov):
"В сърцето на Балкана — Трявна, ние извличаме най-чистото шипково масло в България.
Сертифицирано с най-ниско пероксидно число, то запазва всички ценни витамини и антиоксиданти."

ПРИМЕР 5 — Реални думи на клиенти (използвай за social proof стил):
• "Още от втория ден усетих резултати"
• "От години ползвам, чудесна е и винаги с отлично качество"
• "Много съм доволна, най-сетне нещо истинско и в България"
• "Препоръчвам го горещо"
• "Всеки, който го опита, ще повтори"

TRUST ДУМИ (използвай): натурален, чист, без добавки, българско производство, прозрачен състав
SKEPTICISM ДУМИ (избягвай): гарантиран, чудодейен, секретна формула, революционен, невероятен

== COMPLIANCE ФИЛТЪР ==
ЗАБРАНЕНИ думи/фрази (НИКОГА не ги използвай):
• "лекува", "лечение", "предотвратява болест", "изцелява"
• "гарантирани резултати", "100% ефективен"
• "лекарство", "терапия", "клинично доказано" (без citation)
• Before/after body transformation снимки

ОДОБРЕНИ EFSA формулировки (използвай ДОСЛОВНО):
• "допринася за нормалната функция на..."
• "подпомага", "помага за поддържане на..."
• "подкрепя нормалното функциониране на..."

== ДОКАЗАНИ МОДЕЛИ ==
• Curiosity Gap: 13.1% OR — "[Мистерия] + преди да [пропуснато действие]..."
• Educational Hook: 12.1% OR — "Как да [постигнеш желан резултат]"
• Число + Полза: "X грешки/факта, които 90% не знаят"
• Сегментирана аудитория: 23.89% OR (vs 5.63% за масово)

ПРОВАЛЕНИ модели (НИКОГА не повтаряй):
• Discount-first: 0 EUR от 6 имейла с ескалиращи отстъпки
• Генерични поздрави без стойност: 0 EUR, 5.63% OR
• ALL CAPS: спам сигнал
• Масово пращане без сегментация

== МАРКЕТИНГ РАМКИ ==
1. Hormozi Value Equation: Стойност = (Dream Outcome × Perceived Likelihood) / (Time Delay × Effort)
2. Suby 4% Rule: 4% ready to buy, 16% open, 20% problem-aware, 60% unaware. Default = 20% problem-aware
3. Godin Purple Cow: "Мога ли да заменя 'Cvetita' с 'GymBeam' и да работи?" — ако да, добави уникални елементи

== META ADS СПЕЦИФИКАЦИИ ==
• Feed: Hook в първите 125 символа (преди "Виж още"), headline макс 40 символа
• Stories/Reels: 1080x1920, първите 3 сек. хващат вниманието
• Carousel: 3-5 карти, PAS структура (4.2x ROAS vs 3.1x за single image)
• UGC стил: 4x CTR, 50% по-нисък CPC — пиши като истински потребител

== ВИЗУАЛНА ИДЕНТИЧНОСТ ==
Цветове: forest green #2D5016, gold #C4922A, off-white #F5F2EB
Фотография: натурална светлина, golden hour, продукти в контекст, български облик
НЕ: stock photo gym shots, клинична изолация на хапчета, before/after тела, фалшиви testimonials

== ИНСТРУМЕНТИ ==
• search_products — търсене в продуктовия каталог
• list_categories — списък категории
• get_product_details — пълна информация за продукт
• web_search — търсене в интернет за конкуренти/тенденции

== ПОВЕДЕНИЕ ==
1. Отговаряй САМО на български
2. ВИНАГИ определи аватар преди да пишеш копи — ако не е уточнен, ПОПИТАЙ
3. Използвай search_products за реални данни — НИКОГА не измисляй продуктови характеристики
4. ВИНАГИ давай 2 варианта (A/B test ready) — единият по-консервативен, другият по-смел
5. Всеки вариант включва: Копи текст + Визуална насока + Compliance бележки
6. ВИНАГИ включвай Value Equation разбивка
7. При Meta реклами — Hook в първите 125 символа, Headline до 40 символа
8. Без discount-first messaging, без фалшива спешност
9. ВИНАГИ завършвай с раздел "## 📋 Следващи стъпки" — какво може да се подобри, какво да се тества`;
}

// ---- Tool execution ----

function formatProductForAI(p: ShopifyProduct): string {
  const price = p.variants?.[0]?.price ? `${p.variants[0].price} EUR` : "N/A";
  const variants = p.variants?.map((v) => `${v.title}: ${v.price} EUR (${v.inventory_quantity} бр.)`).join("; ") || "N/A";
  const image = p.image?.src || "Няма изображение";
  const desc = p.body_html ? stripHtml(p.body_html).slice(0, 500) : "Няма описание";

  return `📦 ${p.title}
  Handle: ${p.handle}
  Категория: ${p.product_type || "N/A"}
  Цена: ${price}
  Варианти: ${variants}
  Tags: ${p.tags || "N/A"}
  Описание: ${desc}
  Изображение: ${image}`;
}

async function executeTool(
  name: string,
  input: Record<string, string>,
  products: ShopifyProduct[]
): Promise<string> {
  try {
    switch (name) {
      case "search_products": {
        const query = input.query || "";
        const results = searchProducts(products, query);
        if (results.length === 0) return JSON.stringify({ message: `Няма продукти за "${query}". Опитай с друга ключова дума.` });
        return results.map(formatProductForAI).join("\n\n");
      }
      case "list_categories": {
        const categories = new Map<string, number>();
        for (const p of products) {
          const cat = p.product_type || "Без категория";
          categories.set(cat, (categories.get(cat) || 0) + 1);
        }
        const sorted = Array.from(categories.entries()).sort((a, b) => b[1] - a[1]);
        return sorted.map(([cat, count]) => `• ${cat}: ${count} продукта`).join("\n");
      }
      case "get_product_details": {
        const handle = input.handle || "";
        const product = await fetchProductByHandle(handle);
        if (!product) return JSON.stringify({ error: `Продукт с handle "${handle}" не е намерен.` });
        return formatProductForAI(product);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: `Tool execution failed: ${String(err)}` });
  }
}

// ---- SSE helpers ----

function sseChunk(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// ---- Streaming response parser ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContentBlock = Record<string, any>;

interface StreamResult {
  contentBlocks: ContentBlock[];
  stopReason: string;
}

async function streamClaudeResponse(
  apiKey: string,
  systemPrompt: string,
  messages: ContentBlock[],
  send: (data: object) => void
): Promise<StreamResult> {
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      stream: true,
      system: systemPrompt,
      messages,
      tools: [
        ...CUSTOM_TOOLS.map((t) => ({ type: "custom" as const, ...t })),
        WEB_SEARCH_TOOL,
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text();
    throw new Error(`Claude API: ${anthropicRes.status} — ${err}`);
  }

  const reader = anthropicRes.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const blockTypes: Record<number, string> = {};
  const blockAccumulator: Record<number, string> = {};
  const blockNames: Record<number, string> = {};
  const blockIds: Record<number, string> = {};
  const contentBlocks: ContentBlock[] = [];
  let stopReason = "end_turn";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const rawData = line.slice(6);
      if (rawData === "[DONE]") continue;

      let evt: Record<string, unknown>;
      try { evt = JSON.parse(rawData); } catch { continue; }
      const evtType = evt.type as string;

      if (evtType === "content_block_start") {
        const idx = evt.index as number;
        const block = evt.content_block as Record<string, unknown>;
        const blockType = block.type as string;
        blockTypes[idx] = blockType;
        blockAccumulator[idx] = "";

        if (blockType === "tool_use") {
          blockNames[idx] = block.name as string;
          blockIds[idx] = block.id as string;
          const label = TOOL_LABELS[block.name as string];
          if (label) {
            send({ t: "tool", name: block.name, label });
            send({ t: "status", msg: label });
          } else if (block.name === "web_search") {
            send({ t: "status", msg: "Търся в интернет..." });
          }
        }
      }

      if (evtType === "content_block_delta") {
        const idx = evt.index as number;
        const delta = evt.delta as Record<string, unknown>;
        const blockType = blockTypes[idx];

        if (blockType === "text" && delta.type === "text_delta") {
          const text = delta.text as string;
          blockAccumulator[idx] = (blockAccumulator[idx] || "") + text;
          send({ t: "text", d: text });
        }
        if (blockType === "tool_use" && delta.type === "input_json_delta") {
          blockAccumulator[idx] = (blockAccumulator[idx] || "") + ((delta.partial_json as string) || "");
        }
        if (blockType === "tool_result" && delta.type === "text_delta") {
          blockAccumulator[idx] = (blockAccumulator[idx] || "") + ((delta.text as string) || "");
        }
      }

      if (evtType === "content_block_stop") {
        const idx = evt.index as number;
        const blockType = blockTypes[idx];
        const accumulated = blockAccumulator[idx] || "";

        if (blockType === "text" && accumulated) {
          contentBlocks.push({ type: "text", text: accumulated });
        }

        if (blockType === "tool_use") {
          let input = {};
          try { input = JSON.parse(accumulated); } catch { /* empty */ }
          const toolName = blockNames[idx];
          if (toolName === "web_search") {
            const searchInput = input as Record<string, string>;
            if (searchInput.query) send({ t: "search", q: searchInput.query });
          }
          contentBlocks.push({ type: "tool_use", id: blockIds[idx], name: toolName, input });
        }

        if (blockType === "tool_result") {
          try {
            const results = JSON.parse(accumulated);
            if (Array.isArray(results)) {
              const sources = results
                .filter((r: Record<string, unknown>) => r.type === "web_search_result" || r.url)
                .slice(0, 5)
                .map((r: Record<string, unknown>) => ({
                  title: (r.title as string) || (r.url as string) || "",
                  url: (r.url as string) || "",
                }));
              if (sources.length > 0) send({ t: "sources", results: sources });
            }
          } catch { /* ignore */ }
        }
      }

      if (evtType === "message_delta") {
        const delta = evt.delta as Record<string, unknown>;
        if (delta.stop_reason) stopReason = delta.stop_reason as string;
      }
    }
  }

  return { contentBlocks, stopReason };
}

// ---- Bulgarian Editor (Step 2) ----

const EDITOR_PROMPT = `Ти си РЕДАКТОР на български рекламен текст. Получаваш копи от копирайтър и го шлифоваш САМО езиково.

КАКВО ПРАВИШ:
• Поправяш членуване: пълен член (-ът/-ят) за подлог, кратък (-а/-я) за допълнение
• Поправяш клитики: никога в началото на изречение, правилен ред
• Поправяш глаголен вид: свършен за еднократни, несвършен за повтарящи се
• Махаш излишни лични местоимения (аз, ние, той) — спрежението ги прави ясни
• Махаш filler думи: "наистина", "всъщност", "определено", "освен това", "в допълнение"
• Махаш калки от английски: "Това е какво ние правим" → "Ето какво правим"
• Слагаш запетая пред "че" и "който/която/което"
• Махаш запетая пред "и" в просто изречение
• Използваш български кавички: „ " а не " "
• Тире с интервали: " — "
• Разбиваш прекалено дълги изречения
• Оптимизираш словоред: ключовата полза в края на изречението (фокусна позиция)
• Заменяш чуждици с български еквиваленти, когато съществуват
• Заменяш passive voice с active: "Продуктът е създаден от" → "Създадохме"
• Заменяш менторски тон: "Трябва да знаеш" → "Оказва се, че"
• Заменяш команди с покани: "Купи сега!" → "Опитай и ти"

КАКВО НЕ ПРАВИШ:
• НЕ променяш messaging-а, идеите, структурата, форматирането
• НЕ добавяш нови параграфи или секции
• НЕ променяш markdown форматирането (##, •, **bold**)
• НЕ променяш числа, цени, имена на продукти
• НЕ добавяш emoji, които ги няма в оригинала
• НЕ правиш текста по-дълъг

Върни САМО редактирания текст, без коментари, без обяснения. Запази цялата структура и форматиране.`;

async function runEditor(apiKey: string, generatedText: string, send: (data: object) => void): Promise<void> {
  send({ t: "rewrite" });
  send({ t: "status", msg: "Шлифовам българския..." });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      stream: true,
      system: EDITOR_PROMPT,
      messages: [{ role: "user", content: generatedText }],
    }),
  });

  if (!res.ok) {
    // Editor failed — keep original text, don't crash
    console.error("Editor API error:", res.status);
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === "content_block_delta" && evt.delta?.text) {
          send({ t: "text", d: evt.delta.text });
        }
      } catch { /* skip */ }
    }
  }
}

// ---- Main route ----

export async function POST(req: NextRequest) {
  const body = await req.json();
  const clientMessages: { role: string; content: string }[] = body.messages || [];
  const settings = {
    avatar: body.avatar || "Не е избран — попитай потребителя",
    format: body.format || "Meta Feed Ad",
    approach: body.approach || "Образователен",
    intensity: body.intensity ?? 3,
    angle: body.angle || "Желан стейт",
    product: body.product || null,
  };

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return new Response("CLAUDE_API_KEY not configured", { status: 500 });
  }

  const systemPrompt = buildSystemPrompt(settings);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseChunk(data));

      try {
        send({ t: "status", msg: "Зареждам продуктовия каталог..." });
        const products = await fetchProductCatalog();
        send({ t: "status", msg: `${products.length} продукта заредени. Създавам копи...` });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messages: any[] = clientMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const MAX_TOOL_ROUNDS = 5;
        let generatedText = "";

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const result = await streamClaudeResponse(apiKey, systemPrompt, messages, send);

          // Accumulate generated text from this round
          for (const block of result.contentBlocks) {
            if (block.type === "text") generatedText += block.text;
          }

          if (result.stopReason === "end_turn" || result.stopReason !== "tool_use") break;

          const toolUseBlocks = result.contentBlocks.filter((b) => b.type === "tool_use");
          const customToolUses = toolUseBlocks.filter((b) => b.name !== "web_search" && TOOL_LABELS[b.name]);

          if (customToolUses.length === 0) break;

          const toolResults = await Promise.all(
            customToolUses.map(async (toolUse) => {
              const toolResult = await executeTool(toolUse.name, toolUse.input || {}, products);
              return {
                type: "tool_result" as const,
                tool_use_id: toolUse.id,
                content: toolResult,
              };
            })
          );

          messages.push({ role: "assistant", content: result.contentBlocks });
          messages.push({ role: "user", content: toolResults });
          generatedText = ""; // Reset — we want only the final round's text
        }

        // Step 2: Editor pass — polish Bulgarian grammar
        if (generatedText.length > 50) {
          await runEditor(apiKey, generatedText, send);
        }

        send({ t: "done" });
      } catch (err) {
        send({ t: "error", msg: `Грешка: ${String(err)}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
