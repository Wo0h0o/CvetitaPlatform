import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/gemini";

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

export async function POST(req: NextRequest) {
  try {
    const { prompt, format } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const aspectRatio = FORMAT_RATIOS[format] || "1:1";

    const result = await generateImage(prompt, aspectRatio);

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
