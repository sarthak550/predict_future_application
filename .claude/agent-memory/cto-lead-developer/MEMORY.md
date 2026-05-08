# CTO Memory Index

- [project_stack.md](project_stack.md) — Monorepo tech stack, package layout, key architectural constraints
- [auth_architecture.md](auth_architecture.md) — Sprint 1 Ticket 1: real mobile auth implementation decisions and follow-up items (COMPLETE)
- [market_detail_ticket2.md](market_detail_ticket2.md) — Sprint 1 Ticket 2: estimated return row in betting panel, isPoll analysis (COMPLETE)
- [onboarding_ticket3.md](onboarding_ticket3.md) — Sprint 1 Ticket 3: 3-screen mobile onboarding, isNewUser flag, static host progress bars (COMPLETE)
- [push_notifications_ticket4.md](push_notifications_ticket4.md) — Sprint 1 Ticket 4: Expo push notifications for market lifecycle events, schema + endpoint + resolution hook + mobile registration (COMPLETE)
- [group_leagues_ticket7.md](group_leagues_ticket7.md) — Sprint 2 Ticket 7: Group detail screen, launch endpoint, api-client method, markets tab navigation (COMPLETE)
- [sprint7_tickets.md](sprint7_tickets.md) — Sprint 7 T3-T8: onboarding, streak/P&L, sports linked markets, sort controls, share URLs — all COMPLETE
- [project_sprint11.md](project_sprint11.md) — Sprint 11 Profile redesign: T1 sticky header (done), T2 sub-tabs (qa-review), T3 consolidated Performance card (pending). Human checkpoint required between T2 and T3.
- [project_sprint13_finance.md](project_sprint13_finance.md) — Sprint 13 Finance section COMPLETE: T1 schema, T2 Gemini extraction, T3 source config + FINANCE tagging, T4 mobile Expert Take card.
- [project_sprint17.md](project_sprint17.md) — Sprint 17 all 6 tickets DONE; story route, admin queue, colorful avatars, Finance discovery chip, card polish, AI daily cap
- [project_sprint18.md](project_sprint18.md) — Sprint 18 COMPLETE: AnalystSentimentCard, cluster data panels, dropped Other Finance Markets, eventClusterId FK + scroll-to-section filter UX
- [project_poll_a_magnitude_slider.md](project_poll_a_magnitude_slider.md) — S19-T1: 5-bucket slider replaced 3-button Poll A; legacy BULLISH/BEARISH/NEUTRAL mapping kept server-side
- [project_admin_resolution_scope.md](project_admin_resolution_scope.md) — Admin HIT/MISS UI gaps: no evidenceUrl field, no NOT_GRADED in UI, no audit trail FK, no reversal path, take:100 cap, no pagination/filter
- [project_sprint24.md](project_sprint24.md) — Sprint 24: T1 done, T2 done, T3 qa-review, T4 (daily quests) qa-review; T5-T11 PENDING.
- [external_market_sources.md](external_market_sources.md) — originPlatform (String?) + externalId (String? @unique) on Market for external imports; String not enum; externalId = 'platform:remoteId' idempotency key
