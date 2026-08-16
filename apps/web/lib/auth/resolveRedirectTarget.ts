/**
 * Resolves where to send the user after a successful sign-in.
 *
 * `callbackUrl` must be a same-origin relative path (starts with "/") — an
 * absolute/external value is rejected and we fall back to "/", so this can
 * never be turned into an open redirect via a crafted sign-in link.
 *
 * When `call` is present (Phase C.1 return-to-call: the "Sign in to take a
 * side" CTA on a call's expanded panel), it's appended as a `call` query
 * param on the destination so ExpandableCallsTable can auto-expand and
 * scroll to that row on landing.
 *
 * Shared by both the credentials sign-in flow (SignInForm calls this, then
 * manually `router.push`es the result after a `redirect: false` signIn) and
 * the Google OAuth flow (GoogleContinueButton passes this straight into
 * `signIn("google", { callbackUrl })` — NextAuth's own default `redirect`
 * callback accepts any same-origin relative path, which is exactly what this
 * always returns, so no additional plumbing is needed for OAuth to land on
 * the same destination credentials sign-in would have).
 */
export function resolveRedirectTarget(callbackUrl?: string, call?: string): string {
  const target = callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/";
  if (!call) return target;

  const [path, query = ""] = target.split("?");
  const params = new URLSearchParams(query);
  params.set("call", call);
  return `${path}?${params.toString()}`;
}
