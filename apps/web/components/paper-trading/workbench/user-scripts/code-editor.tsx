"use client";

/**
 * User Strategy Scripting (SS2), T1 — a small local React wrapper around
 * CodeMirror 6's imperative `EditorView` API (D1). Deliberately NOT a
 * `@uiw/react-codemirror`-style wrapper package — this is the whole file,
 * same "own the imperative bridge" posture `kline-chart.tsx` already uses
 * for klinecharts itself.
 *
 * **Dependency note (deviation from the brief's literal two-package list,
 * flagged in the SS2 final report)**: D1 says "add `codemirror` and
 * `@codemirror/lang-javascript`" — the `codemirror` package's own `dist/
 * index.d.ts` re-exports `EditorView`/`basicSetup`/`minimalSetup` but NOT
 * `EditorState`/`Compartment` (verified directly against the installed
 * package, not assumed). Both are required here (`EditorState.create`, a
 * per-instance `Compartment` for the read-only toggle) and would otherwise
 * only be reachable as an undeclared transitive dependency — a
 * phantom-dependency risk this codebase's own conventions don't accept
 * elsewhere. `@codemirror/state` is added as an explicit `apps/web`
 * dependency, matching the version npm resolved (`^6.7.1`).
 *
 * **Extension set: hand-composed, NOT `codemirror`'s own `basicSetup`
 * (a second, measured deviation, flagged in the SS2 final report)**. D1's
 * own locked-decision text names `basicSetup` ("the all-in-one bundle:
 * state + view + commands + default keymap + basic setup"), but D1's own
 * §1 implementation guidance describes a narrower list — "a minimal
 * extension set (line numbers, bracket matching, the default keymap, an
 * updateListener...)" — and D3's budget gate (editor chunk ≤80KB gzipped)
 * is a hard number that MEASUREMENT (not assumption) showed `basicSetup` +
 * `@codemirror/lang-javascript` blows through by roughly 2x (~165KB gzipped
 * for the codemirror-touching files alone, confirmed via a real
 * `next build` + gzip pass on the compiled chunk before this rewrite).
 * `basicSetup` bundles `autocompletion()` (a full completion-popup engine),
 * `@codemirror/search`'s panel UI, `foldGutter`, `crosshairCursor`,
 * `highlightSelectionMatches`, and their keymaps — none of which D1's own
 * §1 list asked for and none of which a first-cut scripting surface needs.
 * `codemirror`'s own `dist/index.js` source comment says explicitly: "if
 * you want to configure your editor more precisely, you take this
 * package's source (which is just a bunch of imports and an array
 * literal), copy it into your own code, and adjust it as desired" — this
 * file does exactly that, keeping only what §1 asked for (line numbers,
 * bracket matching, the default keymap) plus `history`/`closeBrackets`/
 * `highlightActiveLine`/`drawSelection` (cheap, standard editing
 * affordances squarely inside "minimal," each individually small since
 * none pulls in the completion/search/fold UI machinery). This required
 * FOUR additional explicit dependencies beyond D1's named two
 * (`@codemirror/view`, `@codemirror/commands`, `@codemirror/language`,
 * `@codemirror/autocomplete` — the last one ONLY for `closeBrackets`, never
 * `autocompletion()` itself) — every one of them was already a transitive
 * dependency of `codemirror`/`@codemirror/lang-javascript` regardless (this
 * rewrite doesn't add a single new package to the dependency tree, it only
 * imports more narrowly from packages already being installed), declared
 * explicitly for the same phantom-dependency reasoning as `@codemirror/state`
 * above.
 *
 * **Render-loop law (D5)**, identical in spirit to `kline-chart.tsx`'s own
 * documented "frozen tab, found the hard way" incident: `EditorView` is
 * constructed exactly ONCE, in a `useEffect(() => {...}, [])` — never
 * re-initialized on a prop change. Every value the editor's own internal
 * event handlers need (`onChange`) is read through a ref updated every
 * render, never captured in a closure at construction time. An external
 * content update (switching which script is loaded into an already-mounted
 * editor) is applied via CodeMirror's own `dispatch({changes: ...})`
 * transaction API — never a full re-`init()`, which would tear down and
 * rebuild the whole editor (losing undo history, scroll position, and
 * cursor state) every time the parent's `value` prop changes for any
 * reason, including the editor's OWN `onChange` echoing straight back in as
 * a new `value` prop on the next render.
 */
import { useEffect, useRef } from "react";
import { EditorView } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";

/** Hand-composed per this file's own module doc — the "minimal extension set" D1's §1 describes, not `codemirror`'s own heavier `basicSetup`. */
const MINIMAL_EXTENSIONS = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  history(),
  drawSelection(),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap])
];

export interface CodeEditorProps {
  /** Controlled value — see module doc for how external updates are applied without tearing down the editor. */
  value: string;
  onChange: (value: string) => void;
  /** Examples load into the editor read-only (D onClick "Duplicate to edit" is the only active affordance) — toggled via a `Compartment.reconfigure`, not a remount (D5). */
  readOnly?: boolean;
  className?: string;
}

const EDITOR_THEME = EditorView.theme({
  "&": { fontSize: "12.5px", height: "100%" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", overflow: "auto" },
  ".cm-content": { minHeight: "100%" },
  "&.cm-focused": { outline: "none" }
});

export function CodeEditor({ value, onChange, readOnly = false, className }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // A Compartment is a mutable "slot" inside ONE EditorState's extension
  // list — it must be created per component instance (a module-level
  // singleton would make two simultaneously-mounted editors fight over the
  // same slot). Created once via useRef, never recreated.
  const readOnlyCompartmentRef = useRef<Compartment>(new Compartment());
  // Tracks the last value THIS component itself pushed into the editor —
  // either at init or via a dispatched external-update transaction — so the
  // external-update effect below can tell "the parent handed us a genuinely
  // NEW value (switch to a different script)" apart from "our own onChange
  // call caused the parent to re-render with the value we just reported"
  // (which must NOT re-dispatch, or every keystroke would fight the cursor
  // position with a redundant replace-all-text transaction).
  const lastKnownValueRef = useRef(value);

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        MINIMAL_EXTENSIONS,
        javascript(),
        EDITOR_THEME,
        readOnlyCompartmentRef.current.of(EditorView.editable.of(!readOnly)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const next = update.state.doc.toString();
          lastKnownValueRef.current = next;
          onChangeRef.current(next);
        })
      ]
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally empty deps — init-once (D5). `readOnly`'s initial value
    // is captured here only as the STARTING config for the compartment;
    // subsequent changes go through the dedicated effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External content updates (D5) — a transaction, never a re-init.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === lastKnownValueRef.current) return; // our own onChange echoing back — no-op, see doc above.
    lastKnownValueRef.current = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  // readOnly toggling — same Compartment/dispatch discipline, never a re-init.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartmentRef.current.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [readOnly]);

  return <div ref={containerRef} className={className} />;
}
