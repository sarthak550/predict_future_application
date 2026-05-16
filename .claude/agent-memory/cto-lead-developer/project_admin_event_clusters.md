---
name: Admin Event Cluster CRUD API
description: Admin CRUD endpoints for MarketEventCluster to replace manual seed.ts management
type: project
---

Added admin REST API for `MarketEventCluster` management.

**Why:** Clusters were manually seeded; when they expired, Finance tab showed empty data panels with no operator path to create new ones without a code deploy.

**How to apply:** Admins can now create/update/delete clusters via the admin UI or API without touching seed.ts.

**Endpoints:**
- `GET /api/admin/event-clusters` — list all clusters ordered by startsAt desc, includes `_count.markets`
- `POST /api/admin/event-clusters` — create cluster; accepts `{ title, description, emoji, startsAt, endsAt, dataPoints, category }`; slug auto-derived from title + timestamp
- `PATCH /api/admin/event-clusters/:id` — partial update of any cluster field
- `DELETE /api/admin/event-clusters/:id` — detaches linked markets (sets eventClusterId=null) then deletes

**Auth:** Same pattern as other admin routes — `getSession()` + role check (ADMIN or MODERATOR).

**Schema mapping:** `body.title` → `name`, `body.emoji` → `bannerEmoji` (matching existing MarketEventCluster field names).

**Files:**
- `apps/api/app/api/admin/event-clusters/route.ts`
- `apps/api/app/api/admin/event-clusters/[id]/route.ts`
