# QA Engineer Memory

This index will grow as the QA engineer catches bugs and learns the codebase's failure patterns.

- [Groups feature implementation notes](project_groups_feature.md) — S8-T1 architecture decisions: discover param, join-by-ID security model, unused getSession imports
- [Recurring CTO auth failure — missing auth:true on market detail fetch](feedback_auth_missing_pattern.md) — CTO blind spot: getMarketById missing auth:true (S8-T2); audit both api-client and route handler on every user-data ticket
- [Sprint 11 complete — Profile redesign Phase 2](project_sprint11_complete.md) — all 3 tickets done 2026-05-02; kira test-user state and profile.tsx architecture notes
- [S24-T3 follow notifications — implementation notes](project_s24_follow_notifications.md) — notifyFollowers design choices; sendFollowerPushNotifications uses native fetch not expo-server-sdk; runtime login 500 is pre-existing env issue
- [In-transaction side-effect must be wrapped in try/catch](feedback_in_tx_error_swallow.md) — S24-T4 failure pattern: non-critical side effects (quest engine, notifications) inside Prisma tx must be try/caught or parent action rolls back
- [void+catch on detached promise in Prisma tx silently no-ops](feedback_void_detached_promise_in_tx.md) — S24-T5: void asyncFn(tx).catch() launches after tx is already committed; all DB ops silently fail — use try/await/catch instead
- [prisma generate requires dev server restart](feedback_prisma_server_restart.md) — S24-T6: global.prisma singleton is stale if server predates prisma generate; new schema fields cause 500 at runtime even though tsc passes
- [Multi-choice settlement netGain guard missing](feedback_settlement_netgain_guard.md) — S24-T10: settleMultiChoiceMarket missing if (netGain > 0) guard before updateLeagueMonthPoints; also notifications not try/caught in settlement loop
