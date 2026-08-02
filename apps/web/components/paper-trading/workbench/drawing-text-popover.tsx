"use client";

/**
 * TA Suite Sprint S1, T5 — plan decision D10: a popover that opens right
 * after a text-family drawing (`calloutText`/`noteAnchored`, and re-opened
 * by the style editor's "Edit text" button — T7) finishes drawing.
 * Positioning/dismissal precedent copied from `ChartOrderIntentPopover`
 * (Escape, outside-pointerdown, plain `position: absolute` — no portal,
 * this is a small chart-scoped control, not a screen-owning overlay).
 *
 * **The product-gap acceptance criterion this component exists to satisfy**:
 * dismissing with NO text entered must delete the just-drawn overlay AND
 * its just-created DB row entirely — a user must never be left with an
 * invisible, unlabeled annotation they can't find again to remove. Every
 * dismissal path (Escape, outside click, the X button) funnels through the
 * SAME check: trimmed-empty text → `onDismissEmpty()` (the caller wires
 * this to `kline-chart.tsx`'s `removeDrawingCommand`, which reaches the
 * server DELETE through the exact same path as the Backspace hotkey);
 * non-empty text → `onConfirm(trimmed)` (a PATCH of `styles.pfContent.text`
 * via `use-chart-drawings.ts`'s `update()`).
 */
import { useEffect, useRef, useState } from "react";

export function DrawingTextPopover({
  left,
  top,
  initialText,
  title,
  onConfirm,
  onDismissEmpty
}: {
  /** CSS pixels, relative to the chart's own `position: relative` wrapper (same contract as `ChartOrderIntentPopover`). */
  left: number;
  top: number;
  initialText: string;
  title: string;
  onConfirm: (text: string) => void;
  onDismissEmpty: () => void;
}) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLDivElement | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  function close() {
    const trimmed = textRef.current.trim();
    if (trimmed.length === 0) onDismissEmpty();
    else onConfirm(trimmed);
  }

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anchorRight = left > 320;

  return (
    <div
      ref={ref}
      className="absolute z-20 w-64 rounded-xl border border-ink-200 bg-white p-3 shadow-lg"
      style={{ left: anchorRight ? undefined : left, right: anchorRight ? `calc(100% - ${left}px)` : undefined, top }}
    >
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{title}</p>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            close();
          }
        }}
        rows={3}
        maxLength={280}
        placeholder="Add text… (empty = discard)"
        className="w-full resize-none rounded-lg border border-ink-200 px-2 py-1.5 text-xs text-ink-800 outline-none focus:border-sky-400"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={close} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">
          Save
        </button>
      </div>
    </div>
  );
}
