import { NextRequest } from "next/server";
import { analysisPrompts } from "@/lib/prompts";
import { fetchBusinessContext, formatContextForPrompt } from "@/lib/agent-context";
import { requireAuth } from "@/lib/api-auth";

// Using Node.js runtime for env var access; switch to edge on Vercel if needed
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { type, country } = await req.json();

  const promptFn = analysisPrompts[type];
  if (!promptFn) {
    return new Response("Invalid analysis type", { status: 400 });
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return new Response("CLAUDE_API_KEY not configured", { status: 500 });
  }

  const baseUrl = req.nextUrl.origin;
  const cookie = req.headers.get("cookie") || "";
  const ctx = await fetchBusinessContext(baseUrl, { cookie });
  const businessContext = formatContextForPrompt(ctx);
  const prompt = promptFn(country) + "\n\n" + businessContext;

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
        max_tokens: 2000,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Anthropic API error:", err);
      return new Response(`API error: ${res.status}`, { status: 502 });
    }

    // Transform SSE stream to plain text stream
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                controller.enqueue(encoder.encode(parsed.delta.text));
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    console.error("Analysis error:", error);
    return new Response("Analysis failed", { status: 500 });
  }
}
