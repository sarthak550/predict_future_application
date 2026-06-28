---
name: project-sprint60-hardening
description: Sprint 60 — Scorecard integrity hardening + access control + perf + mobile reliability (8 tickets, June 2026)
metadata:
  type: project
---

Sprint 60 is a pure hardening sprint — no new features. Analyst scorecard correctness (Pillar A) is the forcing function.

**Key decisions made:**
- T4 access control: OWNER-only for admin-on-admin ban/remove — product decision locked, consistent with platform-level hierarchy.
- T3 Redis cap: increment ONLY on successful AI call completion, not on attempt. Rate-limited calls do not count.
- T2 same-day fix: return null (keep PENDING) not NOT_GRADED when callDate and resolutionDate hit the same Yahoo bar — so the cron retries later rather than permanently voiding the verdict.
- T5 streak cap at 90 days is an acceptable UX tradeoff; a separate count() call preserves accuracy metric.

**Why:** The preprocess script (finding 1) used publishedAt for eligibleAt while the cron route used analystCallAt — two different anchor dates meant some opinions were being resolved against the wrong price window. This corrupts hit/miss rates for calls where the article date differs from the analyst's actual call date (common on ET Markets where articles paraphrase notes from days prior).

**How to apply:** Before any future work on the resolution pipeline, verify that preprocess script, cron route, and evaluateOpinionResolution.ts all use the same callDate anchor: `analystCallAt ?? publishedAt`. See [[scorecard-integrity]].
