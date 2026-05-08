---
name: S24-T3 follow notifications — implementation notes
description: How notifyFollowers/sendFollowerPushNotifications are wired; notable design choices
type: project
---

S24-T3 passed QA on 2026-05-06.

**Key implementation choices:**
- `notifyFollowers` in `apps/api/lib/notifications.ts` does NOT accept a prismaClient param (AC2 wording was contradictory). Uses module-level `prisma` client — correct because it must run outside any transaction.
- `sendFollowerPushNotifications` uses native `fetch` to call Expo's HTTP push API directly — does NOT use `expo-server-sdk`. No dependency gap; Node v23 ships native fetch.
- Auto-approve path gates follower notifications to `visibility === 'PUBLIC'` — private group markets deliberately excluded.
- Migration `20260506130000_add_follow_notification_types` confirmed applied and both enum values present in DB.

**Why:** fire-and-forget outside transaction is the right pattern; using module-level prisma avoids accidental transaction coupling.

**Runtime note:** mobile login returning 500 as of 2026-05-06 (pre-existing env issue — bcrypt compare succeeds in isolation, server throws internally). Not introduced by S24-T3.
