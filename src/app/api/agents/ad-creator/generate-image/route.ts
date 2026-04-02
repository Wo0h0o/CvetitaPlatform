import { NextRequest, NextResponse } from "next/server";
import { generateImage, generateImageWithReference } from "@/lib/gemini";

export const maxDuration = 120;

const FORMAT_RATIOS: Record<string, string> = {
  "Meta Feed Ad": "1:1",
  "Instagram Stories/Reels": "9:16",
  "Google Ads": "16:9",
  "Carousel (3-5 карти, PAS)": "1:1",
  "Advertorial (дълга форма)": "16:9",
  "Social Post": "1:1",
  "Email Subject + Preview": "16:9",
};

const FORMAT_DIMENSIONS: Record<string, string> = {
  "1:1": "1080x1080px",
  "9:16": "1080x1920px",
  "16:9": "1920x1080px",
};

const ART_DIRECTOR_PROMPT = `You are an elite Art Director specializing in supplement and wellness brand advertising photography and design.

Your job: take a rough creative direction (often in Bulgarian) and transform it into a precise, production-ready image generation prompt in English.

## Rules

1. ALWAYS output in English — the image model only understands English
2. Be SPECIFIC about composition: what's in foreground, midground, background
3. Specify lighting: direction, quality (soft/hard), color temperature
4. Specify color palette: exact colors, mood, contrast
5. Specify style: photographic vs illustrated, matte vs glossy, minimal vs rich
6. Specify camera angle and framing: overhead, eye-level, 45°, close-up, wide
7. Include texture and material descriptions for surfaces
8. NEVER include text, typography, headlines, or words IN the image — purely visual
9. Include: "no text, no watermarks, no logos, no typography, no words"
10. Keep it under 200 words — dense and specific, no fluff

## CRITICAL: Reference Product Image
When a reference image is provided:
- DO NOT describe the product at all. Zero words about bottle shape, color, label, cap, material.
- The product packaging varies widely (white jars, dark glass bottles, boxes, sachets) — you do NOT know what it looks like. The reference image is the only truth.
- Say ONLY: "the exact product from the reference image" when referring to the product
- Your ENTIRE job is to describe the SCENE: surface, background, lighting, props, mood, camera angle
- Start your prompt with: "Place the exact product from the reference image in this scene:"

When NO reference image is provided:
- Say "a premium supplement product" — do NOT invent specific packaging details
- Focus on the scene/environment

## Creative Types
- "Продуктова снимка" / Product shot: clean, minimal background, hero product centered, studio lighting
- "Научен / Инфо": flat lay with scientific props (molecules diagram props, herbs, measuring tools), clean infographic feel
- "Lifestyle": product in real-world context (kitchen, gym, nature, morning routine), with or without person
- "Lifestyle + текст": same as Lifestyle but leave clear negative space (top or bottom third) for text overlay that will be added later

## Brand Context: Cvetita Herbal
- Bulgarian premium supplement brand
- Aesthetic: clean, scientific yet natural, premium European feel
- Scene colors: earth tones, whites, natural greens, warm wood, marble
- Vibe: trusted pharmacy brand meets modern wellness
- IMPORTANT: product packaging varies per product — do NOT assume any specific packaging style

## Output format
Return ONLY the prompt text. No explanations, no markdown, no labels.`;

async function artDirectorRefine(
  rawPrompt: string,
  format: string,
  aspectRatio: string,
  hasReferenceImage: boolean,
  creativeType: string
): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return rawPrompt; // graceful fallback

  const dimensions = FORMAT_DIMENSIONS[aspectRatio] || "1080x1080px";
  const userMessage = [
    `## Raw creative direction:\n${rawPrompt}`,
    `## Technical specs:`,
    `- Ad format: ${format}`,
    `- Aspect ratio: ${aspectRatio} (${dimensions})`,
    `- Creative type: ${creativeType}`,
    `- Reference product image provided: ${hasReferenceImage ? "YES — describe ONLY the scene/environment. Do NOT describe the product packaging at all — the model receives the actual photo." : "NO — say 'a premium supplement product', do NOT invent packaging details"}`,
    `\nTransform this into a production-ready image generation prompt.`,
  ].join("\n");

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
        max_tokens: 1024,
        system: ART_DIRECTOR_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!res.ok) {
      console.error("Art Director API error:", res.status);
      return rawPrompt;
    }

    const data = await res.json();
    const refined = data.content?.[0]?.text?.trim();

    if (refined && refined.length > 20) {
      console.log("[Art Director] Refined prompt:", refined.substring(0, 150) + "...");
      return refined;
    }
  } catch (err) {
    console.error("Art Director error:", err);
  }

  return rawPrompt;
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const contentType = res.headers.get("content-type") || "image/png";
    return { data: base64, mimeType: contentType };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, format, productImageUrl, creativeType } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const aspectRatio = FORMAT_RATIOS[format] || "1:1";
    const hasRef = !!productImageUrl;

    // Step 1: Art Director refines the prompt
    const refinedPrompt = await artDirectorRefine(prompt, format, aspectRatio, hasRef, creativeType || "Lifestyle");

    // Step 2: Generate image with refined prompt
    let result;

    if (productImageUrl) {
      const refImage = await fetchImageAsBase64(productImageUrl);
      if (refImage) {
        const finalPrompt = `Reproduce the product from the reference image exactly as-is in this scene. Do not alter the packaging. ${refinedPrompt}`;
        result = await generateImageWithReference(finalPrompt, refImage.data, refImage.mimeType, aspectRatio);
      } else {
        console.warn("[Image Gen] Failed to fetch product image from:", productImageUrl);
        // Generate without reference — Art Director already handles this case
        result = await generateImage(refinedPrompt, aspectRatio);
      }
    } else {
      result = await generateImage(refinedPrompt, aspectRatio);
    }

    if (!result) {
      return NextResponse.json({ error: "No image generated" }, { status: 500 });
    }

    return NextResponse.json({
      image: result.image,
      mimeType: result.mimeType,
    });
  } catch (error) {
    console.error("Image generation error:", error);
    return NextResponse.json(
      { error: `Image generation failed: ${String(error)}` },
      { status: 500 }
    );
  }
}
