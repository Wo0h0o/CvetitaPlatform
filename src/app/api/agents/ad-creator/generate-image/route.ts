import { NextRequest, NextResponse } from "next/server";
import { generateImage, generateImageWithReference } from "@/lib/gemini";

export const maxDuration = 60;

const FORMAT_RATIOS: Record<string, string> = {
  "Meta Feed Ad": "1:1",
  "Instagram Stories/Reels": "9:16",
  "Google Ads": "16:9",
  "Carousel (3-5 карти, PAS)": "1:1",
  "Advertorial (дълга форма)": "16:9",
  "Social Post": "1:1",
  "Email Subject + Preview": "16:9",
};

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

    let result;

    if (productImageUrl) {
      // Fetch product image and use as reference
      const refImage = await fetchImageAsBase64(productImageUrl);
      if (refImage) {
        const enhancedPrompt = `Using the product bottle/packaging shown in the reference image, ${prompt}. Keep the EXACT product packaging, label, and branding from the reference image. Do not invent new packaging.`;
        result = await generateImageWithReference(enhancedPrompt, refImage.data, refImage.mimeType, aspectRatio);
      } else {
        // Fallback to text-only if image fetch fails
        result = await generateImage(prompt, aspectRatio);
      }
    } else {
      result = await generateImage(prompt, aspectRatio);
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
