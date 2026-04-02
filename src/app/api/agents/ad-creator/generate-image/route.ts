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
8. For product shots: describe exact placement, shadows, reflections
9. For lifestyle: describe the person's pose, environment, emotion — but NEVER generate text on the image
10. NEVER include text, typography, headlines, or words IN the image — the image is purely visual
11. Include negative prompt elements: "no text, no watermarks, no logos, no typography"
12. Keep it under 300 words — dense and specific, no fluff

## CRITICAL: Reference Product Image Handling
When a reference product image is provided, this is the MOST IMPORTANT part of your prompt:
- The reference image shows the EXACT product that MUST appear in the final image
- Your prompt MUST start with: "Photorealistic product photography. The product from the reference image must be reproduced with PIXEL-PERFECT accuracy — same bottle shape, same label design, same colors, same proportions, same cap/lid."
- Then describe the SCENE/ENVIRONMENT around the product (lighting, surface, background, props)
- NEVER describe the product itself — only say "the exact product from the reference image"
- NEVER say "similar bottle" or "dark glass bottle" — always "the IDENTICAL product from the reference"
- Emphasize: "Do NOT redesign, reinterpret, or reimagine the product packaging. Copy it exactly as shown."
- Add: "The label text, logo placement, color scheme, and bottle shape must be an exact match to the reference."

When NO reference image is provided:
- Describe a generic premium dark glass supplement bottle with forest green and gold label
- Focus on the scene/environment

## Brand Context: Cvetita Herbal
- Bulgarian premium supplement brand
- Aesthetic: clean, scientific yet natural, premium European feel
- Colors: forest green, gold accents, clean white, deep earth tones
- Vibe: trusted pharmacy brand meets modern wellness — NOT MLM/hype supplement look
- Packaging: dark glass bottles with gold/green labels

## Output format
Return ONLY the prompt text. No explanations, no markdown, no labels.`;

async function artDirectorRefine(
  rawPrompt: string,
  format: string,
  aspectRatio: string,
  hasReferenceImage: boolean
): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return rawPrompt; // graceful fallback

  const dimensions = FORMAT_DIMENSIONS[aspectRatio] || "1080x1080px";
  const userMessage = [
    `## Raw creative direction:\n${rawPrompt}`,
    `## Technical specs:`,
    `- Ad format: ${format}`,
    `- Aspect ratio: ${aspectRatio} (${dimensions})`,
    `- Reference product image provided: ${hasReferenceImage ? "YES — the model will receive the exact product photo. Your prompt must instruct pixel-perfect reproduction of that product. Describe ONLY the scene/environment, NOT the product itself." : "NO — describe a generic premium dark glass supplement bottle with forest green and gold label"}`,
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
    const { prompt, format, productImageUrl } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const aspectRatio = FORMAT_RATIOS[format] || "1:1";
    const hasRef = !!productImageUrl;

    // Step 1: Art Director refines the prompt
    const refinedPrompt = await artDirectorRefine(prompt, format, aspectRatio, hasRef);

    // Step 2: Generate image with refined prompt
    let result;

    if (productImageUrl) {
      const refImage = await fetchImageAsBase64(productImageUrl);
      if (refImage) {
        const finalPrompt = `CRITICAL INSTRUCTION: The reference image shows the EXACT product that must appear in this image. You MUST reproduce this product with pixel-perfect accuracy — identical bottle shape, identical label, identical colors, identical cap, identical proportions. Do NOT redesign or reinterpret the packaging in any way. The product must look like a photograph of the real object, not a recreation.

Scene description: ${refinedPrompt}

REMINDER: The product from the reference image must be copied exactly. Same label text placement, same logo, same color scheme, same bottle shape. Any deviation from the reference product is a failure.`;
        result = await generateImageWithReference(finalPrompt, refImage.data, refImage.mimeType, aspectRatio);
      } else {
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
