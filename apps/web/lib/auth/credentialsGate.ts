/**
 * Server-side flag controlling whether CredentialsProvider (email+password)
 * is registered in authOptions.providers at all, and whether
 * /api/auth/register accepts new signups.
 *
 * Default unset/false = production, Google-only -- any credentials signup
 * that isn't Google-verified is exactly the "accepting any random string as
 * email" hole this sprint closes, and real email verification is off the
 * table under the standing no-new-email-infra decision, so there is no safe
 * way to keep a PUBLIC password path.
 *
 * Set ALLOW_CREDENTIALS_LOGIN=true in local dev/CI so seed workflows and QA
 * keep working without every engineer needing a Google Cloud test-user grant.
 *
 * Mirrored client-side as NEXT_PUBLIC_ALLOW_CREDENTIALS_LOGIN (see S74-T3) to
 * control whether the password form even renders in the UI -- that is a
 * SEPARATE env var read directly where needed, since Next.js inlines
 * NEXT_PUBLIC_* values at build time and they cannot be re-exported through a
 * server-only helper like this one.
 */
export function isCredentialsLoginAllowed(): boolean {
  return process.env.ALLOW_CREDENTIALS_LOGIN === "true";
}
