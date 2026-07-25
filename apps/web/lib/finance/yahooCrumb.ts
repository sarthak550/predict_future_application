/**
 * Yahoo cookie+crumb handshake for the quoteSummary API (Key Stats: market
 * cap, trailing P/E, dividend yield, beta, float, trailing EPS).
 *
 * Yahoo crumb-gated quoteSummary in 2023; the handshake is: GET fc.yahoo.com
 * (any Yahoo host) to receive session cookies, then GET /v1/test/getcrumb
 * with those cookies → a short crumb string, replayed as ?crumb= alongside
 * the cookies on quoteSummary calls. VERIFIED WORKING from production EC2
 * 2026-07-26 (RELIANCE.NS: marketCap 17.29T, trailingPE 23.15, floatShares
 * 6.64B — matching TradingView's displayed figures).
 *
 * Cookie+crumb cached in-module for 30 minutes; every failure path returns
 * null (callers degrade to "key stats absent"), never throws.
 */

interface CrumbSession {
  cookie: string;
  crumb: string;
  at: number;
}

let session: CrumbSession | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const UA_HEADER = { "User-Agent": "Mozilla/5.0" };

async function timedFetch(url: string, headers: Record<string, string>): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, cache: "no-store", signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getYahooCrumbSession(): Promise<CrumbSession | null> {
  const now = Date.now();
  if (session && now - session.at < SESSION_TTL_MS) return session;

  const seed = await timedFetch("https://fc.yahoo.com", UA_HEADER);
  if (!seed) return null;
  const headers = seed.headers as Headers & { getSetCookie?: () => string[] };
  const rawCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const cookie = rawCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) return null;

  const crumbRes = await timedFetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { ...UA_HEADER, Cookie: cookie });
  if (!crumbRes || !crumbRes.ok) return null;
  const crumb = (await crumbRes.text()).trim();
  // A real crumb is a short opaque token; an HTML error page is not.
  if (!crumb || crumb.length > 30 || crumb.includes("<")) return null;

  session = { cookie, crumb, at: now };
  return session;
}

/** GET a quoteSummary URL with the crumb session applied. Returns parsed JSON or null. */
export async function fetchQuoteSummary(symbol: string, modules: string[]): Promise<unknown | null> {
  const s = await getYahooCrumbSession();
  if (!s) return null;
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(",")}&crumb=${encodeURIComponent(s.crumb)}`;
  const res = await timedFetch(url, { ...UA_HEADER, Cookie: s.cookie });
  if (!res || !res.ok) {
    // A 401 usually means the crumb expired server-side — drop the session so
    // the next call re-handshakes rather than serving nulls for 30 minutes.
    if (res && (res.status === 401 || res.status === 403)) session = null;
    return null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}
