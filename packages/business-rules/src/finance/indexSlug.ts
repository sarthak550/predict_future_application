/**
 * Shared NSE index display-name slugification. Moved here 2026-08-09 (Index
 * Universe Expansion, Sprint A) from apps/api's lib/marketMoves/allIndices.ts
 * so BOTH apps/api (the live 139-index `/indices/[slug]` directory, the
 * original author of this function) AND the new INDEX_UNIVERSE registry
 * (indexUniverse.ts, same directory) derive a slug from an NSE display name
 * via ONE definition — the brief's own instruction ("must equal
 * slugifyIndexName(name) exactly — reuse that function, don't reimplement")
 * only holds if there is exactly one implementation to reuse.
 * apps/api/lib/marketMoves/allIndices.ts re-exports this verbatim for
 * back-compat with its own doc comments; no behavior change there.
 */

/**
 * Derives a URL-safe, uppercase slug from NSE's index display name: any run
 * of non-alphanumeric characters (spaces, "&", "/", ":", "-", parentheses,
 * ...) collapses to a single hyphen, with leading/trailing hyphens trimmed.
 * E.g. "NIFTY AUTO" -> "NIFTY-AUTO", "NIFTY OIL & GAS" -> "NIFTY-OIL-GAS",
 * "NIFTY FINANCIAL SERVICES 25/50" -> "NIFTY-FINANCIAL-SERVICES-25-50".
 *
 * Not claimed to be mathematically invertible (multiple distinct names could
 * in principle collapse to the same slug — e.g. a "/" vs a " " both become
 * "-"), but empirically verified unique across all 139 live NSE
 * /api/allIndices rows on 2026-07-25. Detail-page lookups always resolve a
 * slug against the live name->slug map built by apps/api's getAllIndices(),
 * never by parsing the slug back into a name, so a hypothetical future
 * collision would show as a 404 for the second name, not a mismatch.
 */
export function slugifyIndexName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
