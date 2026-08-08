---
name: reference_feed_screen_refs
description: In feed.tsx, listRef is the real FlatList ref; feedListRef is an unrelated View wrapper used only for spotlight-tour targeting.
type: reference
---

`apps/mobile/src/app/(tabs)/feed.tsx` has two refs whose names invite confusion:

- `listRef = useRef<FlatList<NewsListItem>>(null)` — the actual FlatList ref (`ref={listRef}` on the `<FlatList>`). Use this for any `scrollToOffset`/`scrollToIndex` work.
- `feedListRef = useRef<View>(null)` — a plain `View` wrapper around the FlatList, `collapsable={false}`, used only as a spotlight-tour anchor (`makeTourStep("feed-intro", feedListRef, ...)`). It cannot scroll anything.

**Why:** A 2026-07-14 ticket (Feed refresh UX — pull-to-refresh "N new stories" pill / "caught up" banner, tab-tap now scroll-only) explicitly required confirming which ref was which before wiring scroll-to-top behavior. `listRef` already existed and was correct — no new ref was needed.

**How to apply:** Before adding any new scroll-to-top / scroll-to-index logic on the Feed screen, reach for `listRef`, not `feedListRef`. Don't assume a ref named after the feature (`feedListRef`) is the interactive one — check what it's attached to first.

Related: onRefresh (pull-to-refresh) is the only path that should ever trigger user-visible refresh feedback (new-stories pill / caught-up banner). Category-change, India-toggle, the 3-min silent background poll, and the onVoted silent refresh all call `loadPage("replace")` directly, bypassing `onRefresh` — this is what keeps the feedback correctly gated to genuine pull-refreshes.
