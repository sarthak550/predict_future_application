---
name: cto_assignment_brief_sprint61
description: Sprint 61 RBI Pulse — MPC poll-pack feature brief: architecture decision, 7 tickets, open founder decisions. Issued 2026-06-28.
metadata:
  type: project
---

Sprint 61 delivers RBI Pulse: interactive MPC prediction poll-packs in Today's Pulse (Finance tab).

**Architecture decision:** Zero new models. Uses existing Market (MULTIPLE_CHOICE + flagshipEventType='RBI'), MarketEventCluster (groups the two questions), MarketOption, MultiChoicePosition, and the existing flagship-events pipeline. flagshipEventType='RBI' is already a supported string value. structuredData Json? on Market already exists for the EMI line. settleMultiChoiceMarket() already handles points distribution.

**Why:** Sprint 61 was issued 2026-06-28.

**How to apply:** When reviewing S61 QA results or planning S62, check whether (a) the resolution flow settled positions correctly after admin marks outcome via the new mpc-pack resolve endpoint, and (b) the groupFlagshipEventsIntoPacks utility was adopted by MpcPollPackCard (T6→T1 dependency).

**Open founder decisions (pre-CTO):**
1. Free votes (amount=0) vs staked points — recommendation: free votes matching existing flagship polls.
2. EMI line is admin-authored static text at pack creation — confirm acceptable.
3. Push reminders already handled by existing flagship-reminder cron — no new notification work.

**Ticket order:** T4 + T6 parallel → T0 → T1 + T2 parallel → T3 → T5.

**Phase 2 (explicitly deferred):** Monthly CPI Watch, RBI Watcher accuracy leaderboard/badge/streak, GPT explainer per question, CPI/IIP/GDP question types.

**Files touched:**
- NEW: apps/api/app/api/admin/rbi/mpc-pack/route.ts (T0)
- NEW: apps/api/app/api/admin/rbi/mpc-pack/[clusterId]/resolve/route.ts (T3)
- MODIFIED: apps/api/app/api/finance/flagship-events/route.ts — add structuredData to select (T4)
- MODIFIED: apps/api/app/api/markets/[marketId]/route.ts — add structuredData to select (T4)
- MODIFIED: packages/types/src/index.ts — ApiFlagshipEvent + ApiMpcPollPack (T4, T6)
- MODIFIED: packages/api-client/src/index.ts — groupFlagshipEventsIntoPacks utility (T6)
- MODIFIED: apps/mobile/src/components/finance-mode.tsx — MpcPollPackCard + PulseRibbon update (T1)
- MODIFIED: apps/mobile/src/app/finance/poll/[id].tsx — EMI line + consensus reveal + next-question CTA (T2, T5)
