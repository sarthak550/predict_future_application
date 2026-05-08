/**
 * Article body fetcher using Mozilla Readability + jsdom.
 *
 * Fetches the HTML of a given article URL, extracts the main readable body text,
 * and returns it trimmed and capped. Designed to feed the AI expert opinion
 * extraction pipeline with richer content than RSS headline + summary alone.
 *
 * Design contracts:
 * - Never throws — all errors are returned as { text: null, error: string }.
 * - Per-domain throttle: minimum 1500ms between fetches from the same hostname.
 * - Rejects non-HTML content-types and responses over 5MB.
 * - Rejects extracted body text shorter than 200 chars (paywall stub heuristic).
 * - Caps returned text at 8000 chars.
 * - 10-second network timeout via AbortController.
 */

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const USER_AGENT =
  "Mozilla/5.0 (compatible; PredictFutureBot/1.0; +https://predictfuture.app)";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_CONTENT_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_BODY_CHARS = 200;
const MAX_BODY_CHARS = 8_000;
const DOMAIN_THROTTLE_MS = 1_500;

/** Module-level per-domain throttle map: hostname → last fetch timestamp (ms). */
const lastFetchByDomain = new Map<string, number>();

function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Enforces per-domain throttling. If the domain was fetched less than
 * DOMAIN_THROTTLE_MS ago, waits for the remaining cooldown period.
 */
async function throttleDomain(hostname: string): Promise<void> {
  const last = lastFetchByDomain.get(hostname);
  if (last !== undefined) {
    const elapsed = Date.now() - last;
    if (elapsed < DOMAIN_THROTTLE_MS) {
      const waitMs = DOMAIN_THROTTLE_MS - elapsed;
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }
  lastFetchByDomain.set(hostname, Date.now());
}

export type ArticleBodyResult = {
  text: string | null;
  error: string | null;
};

/**
 * Fetches the article at `sourceUrl`, extracts the main readable body text via
 * Mozilla Readability, and returns it. Never throws.
 *
 * @param sourceUrl - The canonical URL of the article to scrape.
 * @returns `{ text, error }` — exactly one will be non-null.
 */
export async function fetchArticleBody(
  sourceUrl: string
): Promise<ArticleBodyResult> {
  const hostname = getHostname(sourceUrl);
  if (!hostname) {
    return { text: null, error: `Invalid URL: ${sourceUrl}` };
  }

  // Per-domain throttle — wait if needed before sending the request
  await throttleDomain(hostname);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    // AbortController fires a DOMException with name 'AbortError'
    if (msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout")) {
      return { text: null, error: `Fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${sourceUrl}` };
    }
    return { text: null, error: `Network error fetching ${sourceUrl}: ${msg}` };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return {
      text: null,
      error: `HTTP ${response.status} ${response.statusText} for ${sourceUrl}`,
    };
  }

  // Content-type guard: only process HTML responses
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    return {
      text: null,
      error: `Non-HTML content-type "${contentType}" for ${sourceUrl}`,
    };
  }

  // Content-length guard: reject oversized responses before downloading body
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_BYTES) {
    return {
      text: null,
      error: `Content-Length ${contentLength} exceeds 5MB limit for ${sourceUrl}`,
    };
  }

  // Stream body with size cap to avoid downloading huge pages
  let html: string;
  try {
    const reader = response.body?.getReader();
    if (!reader) {
      // Fallback: read as text directly (no streaming support in this environment)
      const text = await response.text();
      if (text.length > MAX_CONTENT_BYTES) {
        return {
          text: null,
          error: `Response body exceeds 5MB limit for ${sourceUrl}`,
        };
      }
      html = text;
    } else {
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_CONTENT_BYTES) {
            reader.cancel();
            return {
              text: null,
              error: `Response body exceeds 5MB limit for ${sourceUrl}`,
            };
          }
          chunks.push(value);
        }
      }
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      html = new TextDecoder().decode(combined);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: null, error: `Failed to read response body for ${sourceUrl}: ${msg}` };
  }

  // Parse HTML with jsdom and extract readable content via Readability
  let bodyText: string | null = null;
  try {
    const dom = new JSDOM(html, { url: sourceUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    bodyText = article?.textContent?.trim() ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: null, error: `Readability parse failed for ${sourceUrl}: ${msg}` };
  }

  if (!bodyText) {
    return { text: null, error: `Readability returned no content for ${sourceUrl}` };
  }

  // Paywall stub heuristic: reject suspiciously short content
  if (bodyText.length < MIN_BODY_CHARS) {
    return {
      text: null,
      error: `Extracted body too short (${bodyText.length} chars < ${MIN_BODY_CHARS}) — likely paywall stub for ${sourceUrl}`,
    };
  }

  // Cap at 8000 chars to keep AI prompts manageable
  const cappedText = bodyText.length > MAX_BODY_CHARS
    ? bodyText.slice(0, MAX_BODY_CHARS)
    : bodyText;

  return { text: cappedText, error: null };
}
