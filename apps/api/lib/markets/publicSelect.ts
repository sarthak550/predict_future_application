import { Prisma } from "@prisma/client";

/**
 * Market columns that must never reach the client — internal provenance data for
 * markets sourced from a third-party platform (e.g. Manifold). Imported markets are
 * presented to end users as fully native, admin-generated PredictFuture content, so
 * these columns are server-internal only (used by the resolution-sync cron and import
 * idempotency checks). See .claude/agent-memory/cto-lead-developer/external_market_sources.md.
 */
type MarketScalarField = keyof typeof Prisma.MarketScalarFieldEnum;
type InternalOnlyField = "originPlatform" | "externalId" | "externalLastSyncedAt";
type PublicMarketScalarField = Exclude<MarketScalarField, InternalOnlyField>;

const MARKET_INTERNAL_ONLY_FIELDS = new Set<MarketScalarField>([
  "originPlatform",
  "externalId",
  "externalLastSyncedAt",
]);

/**
 * A Prisma `select` object containing every Market scalar column except the
 * internal-only ones above. Derived from `Prisma.MarketScalarFieldEnum` (generated
 * from the schema) rather than hand-enumerated, so it can't silently omit a field an
 * existing client depends on, and any future scalar column is included automatically
 * unless explicitly added to MARKET_INTERNAL_ONLY_FIELDS above. Typed as a closed
 * mapped type (not `Record<string, true>`) so Prisma can still infer the precise
 * per-field result type at each call site — a plain index signature would collapse
 * that inference and silently strip every scalar field from the query result type.
 *
 * Use this to replace a top-level `include: {...}` on a client-facing
 * `prisma.market.findMany`/`findUnique` call: spread it alongside relation selects,
 * e.g. `select: { ...PUBLIC_MARKET_SCALAR_SELECT, creator: { select: {...} } }`.
 */
export const PUBLIC_MARKET_SCALAR_SELECT: { [K in PublicMarketScalarField]: true } = Object.fromEntries(
  Object.keys(Prisma.MarketScalarFieldEnum)
    .filter((field): field is PublicMarketScalarField => !MARKET_INTERNAL_ONLY_FIELDS.has(field as MarketScalarField))
    .map((field) => [field, true as const])
) as { [K in PublicMarketScalarField]: true };

const MANIFOLD_PATTERN = /manifold/i;
const REDACTED_SOURCE_NAME = "External Market Data";
const REDACTED_RULE_TEXT = "Resolution details are being finalized.";

function leaksManifold(value: string | null | undefined): boolean {
  return typeof value === "string" && MANIFOLD_PATTERN.test(value);
}

/**
 * Defensive last-resort guard: strips any accidental "manifold" reference out of the
 * public-facing resolution/source fields before a response is serialized. This should
 * never trigger in practice now that import-manifold-markets.ts and
 * sync-manifold-resolutions/route.ts write generic copy — it exists to fail safe
 * (redact + log) instead of failing open (leak the string to a client) if a future
 * change reintroduces platform-branded text.
 *
 * Also covers `rationale`/`explanation` text (MarketResolution), the other historically
 * observed leak vector (the resolution-sync cron used to write
 * "Synced from Manifold. Original resolution: ..." into it).
 */
export function sanitizeMarketSourceFields<
  T extends {
    id?: string;
    resolutionSourceName?: string | null;
    resolutionSourceUrl?: string | null;
    resolutionRuleText?: string | null;
  }
>(market: T): T {
  const leaked =
    leaksManifold(market.resolutionSourceName) ||
    leaksManifold(market.resolutionSourceUrl) ||
    leaksManifold(market.resolutionRuleText);

  if (!leaked) return market;

  console.error(
    `[market-serialize] blocked disallowed source reference on market ${market.id ?? "unknown"} — redacting resolution source fields.`
  );

  return {
    ...market,
    resolutionSourceName: leaksManifold(market.resolutionSourceName)
      ? REDACTED_SOURCE_NAME
      : market.resolutionSourceName,
    resolutionSourceUrl: leaksManifold(market.resolutionSourceUrl) ? null : market.resolutionSourceUrl,
    resolutionRuleText: leaksManifold(market.resolutionRuleText)
      ? REDACTED_RULE_TEXT
      : market.resolutionRuleText,
  };
}

/** Same guard, applied to a free-text resolution rationale/explanation string. */
export function sanitizeRationale(text: string | null | undefined, marketId?: string): string {
  if (!leaksManifold(text)) return text ?? "";
  console.error(
    `[market-serialize] blocked disallowed source reference in resolution rationale on market ${marketId ?? "unknown"} — redacting.`
  );
  return "Resolved based on external market data.";
}
