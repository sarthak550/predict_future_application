---
name: Strategic Risks
description: Top risks that could kill or severely damage Predict Future, identified 2026-05-01
type: project
---

1. **Cold start / engagement loop problem**: With no real money, the incentive to participate depends entirely on gamification quality. If early markets have low volume, the crowd signal is meaningless and users churn.

2. **Mobile auth gap**: The mobile app currently uses a hard-coded demo user ID (EXPO_PUBLIC_DEMO_USER_ID). Any real user acquisition on mobile is impossible until this is resolved. This is a P0 blocker.

3. **Host system complexity vs. new user experience**: The host eligibility requirements (14-day age, 2 valid finalized markets, trust score 55+) create a long valley of death for new hosts. New users can't host meaningful markets for weeks. This may suppress the supply side of the market creation loop.

4. **AI poll rate limiting**: Groq free tier requires 15s between poll generation calls. With MAX_AI_POLLS_PER_BATCH=8, a full batch takes 2+ minutes. If AI poll generation is the primary way the feed stays fresh, this ceiling will bite at scale.

5. **Technical debt — dual validation and duplicate lib files**: Web app duplicates API lib files (prisma.ts, notifications.ts, stats.ts). Shared Zod packages co-exist with per-app local validation. This will cause divergence bugs as the product evolves.
