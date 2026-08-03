import { z } from "zod";

/**
 * User Strategy Scripting (SS1) — request-body schemas for
 * `apps/web/app/api/user-scripts/*`, plus the shared raw-script-result
 * schemas consumed by `lib/ta/user-scripts.ts` on BOTH the Worker/Node side
 * (validating a script's own `run()` return value) and the main-thread side
 * (`script-runner.ts` re-validating the `postMessage` envelope it receives
 * from the real worker — belt-and-suspenders since the payload has already
 * round-tripped through structured-clone). Mirrors
 * `packages/validation/src/chartDrawings.ts`'s shape/doc-comment
 * conventions exactly.
 */

/** A script name is a short, human-meaningful label — unique per user (`@@unique([userId, name])`), never used as an identifier elsewhere. */
export const USER_SCRIPT_NAME_MAX_LENGTH = 60;

/**
 * 20KB of raw JS source. Generous for a whole-series `{bars, ta, helpers}
 * -> signals` script (see `lib/ta/user-scripts.ts`'s `D4` calling
 * convention) while keeping a single row/response cheap — `GET
 * /api/user-scripts` returns full rows (source included) for every script a
 * user owns in one round trip, and 50 scripts x 20KB is ~1MB worst case for
 * one authenticated fetch.
 */
export const USER_SCRIPT_SOURCE_MAX_BYTES = 20_000;

/** Per-user script cap, enforced by `POST /api/user-scripts`'s count-then-create check — same accepted-TOCTOU posture as `CHART_DRAWINGS_MAX_PER_CHART_KEY`. */
export const USER_SCRIPT_MAX_PER_USER = 50;

/**
 * A script's raw `run()` return value can legitimately want to flag far
 * more bars than the chart can usefully render (e.g. a broken/overly-loose
 * condition matching thousands of bars). `resolveSignalsAgainstBars`
 * TRUNCATES to this cap rather than rejecting the run outright — the script
 * still "ran successfully," see `rawScriptSignalListSchema`'s doc comment
 * for why this is a slice, not a zod `.max()` bound.
 */
export const USER_SCRIPT_MAX_SIGNALS = 20_000;

export const userScriptNameSchema = z
  .string()
  .trim()
  .min(1, "Script name is required.")
  .max(USER_SCRIPT_NAME_MAX_LENGTH, `Script name must be ${USER_SCRIPT_NAME_MAX_LENGTH} characters or fewer.`);

export const userScriptSourceSchema = z
  .string()
  .min(1, "Script source is required.")
  .max(USER_SCRIPT_SOURCE_MAX_BYTES, `Script source must be ${USER_SCRIPT_SOURCE_MAX_BYTES.toLocaleString()} bytes or fewer.`);

export const createUserScriptSchema = z.object({
  name: userScriptNameSchema,
  source: userScriptSourceSchema,
});

export type CreateUserScriptInput = z.infer<typeof createUserScriptSchema>;

/**
 * PATCH body — `name`/`source` only, at least one required. Mirrors
 * `updateChartDrawingSchema`'s `.refine` exactly.
 */
export const updateUserScriptSchema = z
  .object({
    name: userScriptNameSchema.optional(),
    source: userScriptSourceSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.source !== undefined, {
    message: "At least one of name or source must be provided.",
  });

export type UpdateUserScriptInput = z.infer<typeof updateUserScriptSchema>;

// ── Raw script-result schemas (D8) ─────────────────────────────────────────
//
// A script's `run()` returns only `{index, side, note?}` tuples — indices
// into the host-supplied `bars` array, deliberately no `price`/`timestamp`
// (see `lib/ta/user-scripts.ts`'s `resolveSignalsAgainstBars` — prices and
// timestamps are ALWAYS re-derived from the caller's own `bars`, never
// trusted from anything the script returns).

export const rawScriptSignalSchema = z.object({
  index: z.number().int().nonnegative(),
  side: z.enum(["BUY", "SELL"]),
  note: z.string().max(200).optional(),
});

export type RawScriptSignal = z.infer<typeof rawScriptSignalSchema>;

/**
 * Deliberately a LOOSE structural bound (no `.max()` array-length check
 * here) — `USER_SCRIPT_MAX_SIGNALS` is enforced by an explicit slice AFTER
 * this schema validates, not by zod's own `.max()` behavior. `.max()` would
 * make the 20,001st signal a total run FAILURE (`ok: false`), which
 * contradicts the truncate-not-reject contract: a script producing more
 * signals than the cap still "ran successfully," it just gets its output
 * capped, same as `USER_SCRIPT_MAX_SIGNALS`'s own doc comment states.
 */
export const rawScriptSignalListSchema = z.array(rawScriptSignalSchema);

export type RawScriptSignalList = z.infer<typeof rawScriptSignalListSchema>;
