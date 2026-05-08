---
name: External market source architecture
description: How imported/archived markets from external platforms (Manifold, Kalshi, Metaculus) are modelled in the Market schema
type: project
---

External markets are ingested as native Market rows with two additional fields added in S24-T11:

- `originPlatform String?` — free-text identifier (e.g. 'manifold'). Kept as String, not an enum, so future sources require no migration.
- `externalId String? @unique` — composite key in the form `'<platform>:<remoteId>'` (e.g. `'manifold:abc123'`). The unique index is the idempotency key for import scripts.

**Why String over enum:** A `MarketSource` or `originPlatform` enum would require a migration for every new data source. String is a deliberate choice to keep the schema stable as we add Kalshi, Metaculus, etc.

**How to apply:** When writing any import script for an external prediction platform, always use `externalId = '<platform>:<remoteId>'` and upsert on that field. Check `originPlatform` in UI code to conditionally render attribution badges and suppress bet panels on archived markets.

**Attribution rule:** Imported markets store the canonical source URL in `resolutionSourceUrl` (already exists on Market) — no new field needed for the URL. The `originPlatform` field drives the badge render logic on mobile MarketCard.
