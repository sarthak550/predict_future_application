import { createHash } from "crypto";

/**
 * Computes a deterministic 6-character uppercase hex hash from a user ID.
 *
 * The same userId always produces the same shortHash — no database field needed.
 * Based on the first 6 hex characters of SHA-256(userId), uppercased.
 */
function computeShortHash(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").substring(0, 6).toUpperCase();
}

/**
 * Returns the public display name for a user.
 *
 * Design decision: anonymity affects *display* only, not URL discoverability.
 * A user at /profile/alice is still reachable by that URL even when
 * displayMode=ANONYMOUS — the response will simply return the pseudonym
 * instead of "alice" in the username field. This ensures that existing
 * bookmarks, shares, and deep-links continue to resolve.
 *
 * @param user - Object with at minimum: id, username, displayMode (string enum value)
 * @returns Real username when displayMode=USERNAME; "AnonymousAnalyst_{6-char-hash}" when ANONYMOUS
 */
export function getDisplayName(user: {
  id: string;
  username: string;
  displayMode: string;
}): string {
  if (user.displayMode === "ANONYMOUS") {
    return `AnonymousAnalyst_${computeShortHash(user.id)}`;
  }
  return user.username;
}
