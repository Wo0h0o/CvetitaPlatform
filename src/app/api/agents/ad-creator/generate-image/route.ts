import { NextRequest, NextResponse } from "next/server";
import { generateImage, generateImageWithReference } from "@/lib/gemini";
import { LANGUAGE_CONFIGS } from "@/lib/ad-creator-languages";

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
8. Text rules DEPEND on creative type (see Creative Types below)
9. Keep it under 200 words — dense and specific, no fluff

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

## Creative Types — FOLLOW STRICTLY based on the selected type

### "Продуктова снимка" / Product shot
- Clean, minimal background, hero product centered, studio lighting
- NO text, no typography, no words. Add: "no text, no watermarks, no typography"

### "Научен / Инфо"
- Infographic-style design with the product as the centerpiece
- Include EXACTLY 3 short text labels (max 3-4 words each) as benefit badges around the product
- ALL text in the image MUST be in the TARGET LANGUAGE specified in the request (see language instruction below).
- LESS IS MORE: lots of white space, only 3 benefit badges, one headline. No walls of text.
- Use clean typography: Montserrat bold, white text on forest green rounded badges
- Layout: product hero center (60% of frame), 3 small badges positioned around it
- Visual accents: subtle ingredient elements (leaves, powder), molecular icons as decoration only
- Colors: forest green, white, gold accents — clean scientific feel
- Think: premium Apple-style product page, NOT a cluttered flyer

### "Lifestyle"
- Product in real-world context (kitchen, gym, nature, morning routine)
- NO text, no typography. Add: "no text, no watermarks, no typography"

### "Lifestyle + текст"
- Same scene as Lifestyle BUT with text overlay integrated into the image
- Include the headline/hook text directly on the image in bold Montserrat font
- ALL text in the image MUST be in the TARGET LANGUAGE specified in the request (see language instruction below).
- Position text in the top or bottom third with semi-transparent background bar
- Text should be large, readable, and contrast well with the background
- The text content will be provided in the creative direction

## Brand Context: Cvetita Herbal
- Bulgarian premium supplement brand
- Aesthetic: clean, scientific yet natural, premium European feel
- Scene colors: earth tones, whites, natural greens, warm wood, marble
- Vibe: trusted pharmacy brand meets modern wellness
- IMPORTANT: product packaging varies per product — do NOT assume any specific packaging style

## Output format
Return ONLY the prompt text. No explanations, no markdown, no labels.`;

const ARCHETYPE_COMPOSITION: Record<string, string> = {
  pas: "Composition: Show the PROBLEM visually (tired face, slouched posture, empty coffee cups) on one side, and the SOLUTION (product + vibrant energy) on the other. Split composition or gradient transition.",
  mirror: "Composition: Show a person in a reflective moment — looking at mirror, catching reflection in window, quiet self-assessment. Emotional, introspective lighting. The mood is quiet realization, not dramatic despair.",
  enemy: "Composition: Visualize the THREAT (stress, toxins, modern lifestyle — dark/cold tones) being countered by the product (warm, natural tones). Product as shield/ally. Contrast between harmful environment and natural solution.",
  ingredient: "Composition: Hero the KEY INGREDIENT — raw botanical, herb, plant close-up alongside the product. Show provenance: mountains, nature, harvesting. Documentary/editorial feel, not commercial.",
  ugc: "Composition: Native, unpolished feel — as if shot on phone. Real person, real setting (kitchen counter, bathroom shelf, gym bag). Product shown casually, not staged. Authentic, not perfect.",
  expert: "Composition: Clinical credibility — clean background, professional setting. Product displayed alongside scientific elements (molecular structures, lab equipment as subtle props). Authority and trust.",
  comparison: "Composition: Side-by-side or split-frame layout. Product on one side with clear, transparent labeling. Other side shows generic/inferior alternative (blurred or muted). Highlight the difference visually.",
  ritual: "Composition: Product integrated into a beautiful daily ROUTINE moment — morning light, preparation ritual, mixing/pouring. Aspirational but achievable lifestyle. Warm, inviting atmosphere.",
  origin: "Composition: Bulgarian heritage — Rhodope mountains, wild herbs, traditional harvesting, natural landscapes. Product placed in nature context. Earthy, authentic, rooted in tradition.",
  beforeafter: "Composition: SPLIT-FRAME or SEQUENCE showing transformation. Left/top = BEFORE state (muted colors, low energy, tired). Right/bottom = AFTER state (vibrant colors, energy, vitality). The transformation is EMOTIONAL/ENERGY, not body shape. This split composition is MANDATORY — do not generate a single-scene image.",
};

async function artDirectorRefine(
  rawPrompt: string,
  format: string,
  aspectRatio: string,
  hasReferenceImage: boolean,
  creativeType: string,
  headline?: string,
  language: string = "bg",
  archetype: string = "pas"
): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return rawPrompt; // graceful fallback

  const langConfig = LANGUAGE_CONFIGS[language] || LANGUAGE_CONFIGS.bg;
  const needsText = creativeType === "Научен / Инфо" || creativeType === "Lifestyle + текст";
  const dimensions = FORMAT_DIMENSIONS[aspectRatio] || "1080x1080px";
  const languageInstruction = needsText
    ? `- TARGET LANGUAGE for all text on the image: ${langConfig.nativeName} (${langConfig.script} script). ALL text labels, headlines, and badges MUST be written in ${langConfig.nativeName}. NEVER use English or Bulgarian (unless that IS the target language).`
    : "";
  const archetypeInstruction = ARCHETYPE_COMPOSITION[archetype] || "";
  const userMessage = [
    `## Raw creative direction:\n${rawPrompt}`,
    needsText && headline ? `## Text to include in image:\n${headline}` : "",
    `## Technical specs:`,
    `- Ad format: ${format}`,
    `- Aspect ratio: ${aspectRatio} (${dimensions})`,
    `- Creative type: ${creativeType} — FOLLOW the specific rules for this type`,
    archetypeInstruction ? `- Creative archetype: ${archetype}\n  ${archetypeInstruction}` : "",
    languageInstruction,
    `- Reference product image provided: ${hasReferenceImage ? "YES — describe ONLY the scene/environment. Do NOT describe the product packaging at all — the model receives the actual photo." : "NO — say 'a premium supplement product', do NOT invent packaging details"}`,
    `\nTransform this into a production-ready image generation prompt. The archetype composition direction is IMPORTANT — it defines the visual structure of the image. The creative type defines the style (photo vs infographic vs text overlay).`,
  ].filter(Boolean).join("\n");

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
    const { prompt, format, productImageUrl, creativeType, headline, language, archetype } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const aspectRatio = FORMAT_RATIOS[format] || "1:1";
    const hasRef = !!productImageUrl;
    const lang = language || "bg";

    // Step 1: Art Director refines the prompt
    const refinedPrompt = await artDirectorRefine(prompt, format, aspectRatio, hasRef, creativeType || "Lifestyle", headline, lang, archetype || "pas");

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
