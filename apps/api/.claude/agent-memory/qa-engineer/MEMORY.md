# QA Engineer Memory

- [Recurring CTO blind spot — missing auth:true on api-client methods](feedback_auth_true_recurring.md) — Two separate sprints (S9-T1, S12) hit the same missing auth:true pattern; escalate as systemic
- [Security — leaderboard route leaks full user rows due to missing select clause](feedback_api_select_clause.md) — prisma.user.findMany without select exposes passwordHash/email/expoPushToken; found S12 QA
