/**
 * TA Suite Sprint S1, T1 — compile-time-only consistency guard between the
 * workbench's own `DrawingOverlayName` (`catalog.ts`) and the validation
 * package's `ChartDrawingOverlayName` (`packages/validation/src/
 * chartDrawings.ts`, imported by `apps/api` too). This file has ZERO
 * runtime code — every export below is `type`-only and erased by the
 * compiler — its only job is to make a name added to one list but not the
 * other a `tsc` failure. Imported (side-effect, for its types) from
 * `overlays/index.ts` so it's always part of the compiled program; `tsc`
 * checks every file reachable from an entry point regardless of whether
 * anything imports a VALUE from it, but a bare unreferenced `.ts` file
 * sitting in the directory with no import anywhere is easy to silently stop
 * building on (e.g. a future `tsconfig` `include` narrowing) — the explicit
 * import in `overlays/index.ts` is belt-and-suspenders, matching this
 * codebase's existing "keep the runtime warn AND add the compile-time
 * guard" posture (see `workbench-toolbar.tsx`'s old drift-check, superseded
 * this sprint by `tool-registry.ts`'s `TOOL_REGISTRY satisfies` clause,
 * which follows the exact same "stronger compile-time check supersedes a
 * runtime one" pattern this file establishes for the overlay-name enum).
 *
 * A `// @ts-expect-error` intentionally left on either assertion below
 * would immediately surface as an "unused ts-expect-error" tsc error the
 * moment the two lists actually agree — there is no way for this guard to
 * silently stop checking anything.
 */
import type { ChartDrawingOverlayName } from "@predict-future/validation/chartDrawings";
import type { DrawingOverlayName } from "./catalog";

/** Every workbench overlay name must be a valid validation-schema enum value (a drawing the UI can draw but the API would 400 on save is a real bug this catches). */
type WorkbenchNamesAreValidationNames = DrawingOverlayName extends ChartDrawingOverlayName ? true : never;
/** Every validation-schema enum value must be a real workbench overlay name (a name the API accepts but the UI can never draw/hydrate is dead schema surface — also a real bug). */
type ValidationNamesAreWorkbenchNames = ChartDrawingOverlayName extends DrawingOverlayName ? true : never;

// Both must resolve to the literal type `true` — if either list drifts,
// the corresponding alias resolves to `never`, and assigning `never` to a
// `true`-typed const below fails `tsc` with a real, readable type error.
const _workbenchNamesAreValidationNames: WorkbenchNamesAreValidationNames = true;
const _validationNamesAreWorkbenchNames: ValidationNamesAreWorkbenchNames = true;
void _workbenchNamesAreValidationNames;
void _validationNamesAreWorkbenchNames;

export type { WorkbenchNamesAreValidationNames, ValidationNamesAreWorkbenchNames };
