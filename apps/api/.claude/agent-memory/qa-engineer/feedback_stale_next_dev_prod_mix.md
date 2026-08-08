---
name: feedback_stale_next_dev_prod_mix
description: A .next dir left over from a prior `next build`/standalone check, then reused by `next dev` on top, serves a broken mix — framework chunks 404 even though the page itself 200s. Always confirm which mode produced the .next you inherited.
metadata:
  type: feedback
---

Found 2026-08-04 during SS1 QA. Inherited an already-running `next dev -p 3000`
(started by someone else, PID traced via `lsof`/`ps` to confirm it really was
`next dev`, not `next start`). `/` and the SS1 dev-harness page both returned
200, but 3 of the 4 core framework chunks the HTML itself referenced
(`main-app.js`, `polyfills.js`, `app-pages-internals.js`, `layout.css`) 404'd
— repeatably, not a compile-race (retried fresh fetches, same result).

**Root cause**: `.next/standalone/` and a `BUILD_ID` file were present —
proof a real `next build` had run earlier (the CTO's own memory for this
sprint confirms they ran one to verify the Docker standalone worker-chunk
acceptance criterion). `next dev` was then started without clearing `.next`
first. Dev mode serves framework chunks under stable UNHASHED names
(`main-app.js`) while a production build writes them under CONTENT-HASHED
names (`main-app-<hash>.js`) — dev mode apparently didn't regenerate the
unhashed copies for chunks it could reuse a cached hashed version of
internally, so direct HTTP fetches for the unhashed URLs the HTML itself
emitted 404'd.

**Fix**: `rm -rf apps/web/.next` then restart `npm run dev` fresh. Every
chunk (including this sprint's new Worker chunk,
`_app-pages-browser_..._strategy-worker_ts.js`) served 200 immediately after.

**How to apply**: before trusting any inherited/already-running dev server's
asset-serving behavior, check for `.next/standalone` or `.next/BUILD_ID` as a
tell that a `next build` happened in that same `.next` dir. If present and
you're about to do chunk-serving verification (worker chunks, new async
routes), do a clean `rm -rf .next` + fresh `npm run dev` restart first rather
than debugging phantom 404s against a mixed-mode directory. This is safe —
`.next` is a disposable build cache, always gitignored, never source.
