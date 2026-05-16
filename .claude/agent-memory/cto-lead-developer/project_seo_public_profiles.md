---
name: SEO Public Profile Page
description: S25-T3 — server-rendered public analyst profile at /profile/[username] in apps/api
type: project
---

Public SEO profile page lives at `apps/api/app/profile/[username]/page.tsx` (server component, no auth).

**Why:** Google-indexed profiles are the #1 organic SEO play per Polymarket research. Shareable on WhatsApp/Twitter/LinkedIn with og: link previews.

**How to apply:** When working on anything that touches public profile URLs, deep links, or og: meta — this is the canonical page. URL pattern is `https://predictfuture.app/profile/{username}`. Deep link: `predictfuture://user/{username}`. CSS module at same directory (page.module.css). No Tailwind — API app has no Tailwind config.
