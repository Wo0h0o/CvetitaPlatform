const GEMINI_MODEL = "gemini-2.0-flash-preview-image-generation";

function getApiKey(): string {
  return process.env.GEMINI_API_KEY || "";
}

export async function generateImage(
  prompt: string,
  aspectRatio: string = "1:1"
): Promise<{ image: string; mimeType: string } | null> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio,
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("Gemini API error:", res.status, err);
    throw new Error(`Gemini API: ${res.status}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];

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

export async function generateImageWithReference(
  prompt: string,
  referenceImageBase64: string,
  referenceMimeType: string = "image/png",
  aspectRatio: string = "1:1"
): Promise<{ image: string; mimeType: string } | null> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: referenceMimeType,
                  data: referenceImageBase64,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio,
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("Gemini API error:", res.status, err);
    throw new Error(`Gemini API: ${res.status}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];

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
