---
name: feedback_verify_file_scope_not_just_diff_stat
description: This repo runs many concurrent CEO/CTO programs against one shared working tree — always verify the ACTUAL touched-file list yourself, don't trust a ticket's "N files touched" claim.
metadata:
  type: feedback
---

Multiple CEO/CTO programs (charting workbench, paper trading, scripting
sprint SS1-SS3, interaction-model rework, etc.) run concurrently against the
SAME working tree in this repo, and changes sit uncommitted for a while.
That means `git status`/`git diff --stat` on a shared directory (e.g.
`apps/web/components/paper-trading/workbench/`) will often show MORE files
than any single ticket touched — other in-flight, unrelated work is mixed
in.

**Why this matters for QA:** a ticket handoff brief may assert "only these N
files were touched" based on the CTO's own summary, and that assertion can
be wrong not because the CTO lied, but because the shared tree already had
other uncommitted work sitting in it before the CTO's session started (same
root cause as the recurring schema.prisma pollution, see
`project_ta_suite_program`/`project_workbench_program` memory in the CTO's
own memory dir).

**How to apply:** always run `git diff --stat` yourself on the relevant
directory rather than trusting a file list handed to you. For every file
that shows up unexpectedly, read its diff and check whether the content
plausibly relates to the ticket at hand (same helpers/imports/doc-comment
references) before either (a) treating it as pre-existing pollution to
flag-and-ignore, matching the pattern that's now expected for
schema.prisma, or (b) treating it as real scope creep by THIS ticket's CTO,
which is a genuine FAIL. Distinguish the two by content, not by which file
the brief mentioned. Also flag to the CEO/CTO chain when this happens —
several unrelated uncommitted feature branches sitting entangled in one
working tree is a real risk if anyone runs a broad `git add -A`/commit
later (see [[feedback_serialize_schema_writes]] in the CTO's memory for the
sibling risk on schema.prisma specifically — this generalizes it to any
shared file/directory).
