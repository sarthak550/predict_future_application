---
name: S25-T6 Phone Verification Bonus — QA result
description: Phone OTP flow passed all static checks; runtime checks skipped (server down)
type: project
---

S25-T6 passed QA on 2026-05-09 with all static checks clean and runtime checks skipped because the API server was not running at localhost:3001.

**Why:** First OTP/wallet-credit flow in the codebase. Transaction wraps all four DB writes (user.phoneVerified, user.phone, walletTransaction create, wallet balance increment, notification create) atomically. clearOtp() is called OUTSIDE the transaction — correct, prevents phantom OTP invalidation on tx rollback. Notification is inside the transaction (intentional — it IS the primary side-effect alongside wallet credit).

**How to apply:** When reviewing future wallet-credit flows, look for: (a) clearOtp/clearState called after tx commit, not inside; (b) no Expo push calls inside tx blocks; (c) idempotency guard before tx entry.

Key files:
- apps/api/lib/phone-verification.ts — in-memory OTP store keyed by userId
- apps/api/app/api/users/me/verify-phone/route.ts — initiation route
- apps/api/app/api/users/me/verify-phone/confirm/route.ts — confirm + wallet credit
- apps/api/app/api/profile/me/route.ts — exposes phoneVerified and isVerifiedAnalyst
- packages/api-client/src/index.ts — requestPhoneVerification + confirmPhoneVerification, both auth:true
- apps/mobile/src/app/(tabs)/profile.tsx — PhoneVerifyCard + PhoneVerifyModal, per-user dismiss key
