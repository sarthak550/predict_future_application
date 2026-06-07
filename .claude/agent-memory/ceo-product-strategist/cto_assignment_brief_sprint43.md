---
name: cto-assignment-brief-sprint43
description: Sprint 43 tickets — Expert Opinions quality layer (instrument commitment, validator backstop, instrument-null bug, sectoral TICKER_MAP)
metadata:
  type: project
---

Sprint 43 issued 2026-06-06. Two tickets targeting the Finance section's false-positive opinion quality problem.

**Why:** 23% of visible opinions were mislabeled macro commentary (SIP behaviour, sentiment mood pieces, RBI policy observations) tagged as BULLISH/BEARISH. 58% of all opinions had instrument=NULL. User-reported quality complaint.

**S43-T1 (CRIT):** `apps/api/lib/ai/extractExpertOpinions.ts` — add `instrumentType`/`instrumentLabel` fields to AI output schema; move instrument-required rule to top of REJECTION CRITERIA; add 3 BAD EXAMPLE blocks (SIP commentary, mood observation, generic macro); raise validator quote floor 20→80 chars, confidence floor 0.75→0.82; add numeric anchor gate (exempt for SECTOR type).

**S43-T2 (HIGH):** `apps/api/lib/ai/extractInstrument.ts` — diagnostic logging to surface null-input bug; add 20 sectoral TICKER_MAP entries (capital goods, FMCG, metals, auto, IT, pharma, realty, infra, energy, private banks, PSU banks); CTO must validate Yahoo tickers before committing.

**Shipping decision:** Both tickets in one PR — small surface, fully related, no schema changes.

**Risk flags:** ^CNXCAPITAL may not be a valid Yahoo ticker (needs validation). Confidence floor 0.82 could over-reject — watch production logs for >30% rejection rate in first 48h.

**How to apply:** When reviewing Finance section work, recall this quality threshold baseline. The numeric anchor gate is the main lever for future tuning.
