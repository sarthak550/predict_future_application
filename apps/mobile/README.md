# @predict-future/mobile

Android-first Expo application for the Predict Future play-money prediction platform.
The mobile app is a thin client — all business rules live in `apps/api` and shared
logic in `packages/*`.

## File layout

```
apps/mobile/
├── app.json              Expo config (Android intent filters, splash, scheme)
├── babel.config.js
├── metro.config.js
├── tsconfig.json
└── src/
    ├── app/              Expo Router route tree
    │   ├── _layout.tsx   Root stack + providers
    │   ├── (tabs)/       Tab navigator screens
    │   └── market/[id]   Market detail route
    ├── components/       Reusable presentational components
    ├── hooks/            Reusable hooks (useApiQuery, …)
    ├── lib/              Non-UI app singletons (api client, env)
    └── providers/        Top-level React context providers
```

`src/app` is the Expo Router app directory (Expo Router auto-detects `app/` or `src/app/`).

## Import conventions

- `@/…` resolves to `./src/…` (see `tsconfig.json` paths and `app.json` `experiments.tsconfigPaths`).
- `@predict-future/*` resolves to shared workspace packages.

Never reach into another app's source (`apps/web`, `apps/api`) directly. If you need
something from the backend, extend the shared types/validation packages and add an
endpoint to `apps/api` consumed via `@predict-future/api-client`.

## Environment

Copy the example and fill in the values appropriate for your dev machine:

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | Base URL of `apps/api`. See notes in `.env.example` for emulator vs device. |
| `EXPO_PUBLIC_DEMO_USER_ID` | Dev-only: seeded user to render the profile tab before real auth lands. |

All env reads go through `src/lib/env.ts` — screens should never touch `process.env` directly.

## Scripts

```bash
npm run dev --workspace=@predict-future/mobile       # Expo dev server
npm run android --workspace=@predict-future/mobile   # Build + run on Android
npm run typecheck --workspace=@predict-future/mobile
npm run lint --workspace=@predict-future/mobile
```

## Data fetching

Use `useApiQuery` from `@/hooks/useApiQuery`:

- canonical `idle | loading | success | error` status
- mount-guarded `setState` (no writes after unmount)
- `refetch()` handles both pull-to-refresh and retry buttons
- `enabled` flag lets screens defer until auth/params are ready

If a screen needs richer cache/dedup semantics, promote the fetch into
`packages/api-client` first, and only then consider a client-side cache library.

## Auth

Screens consume `useSession()` from `@/providers/session-provider`. The scaffold
currently resolves a demo session from `EXPO_PUBLIC_DEMO_USER_ID`. When real auth
ships (Clerk or credential exchange against `apps/api`), swap the implementation
inside `session-provider.tsx` without touching screens.

## Deep linking

`app.json` registers the `predictfuture://` custom scheme plus an Android App Links
intent filter for `https://predictfuture.app`. Routes map 1:1 to the Expo Router
tree, e.g. `predictfuture://market/<id>` opens `src/app/market/[id].tsx`.

## Error handling

A top-level `<ErrorBoundary>` (in `src/providers/index.tsx`) catches render errors
and offers a "Try again" reset. For network errors inside a screen, prefer the
error branch returned by `useApiQuery` with a retry button — do not let them
bubble up to the boundary.

## Things intentionally light in the first pass

- `create` and `groups` tabs are placeholder scaffolds — rich flows remain on web.
- No client-side query cache library yet. Add one if fetch dedup/invalidation pain
  shows up, not before.
- No real auth exchange with `apps/api` yet — `SessionProvider` is ready to hold it.
