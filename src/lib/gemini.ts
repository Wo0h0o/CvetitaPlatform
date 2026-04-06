import { fetchWithTimeout } from "./fetch-utils";
import { logger } from "./logger";

const GEMINI_MODEL = "gemini-3-pro-image-preview";
const GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-image-preview";

function getApiKey(): string {
  return process.env.GEMINI_API_KEY || "";
}

function extractImage(data: Record<string, unknown>): { image: string; mimeType: string } | null {
  const candidates = data.candidates as Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> | undefined;
  const parts = candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        image: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png",
      };
    }
  }
  return null;
}

async function callGemini(
  model: string,
  contents: unknown[],
  aspectRatio: string,
  apiKey: string
): Promise<{ image: string; mimeType: string } | null> {
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio },
        },
      }),
    },
    60_000
  );

  if (!res.ok) {
    const err = await res.text();
    logger.error("Gemini API error", { service: "gemini", model, status: res.status });
    return null;
  }

  const data = await res.json();
  return extractImage(data);
}

async function callWithFallback(
  contents: unknown[],
  aspectRatio: string
): Promise<{ image: string; mimeType: string } | null> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  // Try primary model
  const result = await callGemini(GEMINI_MODEL, contents, aspectRatio, apiKey);
  if (result) return result;

  // Fallback
  logger.warn("Gemini primary model failed, using fallback", { service: "gemini", primary: GEMINI_MODEL, fallback: GEMINI_FALLBACK_MODEL });
  const fallback = await callGemini(GEMINI_FALLBACK_MODEL, contents, aspectRatio, apiKey);
  if (fallback) return fallback;

  throw new Error("Image generation failed on both primary and fallback models");
}

export async function generateImage(
  prompt: string,
  aspectRatio: string = "1:1"
): Promise<{ image: string; mimeType: string } | null> {
  return callWithFallback(
    [{ role: "user", parts: [{ text: prompt }] }],
    aspectRatio
  );
}

export async function generateImageWithReference(
  prompt: string,
  referenceImageBase64: string,
  referenceMimeType: string = "image/png",
  aspectRatio: string = "1:1"
): Promise<{ image: string; mimeType: string } | null> {
  return callWithFallback(
    [{
      role: "user",
      parts: [
        { inlineData: { mimeType: referenceMimeType, data: referenceImageBase64 } },
        { text: prompt },
      ],
    }],
    aspectRatio
  );
}
