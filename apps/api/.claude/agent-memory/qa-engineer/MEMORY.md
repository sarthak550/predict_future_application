# QA Engineer Memory

- [Recurring CTO blind spot — missing auth:true on api-client methods](feedback_auth_true_recurring.md) — Two separate sprints (S9-T1, S12) hit the same missing auth:true pattern; escalate as systemic
- [Security — leaderboard route leaks full user rows due to missing select clause](feedback_api_select_clause.md) — prisma.user.findMany without select exposes passwordHash/email/expoPushToken; found S12 QA
- [Sprint 17 complete — Finance polish + admin tooling](project_sprint17_complete.md) — all 6 S17 tickets done 2026-05-03; admin routes use getSession() correctly (web-only); finance/markets route does not query expertOpinions; pre-existing TS error in apps/web only
- [S25-T6 passed — Phone Verification Bonus OTP flow](project_s25t6_phone_verify.md) — all auth, idempotency, transaction, and mobile dismiss checks clean; API server was not running so runtime checks skipped
- [Prisma generate must precede server start when new models are added](feedback_prisma_generate_before_server.md) — new Prisma model routes return 500 for auth path if server started before generate ran; first seen S28-T1 (ExpertFollow)
- [Sprint 28 complete — Finance UX personalization](project_sprint28_complete.md) — all 4 S28 tickets done 2026-05-16; S28-T1 re-verified after Prisma generate was run; Prisma client confirmed 686 refs to expertFollow; follow/unfollow endpoints live; My Analysts chip row and filter logic in finance-mode.tsx fully implemented
- [Sprint 29 complete — Analyst Tier + Feed Personalization + MSG91 Phone](project_sprint29_complete.md) — all 6 S29 tickets done 2026-05-16; T4/T5/T6 passed QA cleanly; server runs on port 3001
- [Sprint 30 partial QA — S30-T1 failed, S30-T2/T3 passed](project_sprint30_partial.md) — S30-T1 failed: /api/profile/me missing totalReasoningUpvotes aggregate; S30-T2 tierProgress and nudge correct; S30-T3 recentCalls on public profile correct
