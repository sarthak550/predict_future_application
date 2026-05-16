/**
 * Deterministic avatar utilities for expert opinion surfaces.
 *
 * These functions are pure and have no side effects — safe to call during
 * render without memoisation.
 */

const ACCENT_COLORS = [
  "#E84855", // crimson
  "#3A86FF", // azure
  "#FF6B35", // orange
  "#06D6A0", // emerald
  "#845EC2", // violet
  "#F9C74F", // amber
  "#4CC9F0", // sky
  "#F72585", // pink
] as const;

/**
 * Maps an expert's name (or organization as fallback) to one of 8 deterministic
 * accent colors. The same name always returns the same color — no randomness.
 */
export function getExpertInitialsColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length];
}

/**
 * Returns the single-character initials for an expert avatar fallback.
 * Prefers the first letter of name if non-empty, otherwise falls back to organization.
 */
export function getExpertInitials(name: string, organization: string): string {
  const source = name.trim() || organization.trim();
  return source.charAt(0).toUpperCase();
}
