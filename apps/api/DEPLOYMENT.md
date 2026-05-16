# Deployment Guide

This document covers environment variables and configuration required for production deployments.

---

## Phone Verification Setup

Phone verification uses MSG91 to send OTPs via SMS. The following environment variables must be set for production.

### Required Environment Variables

| Variable | Description |
|---|---|
| `MSG91_AUTH_KEY` | From MSG91 dashboard > API Key |
| `MSG91_SENDER_ID` | 6-char sender ID approved by MSG91 (e.g. `PRDCFT`) |
| `MSG91_TEMPLATE_ID` | DLT-registered template ID from MSG91 dashboard |
| `PHONE_VERIFY_MODE` | `dev` (logs OTP to console) or `prod` (sends real SMS) |

### Dev Mode

When `PHONE_VERIFY_MODE=dev` (or the variable is absent), the OTP is **not** sent via SMS. Instead:
- The OTP is logged to the server console.
- The API response includes `{ ok: true, devOtp: "XXXXXX" }` for easy testing.

### Production Mode

Set `PHONE_VERIFY_MODE=prod` AND provide a valid `MSG91_AUTH_KEY`.

The integration uses the MSG91 OTP API v5 endpoint:
```
POST https://control.msg91.com/api/v5/otp
Headers: { authkey: MSG91_AUTH_KEY, 'Content-Type': 'application/json' }
Body:    { template_id: MSG91_TEMPLATE_ID, mobile: '91' + phoneNumber, otp: generatedOTP }
```

### Graceful Fallback

If MSG91 returns a non-2xx response or the network request fails, the error is **logged to the server console but never returned to the client**. The OTP is still persisted in the database so a support engineer can retrieve it manually if needed. The user sees a success response regardless of SMS delivery.

---

## Cron Jobs

The following cron jobs are configured in `vercel.json`:

| Path | Schedule | Description |
|---|---|---|
| `/api/cron/news-ingestion` | Every 30 min | Ingest news from RSS sources |
| `/api/cron/probability-snapshot` | Hourly | Record market probability snapshots |
| `/api/cron/market-lifecycle` | Every 2 hours | Close/resolve markets past deadline |
| `/api/cron/auto-resolve-opinions` | 03:00 UTC daily | Auto-resolve expert opinions |
| `/api/cron/big-call-push` | 02:30 UTC daily | Send Big Call push notifications |
| `/api/cron/leaderboard-snapshot` | 18:59 UTC Sunday | Capture weekly leaderboard rank snapshots |
| `/api/cron/recalculate-analyst-tiers` | 02:00 UTC daily | Recompute analyst tiers for recently resolved users |

All cron routes are guarded by `CRON_SECRET`. Set this in your environment. Pass it as either:
- `Authorization: Bearer <CRON_SECRET>` header
- `x-cron-secret: <CRON_SECRET>` header

---

## Required Environment Variables (Full List)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | NextAuth.js signing secret |
| `NEXTAUTH_URL` | Yes | Base URL of the API app |
| `CRON_SECRET` | Yes (prod) | Shared secret for cron route authentication |
| `MSG91_AUTH_KEY` | Prod only | MSG91 API key |
| `MSG91_SENDER_ID` | Prod only | MSG91 6-char approved sender ID |
| `MSG91_TEMPLATE_ID` | Prod only | MSG91 DLT template ID |
| `PHONE_VERIFY_MODE` | No | `dev` (default) or `prod` |
