import { NextRequest } from "next/server";
import { fetchProductCatalog, searchProducts, fetchProductByHandle, stripHtml, type ShopifyProduct } from "@/lib/shopify";
import { LANGUAGE_CONFIGS, type LanguageConfig } from "@/lib/ad-creator-languages";

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
  audience: string;
  product: string | null;
  creativeType: string;
  language: string;
  formality: string;
}): string {
  const lang: LanguageConfig = LANGUAGE_CONFIGS[settings.language] || LANGUAGE_CONFIGS.bg;
  const formalityRule = settings.formality === "formal" ? lang.formalityInstruction.formal : lang.formalityInstruction.informal;
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
• Аудитория: ${settings.audience}
• Интензивност: ${settings.intensity}/5 — ${intensityGuide[settings.intensity] || intensityGuide[3]}
• Емоционален ъгъл: ${settings.angle}
• Тип креатив: ${settings.creativeType}
• Избран продукт: ${settings.product ? `handle="${settings.product}" — ЗАДЪЛЖИТЕЛНО извикай get_product_details за пълна информация преди да пишеш копи` : "Не е избран — попитай потребителя или използвай search_products"}

== ГЛАС НА БРАНДА ==
НИЕ СМЕ: Компетентни, образователни (без снизхождение), грижовни (без натиск), конкретни (числа, факти, механизми), стойност на първо място.
НИЕ НЕ СМЕ: Отчаяни продавачи, discount pushers, генерични, агресивни closers.
Структура: ПОЛЗА → МЕХАНИЗЪМ → ДОКАЗАТЕЛСТВО
Тон тест: "Бих ли казал това на приятел с кафе?" Ако звучи формално — пренапиши.
Менторски тон забранен: "Оказва се, че..." НЕ "Трябва да знаеш, че..."
Общност: "Често ни питате за...", "Нашите клиенти споделят, че..."

${lang.grammarRules}

${formalityRule}

${lang.culturalRules}

${lang.exampleCopy}

${lang.complianceWording}

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
1. Write ALL ad copy in ${lang.nativeName} (${lang.label}). The output MUST be entirely in ${lang.nativeName} — not in Bulgarian or English (unless the selected language IS Bulgarian or English). Internal labels like "## Вариант A" stay in Bulgarian for parsing.
2. Използвай search_products / get_product_details за реални данни — НИКОГА не измисляй продуктови характеристики
3. ВИНАГИ давай точно 4 варианта (A/B/C/D test ready). Всеки с различен ъгъл или hook.
4. При Meta реклами — Hook в първите 125 символа, Headline до 40 символа
5. Без discount-first messaging, без фалшива спешност

== ФОРМАТ НА ОТГОВОРА ==
За ВСЕКИ от 4-те варианта, следвай ТОЧНО тази структура (labels ТРЯБВА да са точно както са дадени):

## ${lang.outputLabels.variant} A: [кратко име на ъгъла]

**${lang.outputLabels.hook}:**
[текст на hook-а]

**${lang.outputLabels.body}:**
[пълен текст на рекламата]

**${lang.outputLabels.headline}:**
[headline]

**${lang.outputLabels.cta}:**
[call to action]

**${lang.outputLabels.visualDirection}:**
[кратко описание на визуала — цветове, композиция, стил]

**${lang.outputLabels.imagePrompt}:**
[ДЕТАЙЛЕН prompt на АНГЛИЙСКИ за генериране на изображение. Включва: продукт, стил (${settings.creativeType}), настроение, цветове (#2D5016 forest green, #C4922A gold, #F5F2EB off-white), композиция, осветление. НЕ включвай текст върху изображението. Формат: professional product photography / lifestyle photography / editorial style.]

---

След 4-те варианта, добави:
## ${lang.outputLabels.recommendation}
Кой вариант за коя аудитория е най-подходящ и защо.`;
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

function buildEditorPrompt(language: string): string {
  const lang = LANGUAGE_CONFIGS[language] || LANGUAGE_CONFIGS.bg;
  return lang.editorPrompt;
}

async function runEditor(apiKey: string, generatedText: string, send: (data: object) => void, language: string = "bg"): Promise<void> {
  const langConfig = LANGUAGE_CONFIGS[language] || LANGUAGE_CONFIGS.bg;
  send({ t: "status", msg: language === "bg" ? "Шлифовам българския..." : `Polishing ${langConfig.nativeName} copy...` });

  const editorPrompt = buildEditorPrompt(language);

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
      system: editorPrompt,
      messages: [{ role: "user", content: generatedText }],
    }),
  });

  if (!res.ok) {
    console.error("Editor API error:", res.status);
    return;
  }

  const data = await res.json();
  const editedText = data.content?.[0]?.text;

  if (editedText && editedText.length > 20) {
    send({ t: "replace", content: editedText });
  }
}

// ---- Main route ----

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const clientMessages: { role: string; content: string }[] = body.messages || [];
  const settings = {
    avatar: body.avatar || "Не е избран — попитай потребителя",
    format: body.format || "Meta Feed Ad",
    approach: body.approach || "Образователен",
    intensity: body.intensity ?? 3,
    angle: body.angle || "Желан стейт",
    audience: body.audience || "Студена (TOFU)",
    product: body.product || null,
    creativeType: body.creativeType || "Продуктова снимка",
    language: body.language || "bg",
    formality: body.formality || "informal",
  };

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "CLAUDE_API_KEY not configured" }, { status: 500 });
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

        // Step 2: Editor pass — polish grammar for selected language
        if (generatedText.length > 50) {
          await runEditor(apiKey, generatedText, send, settings.language);
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
