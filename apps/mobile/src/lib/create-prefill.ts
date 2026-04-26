import type { ApiPredictionSuggestion } from "@predict-future/types";

/**
 * Simple singleton to pass a prediction suggestion from the news feed
 * to the create screen. The create screen consumes (and clears) it on mount.
 */
let pending: ApiPredictionSuggestion | null = null;

export function setPrefill(suggestion: ApiPredictionSuggestion) {
  pending = suggestion;
}

export function consumePrefill(): ApiPredictionSuggestion | null {
  const value = pending;
  pending = null;
  return value;
}
