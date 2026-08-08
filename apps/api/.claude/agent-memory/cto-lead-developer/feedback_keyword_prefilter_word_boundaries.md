---
name: keyword_prefilter_word_boundaries
description: Any cheap keyword/substring pre-filter over free text must use word-boundary regex, never .includes()
metadata:
  type: feedback
---

Any keyword-based pre-filter over headline/summary/body text (used to gate an expensive
AI call) must match on word boundaries (`\bkeyword\b`, case-insensitive), never plain
`haystack.includes(kw)` / `haystack.toLowerCase().includes(kw)`.

**Why:** S74-T2 (`hasPlausibleAnalystSignal()` in `apps/api/lib/ai/extractExpertOpinions.ts`)
shipped with plain substring matching and failed QA: the brokerage keyword "citi" matched
the common word "citing" ("...citing weak global cues" — extremely common phrasing in
Indian financial journalism), and "sell" matched "selling" ("Broad-based selling was seen
across sectors"). Both caused ordinary descriptive market recaps and RBI policy stories to
false-positive through the pre-filter, defeating its entire cost-saving purpose. Short
3-5 letter keywords (citi, ubs, sell, buy, target) are the highest-risk collision surface.

**How to apply:** When writing or reviewing any keyword/substring pre-filter (cost
guardrails, content classifiers, cheap gates before an AI call), always anchor with
`\b...\b` via a compiled regex, not `.includes()`. Multi-word phrases ("price target",
"fund manager") work fine under `\b...\b` since spaces are already boundaries — no special
tokenization needed. Verify with concrete negative-prose test cases that contain the risky
short keywords as substrings of common English words (citing/citi, selling/sell,
targeting/target, buying/buy) before considering the filter done. Precompile the regex
array once at module load, not per-call, if the keyword list is static.

**Round-2 gotcha (the naive fix over-corrects):** plain `\bkeyword\b` also blocks the
keyword's own ordinary plural / third-person-singular form — `\banalyst\b` does NOT match
"analysts", `\bdowngrade\b` does NOT match "downgrades", `\btarget\b` does NOT match
"targets". For a recall-biased pre-filter (false negative = permanent silent data loss;
false positive = one wasted AI call) this is the WORSE failure mode, and it bit S74-T2 a
second time in QA. Fix: for single-word keywords use `\bkeyword s?\b` (optional trailing
"s" only) — e.g. `` `\\b${escaped}s?\\b` `` — so the bare plural matches while a genuine
word boundary is still required right after. Do NOT extend to `-ing`/`-ed` — "selling" is
the literal gerund of "sell" and allowing `-ing` resurrects the original substring-collision
bug. Multi-word phrases don't need the `s?` (low-value edge case, e.g. missing "price
targets"). Bottom line: when building any recall-biased keyword gate, explicitly test the
keyword's own plural/inflected form as a MUST-MATCH case, not just the substring-collision
negative cases — both failure directions need their own test before calling it done.

See also [[project_s74_finance_extraction]] for the broader S74 finance-extraction-pipeline
throughput-guardrail context this bug appeared in, and [[feedback_qa_pipeline_ownership]]
for the process-integrity incident that came alongside round-2 of this same ticket.

**3rd occurrence (2026-07-13):** `isRelevantHeadline()`/`primaryNameToken()` in
`apps/api/lib/marketMoves/googleNews.ts` (Market Pulse Phase 1c) — same bug class, different
codebase area (relevance gate deciding whether a Google News headline belongs to a given
stock, not a cost pre-filter). Ticker "LT" matched inside "results" via plain `.includes()`;
picking the company name's FIRST ≥3-char token meant PSU banks/insurers (e.g. "State Bank Of
India", "Bank Of Baroda") matched on generic words like "bank"/"state"/"life"/"new", so
unrelated RBI/budget/election headlines false-positived as company-specific news. Fixed with
a `containsWholeWord()` regex helper plus a `GENERIC_COMPANY_STOPWORDS` set feeding a
"longest non-stopword token, or null if none exists" selector — see
[[project_market_pulse_phase1c_news]] for the full fix + the 15-case empirical retest.
**Escalation: this is now a default-suspect pattern** — any `.includes()`/`indexOf()` gating
free text anywhere in this repo should be treated as a likely bug on sight, not something to
wait for QA to catch a 4th time.
