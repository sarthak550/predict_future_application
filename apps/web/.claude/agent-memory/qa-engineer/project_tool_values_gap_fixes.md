---
name: project_tool_values_gap_fixes
description: QA verdict history for the CEO's 87-tool TradingView-parity audit and its T1-T4 CTO brief (workbench drawing-tool value labels).
metadata:
  type: project
---

## 2026-08-04 — T1-T4 (measure/fib/gann/pattern label fixes) — PASS

Source of truth: `.claude/agent-memory/ceo-product-strategist/audit_tool_values_gap_matrix.md`
+ `cto_assignment_brief_tool_values_gaps.md`.

Verified via code-reading + `ta:check` fixtures (canvas rendering isn't
click-through-able) across 6 files: `overlays/measure.ts`, `fibonacci.ts`,
`gann.ts`, `patterns.ts`, `figure-kit.ts`, `lib/ta/selfcheck.ts`.

Key correctness item: T4.1 `computeCypherRatios` — hand-verified the brief's
worked example (X=100,A=150,B=130,C=180,D=140) by redoing the arithmetic
myself: xa=50, ab=20, bc=50, xc=80, cd=40 → b=20/50=0.4, c=50/20=2.5,
d=40/80=0.5. Matches both the brief and the `ta:check` fixture exactly.
`buildRatioLabeledZigzag` (the old wrong-base-leg helper) is fully deleted —
confirmed via `grep -rn buildRatioLabeledZigzag` returning only a comment
reference, no live callers.

All 6 T2 fib tools (fibFan/fibArc/fibCircle/fibSpeedResistanceFan/
fibSpeedResistanceArcs/fibWedge) confirmed using `formatUnsignedPercentLabel`
(never the signed `formatPercentLabel`) for level labels — verified by
grepping each call site individually, not just trusting the diff summary.

Lines family, `sector` geometry, qty/account-size on longPosition/
shortPosition — all confirmed untouched (explicitly out of scope per brief).

Re-ran (didn't just trust CTO's reported numbers): `ta:check` 182/0,
`tsc --noEmit` clean, `apps/api verify-papertrading-engine.ts` 264/0,
eslint clean on all 6 files. All matched the CTO's claims exactly.

**Important process finding (not a T1-T4 defect):** `git diff --stat` on the
workbench directory showed 9 changed files, not the 6 the CTO ticket
claimed — 3 extra: `chart-workbench.tsx`, `kline-chart.tsx`,
`custom-indicators/pf-signals.ts`, PLUS `lib/ta/selfcheck.ts` itself carries
~180 lines beyond its 4 legitimate T1-T4 fixtures. All the extra content
turned out to be a DIFFERENT uncommitted, in-flight workstream (User
Strategy Scripting SS1 + a separate "interaction-model rework" replacing
click-to-trade popover with an axis-hover + button / right-click menu, both
dated 2026-08-04) sitting in the same shared working tree, unrelated to
T1-T4 and not authored by this ticket's CTO pass. Confirmed by: (a) doc
comments citing entirely different founder complaints/CEO briefs, (b) zero
references to figure-kit.ts/fib/gann/pattern files, (c)
`lib/ta/user-scripts.ts` and `workbench/user-scripts/` showing as `??`
(untracked, not part of any tracked diff). See
[[feedback_verify_file_scope_not_just_diff_stat]] — this is the same class
of hazard as the already-known schema.prisma pollution, just wider than the
task brief assumed. Flagged to CEO/CTO chain; did not block the T1-T4
verdict since T1-T4's own diff was clean.
