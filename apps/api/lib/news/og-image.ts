/**
 * Returns true when the URL points to a Google News redirect that cannot
 * be resolved to the actual article without JavaScript execution.
 */
export function isGoogleNewsUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes("news.google.");
  } catch {
    return false;
  }
}

/**
 * Lightweight Open Graph image extractor. Fetches a page and looks for
 * og:image or twitter:image meta tags. Times out quickly so it doesn't
 * block ingestion.
 *
 * Automatically skips Google News redirect URLs (they require JS to resolve).
 */
export async function fetchOgImage(url: string, timeoutMs = 4000): Promise<string | null> {
  if (isGoogleNewsUrl(url)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PredictFutureBot/1.0)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    // Only read the first 50KB — og:image is always in <head>
    const reader = res.body?.getReader();
    if (!reader) return null;

    let html = "";
    const decoder = new TextDecoder();
    while (html.length < 50_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      // Stop once we've passed </head>
      if (html.includes("</head>")) break;
    }
    reader.cancel().catch(() => {});

    // Try og:image first, then twitter:image
    const ogMatch = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    ) ?? html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
    );
    if (ogMatch?.[1]) return ogMatch[1];

    const twMatch = html.match(
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
    ) ?? html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
    );
    if (twMatch?.[1]) return twMatch[1];

    return null;
  } catch {
    return null;
  }
}
