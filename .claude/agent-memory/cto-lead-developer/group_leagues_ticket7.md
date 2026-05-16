---
name: Group Prediction Leagues — Ticket 7
description: Sprint 2 Ticket 7: Group detail screen, launch endpoint, api-client method, and markets tab navigation (COMPLETE)
type: project
---

Group Prediction Leagues (L complexity) — fully implemented.

**Why:** Let group hosts bundle markets for a "matchday" — launch all at once, view markets by lifecycle status, and surface the invite code.

**How to apply:** Reference these decisions when extending group or market features.

## Files changed

- `apps/api/app/api/groups/[id]/launch/route.ts` — NEW. POST endpoint, owner-only, transitions DRAFT + PENDING_REVIEW markets to OPEN. Uses `approvedAt` field (not `openedAt` — that field doesn't exist in schema). Reads targetMarkets before updateMany so marketIds can be returned.
- `packages/api-client/src/index.ts` — Added `launchGroup(groupId)` method returning `{ launched: number; marketIds: string[] }`.
- `apps/mobile/src/app/group/[id].tsx` — NEW. Full group detail screen at `/group/:id`. Sections: header card (name/desc/owner/members/inviteCode+copy), Start Matchday button (owner-only when launchable markets exist), Live/Awaiting Resolution/Settled market sections, Members list.
- `apps/mobile/src/app/(tabs)/markets.tsx` — Added `useRouter` + chevron nav button on each group dropdown item → `/group/:id`. Also fixed pre-existing TS narrowing error where `mode === "polls"` was unreachable after early return — used type assertion `(mode as MarketMode) === "polls"`.

## Key implementation decisions

- `expo-clipboard` installed (`npm install expo-clipboard --workspace=apps/mobile`). Clipboard.setStringAsync() with fallback Alert showing invite code if clipboard fails.
- `useSession()` from `@/providers/session-provider` used for owner check (`session.userId === group.ownerId`).
- `data` from `useApiQuery` is cast as `{ group: GroupData }` since `ApiGroupDetail` type is loose (`Record<string, unknown>`).
- Start Matchday button shows count of launchable markets; on success shows Alert with launched count then calls `refetch()`.
- Markets tab: group navigation uses a small Feather chevron-right button alongside the existing select Pressable (preserves filter UX while adding navigation). Both share the same `dropdownItem` row.
- TS narrowing issue: after `if (mode === "polls") return ...`, TypeScript narrows `mode` to `"public" | "private"` for the rest of the function. Fix: `(mode as MarketMode) === "polls"` in the JSX toggle buttons.

## Schema note

`Market` model does NOT have `openedAt` — use `approvedAt` instead when recording when a market becomes OPEN.
