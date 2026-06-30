---
name: cto-assignment-brief-sprint66
description: Sprint 66 — Profile LinkedIn-style redesign: 5 tickets covering header restyle, single-scroll stacking, Achievements section, activity/markets previews, and Track Record polish
metadata:
  type: project
---

Sprint 66 issued 2026-06-30. Mobile-only, no API/schema changes.

**Theme:** Transform the Profile tab from a gamified dark-header + sub-tab layout into a LinkedIn-inspired single elegant scroll with restraint as the core design principle.

**Design system anchor:** Indigo Futures tokens. Accent = #2563EB. Analysts = blue pillar. No emoji, no colored badge pills.

**5 tickets:**
- S66-T1 CRIT — Header restyle: light surface, blue avatar, analyst headline line
- S66-T2 CRIT — Remove sub-tabs, stack all sections unconditionally with SectionHeader labels
- S66-T3 HIGH — AchievementsSection: quiet icon+label+value rows (tier, league, streak, level, host)
- S66-T4 HIGH — Activity preview (5 interleaved rows + "See all"), Markets (4 rows, no nested ScrollView)
- S66-T5 MED — Track Record polish (surfaceMuted pills, expanded cat breakdown, updated copy)

**Key product decisions locked in this spec:**
- Header headline = "{Analyst Tier} · {accuracy}% accuracy" (not level or streak)
- Achievements section returns null entirely for brand-new users (no empty shell)
- Activity sub-tab toggle (Bets|Votes) removed; interleaved list replaces it
- Nested ScrollView inside profile ScrollView removed (was causing iOS scroll jank)
- Category breakdown defaults to expanded in single-scroll layout

**Why:** [[project_design_direction_indigo_futures]] + user explicitly approved LinkedIn direction in the conversation.
