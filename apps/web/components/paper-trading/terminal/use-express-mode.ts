"use client";

/**
 * Trading Terminal UI Overhaul (Sprint A, T7) — Express mode state machine.
 * Options terminal only (per the brief's explicit scope decision — never
 * imported by the equity terminal).
 *
 * Three persisted localStorage keys, exactly as specified:
 *   - pf.papertrading.expressEnabled     — the user's standing PREFERENCE.
 *   - pf.papertrading.expressAcknowledged — true once-ever, after the
 *     one-time guardrail modal is dismissed.
 *   - pf.papertrading.expressLotsPreset  — 1 | 2 | 5 | 10.
 *
 * `armed` is SESSION-ONLY React state, deliberately never persisted:
 *   - Re-arms automatically ONLY when this hook mounts with the preference on
 *     AND the tab visible at that moment.
 *   - Disarms on the tab going hidden, or after 30 minutes with no order
 *     activity (`noteActivity()` resets the idle timer — call this on every
 *     fill, Express or manual, from the options terminal).
 *   - Re-arming after any disarm requires an explicit `arm()` call (one tap
 *     on the already-visible toggle) — NEVER automatic, including a
 *     hidden->visible transition after the initial mount. This is the exact
 *     defense against "left it on across days/devices and fat-fingered a
 *     stale session" the brief calls out.
 *
 * The toggle's 3-way tap semantics (off -> on, on+armed -> off,
 * on+disarmed -> re-arm) are exposed as a single `handleToggleTap()` so the
 * UI component (express-controls.tsx) doesn't need to reconstruct this state
 * machine itself — it only needs to know whether to show the acknowledgement
 * modal first (via `needsAcknowledgement`).
 */
import { useCallback, useEffect, useRef, useState } from "react";

const ENABLED_KEY = "pf.papertrading.expressEnabled";
const ACKNOWLEDGED_KEY = "pf.papertrading.expressAcknowledged";
const LOTS_PRESET_KEY = "pf.papertrading.expressLotsPreset";
const IDLE_DISARM_MS = 30 * 60 * 1000;

export const EXPRESS_LOTS_PRESETS = [1, 2, 5, 10] as const;
export type ExpressLotsPreset = (typeof EXPRESS_LOTS_PRESETS)[number];

function isExpressLotsPreset(v: number): v is ExpressLotsPreset {
  return (EXPRESS_LOTS_PRESETS as readonly number[]).includes(v);
}

function readBoolean(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Private mode / storage disabled — the preference just won't persist.
  }
}

function readLotsPreset(): ExpressLotsPreset {
  try {
    const raw = Number(window.localStorage.getItem(LOTS_PRESET_KEY));
    if (isExpressLotsPreset(raw)) return raw;
  } catch {
    // fall through to default
  }
  return 1;
}

export interface ExpressModeState {
  /** Whether the acknowledgement modal must be shown BEFORE turning Express on for the first time ever on this browser. */
  needsAcknowledgement: boolean;
  enabled: boolean;
  armed: boolean;
  lotsPreset: ExpressLotsPreset;
  /** Single entry point for the toggle's tap — handles all three transitions (off->on, on+armed->off, on+disarmed->re-arm). If it returns "needs-acknowledgement", the caller must show the modal and call `confirmAcknowledgementAndEnable()` on confirm. */
  handleToggleTap: () => "handled" | "needs-acknowledgement";
  /** Called by the acknowledgement modal's confirm button — sets acknowledged=true, enabled=true, armed=true, all persisted/session state in one step. */
  confirmAcknowledgementAndEnable: () => void;
  setLotsPreset: (preset: ExpressLotsPreset) => void;
  /** Resets the 30-minute idle-disarm timer — call on every fill (Express or manual) placed from the options terminal. */
  noteActivity: () => void;
}

export function useExpressMode(): ExpressModeState {
  const [enabled, setEnabledState] = useState(false);
  const [acknowledged, setAcknowledgedState] = useState(false);
  const [armed, setArmed] = useState(false);
  const [lotsPreset, setLotsPresetState] = useState<ExpressLotsPreset>(1);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from localStorage after mount (avoids an SSR/hydration mismatch —
  // same pattern as PriceChart's timeframe restoration), then apply the
  // "re-arm only on mount with tab visible" rule exactly once.
  useEffect(() => {
    const storedEnabled = readBoolean(ENABLED_KEY);
    const storedAcknowledged = readBoolean(ACKNOWLEDGED_KEY);
    setEnabledState(storedEnabled);
    setAcknowledgedState(storedAcknowledged);
    setLotsPresetState(readLotsPreset());
    if (storedEnabled && document.visibilityState === "visible") setArmed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const armedRef = useRef(armed);
  armedRef.current = armed;

  const scheduleIdleDisarm = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      setArmed(false);
    }, IDLE_DISARM_MS);
  }, [clearIdleTimer]);

  // Disarm (never re-arm) on tab-hidden — the visibility-change primitive
  // already established by use-visible-polling.ts.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden" && armedRef.current) {
        setArmed(false);
        clearIdleTimer();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [clearIdleTimer]);

  // Start/refresh the idle timer whenever armed flips on; stop it when
  // disarmed (nothing left to time out).
  useEffect(() => {
    if (armed) scheduleIdleDisarm();
    else clearIdleTimer();
    return () => clearIdleTimer();
  }, [armed, scheduleIdleDisarm, clearIdleTimer]);

  const noteActivity = useCallback(() => {
    if (armedRef.current) scheduleIdleDisarm();
  }, [scheduleIdleDisarm]);

  const handleToggleTap = useCallback((): "handled" | "needs-acknowledgement" => {
    if (!enabled) {
      if (!acknowledged) return "needs-acknowledgement";
      setEnabledState(true);
      writeBoolean(ENABLED_KEY, true);
      setArmed(true);
      return "handled";
    }
    if (armed) {
      // Explicit off: kill the preference entirely.
      setEnabledState(false);
      writeBoolean(ENABLED_KEY, false);
      setArmed(false);
      return "handled";
    }
    // enabled but disarmed — one tap re-arms, preference untouched.
    setArmed(true);
    return "handled";
  }, [enabled, acknowledged, armed]);

  const confirmAcknowledgementAndEnable = useCallback(() => {
    setAcknowledgedState(true);
    writeBoolean(ACKNOWLEDGED_KEY, true);
    setEnabledState(true);
    writeBoolean(ENABLED_KEY, true);
    setArmed(true);
  }, []);

  const setLotsPreset = useCallback((preset: ExpressLotsPreset) => {
    setLotsPresetState(preset);
    try {
      window.localStorage.setItem(LOTS_PRESET_KEY, String(preset));
    } catch {
      // Preference just won't persist.
    }
  }, []);

  return {
    needsAcknowledgement: !enabled && !acknowledged,
    enabled,
    armed,
    lotsPreset,
    handleToggleTap,
    confirmAcknowledgementAndEnable,
    setLotsPreset,
    noteActivity
  };
}
