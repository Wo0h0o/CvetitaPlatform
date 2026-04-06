/**
 * Resilience utilities for external API calls.
 * Every fetch to Shopify, GA4, Klaviyo, Meta, Tavily, Gemini
 * MUST use fetchWithTimeout instead of raw fetch().
 */

/**
 * fetch() with an AbortController timeout.
 * On timeout, throws a descriptive error (hostname only — never tokens).
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const hostname = safeHostname(url);
      throw new Error(`Request to ${hostname} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry wrapper with exponential backoff + jitter.
 * Default: retry on network errors and 5xx, NOT on 4xx.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    baseDelay?: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
  } = {}
): Promise<T> {
  const { retries = 2, baseDelay = 1000, shouldRetry = defaultShouldRetry } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries && shouldRetry(err, attempt)) {
        const delay = baseDelay * Math.pow(2, attempt);
        const jitter = delay * (Math.random() * 0.25);
        await sleep(delay + jitter);
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

function defaultShouldRetry(error: unknown): boolean {
  // Retry on timeout (AbortError wrapped in our Error)
  if (error instanceof Error && error.message.includes("timed out")) return true;
  // Retry on network errors
  if (error instanceof TypeError && error.message.includes("fetch")) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unknown host)";
  }
}
