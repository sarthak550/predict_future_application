export type AuthTokenProvider = (() => string | null | undefined | Promise<string | null | undefined>) | undefined;

export const AUTHORIZATION_HEADER = "Authorization";

export async function buildAuthHeaders(getToken?: AuthTokenProvider) {
  const token = getToken ? await getToken() : null;

  if (!token) {
    return {};
  }

  return {
    [AUTHORIZATION_HEADER]: `Bearer ${token}`
  };
}

export function getBearerToken(headers: Headers | Record<string, string | undefined>) {
  const raw =
    headers instanceof Headers
      ? headers.get(AUTHORIZATION_HEADER) ?? headers.get(AUTHORIZATION_HEADER.toLowerCase())
      : headers[AUTHORIZATION_HEADER] ?? headers[AUTHORIZATION_HEADER.toLowerCase()];

  if (!raw) {
    return null;
  }

  const [scheme, token] = raw.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}
