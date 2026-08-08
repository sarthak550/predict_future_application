---
name: feedback_omitted_props_default_assumes_one_caller_shape
description: A component's "both optional props omitted -> default X" fallback is only safe if EVERY real caller that omits both props actually wants X — check every call site, not just the one the feature was built for.
metadata:
  type: feedback
---

Found 2026-08-04 during the quote-driven-intrabar-ticks QA pass (see
[[project_quote_driven_intrabar_ticks_qa]]). `price-chart.tsx`'s
`quoteSource` prop was designed with two callers in mind: the plain equity
`/instruments/[symbol]` page (omits both `quoteSource` and `intradaySource`
— SHOULD get the bare-equity live-quote default) and the indices page
(passes `intradaySource` — SHOULD get the poll disabled). The CTO's own doc
comment reasoned correctly about exactly those two shapes and concluded
"the indices/bonds pages... zero risk, no per-caller opt-out flag needed."

The bug: the bonds page (`/bonds/[symbol]`) ALSO omits both props, but for
an unrelated reason (it never needed `intradaySource` in the first place —
it has no index-shaped intraday endpoint to point at). The fallback
`quoteSource?.url ?? (intradaySource ? null : defaultEquityUrl)` can't tell
these two "omitted both" callers apart, so bonds silently inherited the
equity-page default and started polling a nonexistent
`/api/instruments/{bondSymbol}/quote` every ~4.5s once a user clicked "1D"
— live-reproduced, both server logs showed real repeating 404s.

**Why:** when a shared component's prop-fallback logic branches on "which
optional props did the caller pass," the reasoning is only as complete as
the caller list the author actually enumerated. It's easy to design correct
behavior for the 2 callers the feature ticket explicitly targets (here:
equity pages needing the new default, index pages needing it off) and miss
a 3rd pre-existing caller that happens to match the same "both omitted"
shape for a completely different reason.

**How to apply:** when reviewing an additive/optional prop with a
non-trivial default (anything beyond "omitted = off"), grep EVERY call site
of the component before trusting the doc comment's claimed
default/override contract, not just the 1-2 sites the ticket's own summary
mentions. Specifically check: does every caller that ends up on the
"default" branch actually want the default's behavior? A page whose
`symbol` prop isn't semantically the same kind of instrument the default
URL assumes ([[project_quote_driven_intrabar_ticks_qa]]'s bonds case) is
the concrete pattern to watch for — the same class of bug would recur for
any shared chart/data component with a symbol-shaped default URL and
multiple non-equity consumers (a future crypto/commodity/mutual-fund page
reusing PriceChart would hit this exact trap again unless the fix adds a
real opt-out, not just documents the gap away).
