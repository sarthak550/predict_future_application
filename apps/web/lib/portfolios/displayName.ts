/**
 * Portfolios (P3.2) — public-facing owner label for a USER-kind portfolio.
 *
 * Deliberately RE-IMPLEMENTS apps/api/lib/users/displayName.ts's getDisplayName
 * rather than importing it — apps/web cannot import apps/api's server code (see
 * the cross-app math placement note in project_portfolios_p3_1.md memory: the
 * same constraint that pushed the engine math into packages/business-rules
 * applies here). This is a pure, dependency-free function (Node's `crypto`
 * only), so duplication is cheap and low-risk — but if apps/api's anonymization
 * scheme ever changes, THIS copy must be updated to match, or a public
 * portfolio card could leak a real username for an ANONYMOUS-mode user.
 */
import { createHash } from "crypto";

function computeShortHash(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").substring(0, 6).toUpperCase();
}

/** Mirrors apps/api/lib/users/displayName.ts's getDisplayName exactly. */
export function getPortfolioOwnerUserLabel(user: { id: string; username: string; displayMode: string }): string {
  if (user.displayMode === "ANONYMOUS") {
    return `AnonymousAnalyst_${computeShortHash(user.id)}`;
  }
  return user.username;
}
