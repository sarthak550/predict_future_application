/**
 * PostHog telemetry wrapper. All vote-event capture goes through here so
 * screens never touch the SDK directly. Calls degrade silently when PostHog
 * isn't configured (EXPO_PUBLIC_POSTHOG_API_KEY unset).
 *
 * Event taxonomy (M4 / Sprint 38):
 *   - opinion_vote_cast      first vote on an opinion
 *   - opinion_vote_changed   user changed an unlocked vote
 *   - opinion_vote_locked    user committed (locked) a vote
 *   - opinion_vote_blocked   user tried to vote on a resolved opinion
 */

import PostHog from "posthog-react-native";

import { env } from "@/lib/env";

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (client) return client;
  if (!env.posthogApiKey) return null;
  client = new PostHog(env.posthogApiKey, { host: env.posthogHost });
  return client;
}

export type VoteEventName =
  | "opinion_vote_cast"
  | "opinion_vote_changed"
  | "opinion_vote_locked"
  | "opinion_vote_blocked";

// ── Explore / community discovery events (S55) ────────────────────────

/**
 * Fired when a user taps the Community spotlight card CTA ("Join community").
 * analytics: "markets_tab_opened" event name preserved for historical
 * comparability — only new explore-specific events use the explore_ prefix.
 */
export type ExploreEventName =
  | "explore_spotlight_tapped"
  | "explore_communities_rail_tapped";

export type ExploreEventProps = {
  groupId: string;
  groupName: string;
  /** Surface that originated the tap. */
  surface: "spotlight" | "rail" | "list";
};

export function trackExploreEvent(event: ExploreEventName, props: ExploreEventProps): void {
  const c = getClient();
  if (!c) return;
  try {
    c.capture(event, props);
  } catch (err) {
    console.error(`[analytics] capture failed for "${event}":`, err, props);
  }
}

export type VoteEventProps = {
  opinionId: string;
  expertId?: string;
  expertOrganization?: string;
  direction?: "BULLISH" | "BEARISH" | "NEUTRAL";
  choice?: string;
  previousChoice?: string | null;
  resolutionStatus?: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS";
  source?: "feed" | "story" | "opinion-detail" | "my-calls";
};

// Analytics MUST NOT break the UI — capture errors are caught so they never
// bubble to the render path — but every failure is logged so we can debug
// telemetry drops (e.g. wrong API key, network outage, malformed payload).

export function trackVoteEvent(event: VoteEventName, props: VoteEventProps): void {
  const c = getClient();
  if (!c) return;
  try {
    c.capture(event, props);
  } catch (err) {
    console.error(`[analytics] capture failed for "${event}":`, err, props);
  }
}

export function identifyUser(userId: string, traits?: Record<string, string | number | boolean>): void {
  const c = getClient();
  if (!c) return;
  try {
    c.identify(userId, traits);
  } catch (err) {
    console.error(`[analytics] identify failed for userId=${userId}:`, err);
  }
}

export function resetAnalytics(): void {
  const c = getClient();
  if (!c) return;
  try {
    c.reset();
  } catch (err) {
    console.error("[analytics] reset failed:", err);
  }
}
