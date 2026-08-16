/**
 * Maps the `error` search param NextAuth (or our own redirects) can attach to
 * /sign-in into a user-facing message. Our own codes get a specific message;
 * everything else — including NextAuth's own OAuth error codes such as
 * OAuthSignin, OAuthCallback, OAuthAccountNotLinked, AccessDenied, Callback,
 * Default — collapses to one generic fallback. `allowDangerousEmailAccountLinking`
 * (S74-T1) means OAuthAccountNotLinked shouldn't fire in practice, but NextAuth
 * can still hand back other provider-side errors (denied consent, a dropped
 * PKCE/state check, etc.), and none of those internal codes are meaningful or
 * safe to surface verbatim to a user.
 */
const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  suspended: "This account is suspended. Contact an administrator."
};

const GENERIC_ERROR_MESSAGE = "We couldn't sign you in. Please try again.";

export function resolveAuthErrorMessage(error?: string): string {
  if (!error) {
    return "";
  }
  return KNOWN_ERROR_MESSAGES[error] ?? GENERIC_ERROR_MESSAGE;
}
