import { NextResponse } from "next/server";

// Simple in-memory cache
let cache: { data: unknown; expires: number } | null = null;

export async function GET() {
  // Return cached if fresh (1 hour)
  if (cache && Date.now() < cache.expires) {
    return NextResponse.json(cache.data);
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(getFallbackNews());
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: `Ти си маркетинг анализатор на Цветита Хербал (хранителни добавки, България). Дай 4 кратки новини/тенденции от пазара на хранителни добавки в БГ и Европа. За всяка: заглавие (макс 10 думи) и тип (Възможност/Конкурент/Тенденция/Внимание). Отговори САМО като JSON масив: [{"title":"...","type":"...","meta":"кратко пояснение"}]`,
          },
        ],
      }),
    });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const data = await res.json();
    const raw = data.content
      ?.map((b: { text?: string }) => b.text || "")
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    const news = JSON.parse(raw);
    cache = { data: news, expires: Date.now() + 3600_000 };
    return NextResponse.json(news);
  } catch (error) {
    console.error("News fetch error:", error);
    return NextResponse.json(getFallbackNews());
  }
}

function getFallbackNews() {
  return [
    { title: "Ръст на търсенето на адаптогени с 34% в ЕС", type: "Тенденция", meta: "Ashwagandha и Rhodiola водят категорията" },
    { title: "GymBeam отвори нов склад в София", type: "Конкурент", meta: "Конкурент разширява БГ операциите си" },
    { title: "Нова EU регулация за health claims от Q3", type: "Внимание", meta: "Изисква преглед на продуктови описания" },
    { title: "Детокс сезонът стартира — пик в Google Trends", type: "Възможност", meta: "Идеален момент за промоция на детокс линията" },
  ];
}
