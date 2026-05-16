---
name: Phone OTP DB Migration
description: Replaced in-memory OTP store with DB-backed PhoneVerificationOtp table + MSG91 SMS integration
type: project
---

Phone OTP store migrated from in-memory Map to `PhoneVerificationOtp` Prisma model. Added MSG91 SMS dispatch for production.

**Why:** In-memory OTPs were lost on process restarts and never actually sent to users — silent failure in production.

**How to apply:** All functions in `lib/phone-verification.ts` are now async (storeOtp, getOtp, verifyOtp, clearOtp). Any future callers must await them. generateOtp() and normaliseIndianPhone() remain synchronous.

**Key details:**
- Schema: `PhoneVerificationOtp` with `userId @unique` (one pending OTP per user, upsert overwrites)
- Model added to `schema.prisma`; `User.phoneVerificationOtp PhoneVerificationOtp?` back-relation added
- Applied via `prisma db push` (shadow DB broken due to pre-existing migration history drift with enums)
- MSG91 integration in `app/api/users/me/verify-phone/route.ts`: fires only when `PHONE_VERIFY_MODE=prod` AND `MSG91_AUTH_KEY` is set; on SMS failure, logs error but returns HTTP 200 (OTP is in DB)
- confirm route: `verifyOtp` and `clearOtp` calls now awaited

**Env vars needed for production:**
- `MSG91_AUTH_KEY` — MSG91 API key
- `MSG91_TEMPLATE_ID` — approved SMS template ID
- `PHONE_VERIFY_MODE=prod` — enables real SMS (omit or set to `dev` for console-log fallback)
