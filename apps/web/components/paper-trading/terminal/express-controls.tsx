"use client";

/**
 * Trading Terminal UI Overhaul (Sprint A, T7) — the Express toggle +
 * lots-preset chip row, rendered inline in terminal-header.tsx's sticky strip
 * (options terminal only). Also owns the one-time acknowledgement modal,
 * since the toggle is the only thing that can trigger it.
 */
import { EXPRESS_LOTS_PRESETS, type ExpressLotsPreset, type ExpressModeState } from "./use-express-mode";

export function ExpressControls({ express, onToggleTap }: { express: ExpressModeState; onToggleTap: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <ExpressToggleButton express={express} onToggleTap={onToggleTap} />
      {express.enabled && (
        <div className="inline-flex rounded-2xl border border-ink-200 bg-white p-1">
          {EXPRESS_LOTS_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => express.setLotsPreset(preset)}
              className={`rounded-xl px-2.5 py-1 text-xs font-semibold transition ${
                express.lotsPreset === preset ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900"
              }`}
              title={`Express fills use ${preset} lot(s) per tap`}
            >
              {preset}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpressToggleButton({ express, onToggleTap }: { express: ExpressModeState; onToggleTap: () => void }) {
  const label = !express.enabled
    ? "⚡ 1-tap orders: Off"
    : express.armed
      ? "⚡ 1-tap orders: On"
      : "⚡ 1-tap orders: Paused — tap to resume";
  const tone = !express.enabled
    ? "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
    : express.armed
      ? "border-amber-300 bg-amber-500 text-white hover:bg-amber-600"
      : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100";

  return (
    <button
      type="button"
      onClick={onToggleTap}
      title="When on, tapping B or S next to a strike fills instantly at your preset lots — no confirm step. Pauses itself when you switch tabs or go idle."
      className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${tone}`}
    >
      {label}
    </button>
  );
}

export function ExpressAcknowledgeModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-[24px] border border-ink-100 bg-white p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-600">Turn on Express mode?</p>
        <p className="mt-3 text-sm leading-6 text-ink-700">
          Express fills instantly at your selected lot preset with <span className="font-semibold">no confirmation step</span>. Fills are
          immutable market orders — there&apos;s no undo, only a fast reversal (a new order in the opposite direction) shown in the toast
          after every fill.
        </p>
        <p className="mt-2 text-sm leading-6 text-ink-700">Turns off automatically if you leave this tab or go idle for 30 minutes.</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl px-3 py-2 text-sm font-medium text-ink-500 hover:text-ink-900">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
          >
            I understand — turn on
          </button>
        </div>
      </div>
    </div>
  );
}

export type { ExpressLotsPreset };
