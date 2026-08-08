---
name: feedback_call_real_exports_not_reimplementations
description: When scratch-verifying a module's arithmetic/logic (e.g. line-offset correction), call the actual exported function — never hand-reimplement its internal logic in the scratch script, even for "just the regex part."
metadata:
  type: feedback
---

Self-caught during SS1 QA's `WRAP_LINE_OFFSET` honesty check (see
[[project_scripting_ss1_qa]]). First scratch-test attempt manually
re-implemented `lib/ta/user-scripts.ts`'s `extractLineFromErrorStack` logic
inline (`[...stack.matchAll(/<anonymous>:(\d+):(\d+)/g)]` applied to the
WHOLE stack string) instead of importing and calling the real
`toScriptError`/`runScriptSync`. The real function scans stack trace LINES
one at a time and returns on the FIRST line with a match (correctly picking
the innermost frame); my reimplementation matched across the ENTIRE stack
string and grabbed the LAST match anywhere (a different, wrong frame — an
outer caller frame instead of the throw site). Result: my first pass
"found" a wrong offset and nearly got reported as a false-positive bug in
otherwise-correct product code.

**Why**: a scratch verification's job is to prove the REAL code path is
correct, not to independently reprove the underlying math with a fresh
implementation — a fresh implementation just introduces a second place to
get the edge cases wrong, and any mismatch is now ambiguous (is the product
wrong, or is my scratch script wrong?).

**How to apply**: whenever a "sanity check this arithmetic/logic with a
throwaway script" task comes up, import and call the module's actual
exported function(s) end-to-end. Only fall back to reimplementing internal
logic if the function genuinely isn't exported/reachable — and even then,
say so explicitly in the report as a weaker form of verification.
