import { prisma } from "@/lib/prisma";
import { buildTalliesResponse, type TalliesResponse } from "@/lib/finance/tallies";

/**
 * Web only ever writes these 3 plain buckets — never the STRONGLY_* buckets
 * mobile's two-step Opine poll can produce (apps/mobile/src/app/finance/opinion/[id].tsx
 * folds 5 buckets down to 3 display buttons before showing them, but still writes the
 * raw 5-bucket value). Keeping web's writes to the plain 3 means every web vote reads
 * back identically regardless of which platform folds/displays it.
 */
export const WEB_VOTE_CHOICES = ["AGREE", "NEUTRAL", "DISAGREE"] as const;
export type WebVoteChoice = (typeof WEB_VOTE_CHOICES)[number];

export function isWebVoteChoice(value: unknown): value is WebVoteChoice {
  return typeof value === "string" && (WEB_VOTE_CHOICES as readonly string[]).includes(value);
}

export type CastVoteResult =
  | { status: "ok"; tallies: TalliesResponse }
  | { status: "not-found" }
  /** Opinion exists but voting is closed: suppressed, or resolutionStatus isn't PENDING. */
  | { status: "not-votable" }
  | { status: "locked" };

/**
 * Casts a free "take a side" vote on an expert opinion (web-only entry point).
 *
 * Web is one-click-deliberate — unlike mobile's two-step cast-then-lock flow (vote,
 * then a separate lock-vote call), a single web click both records AND locks the vote
 * (lockedAt: now on write). Once locked it cannot be changed, same as mobile.
 *
 * Guard order mirrors apps/api/app/api/finance/expert-opinions/[id]/vote/route.ts:
 *   1. opinion must exist and not be suppressed, and must still be PENDING
 *      (otherwise voting is closed) — checked inside a transaction so a concurrent
 *      admin resolve can't slip in between the guard read and the write.
 *   2. an existing LOCKED vote blocks any further change.
 *   3. upsert on the (userId, opinionId, pollType) unique constraint, pollType
 *      hardcoded to "IMPLICATION" — the only live poll type (RETROSPECTIVE is dead).
 */
export async function castVote(
  opinionId: string,
  userId: string,
  choice: WebVoteChoice
): Promise<CastVoteResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const opinion = await tx.expertOpinion.findUnique({
        where: { id: opinionId },
        select: { resolutionStatus: true, suppressedAt: true },
      });
      if (!opinion) throw new Error("NOT_FOUND");
      if (opinion.suppressedAt || opinion.resolutionStatus !== "PENDING") {
        throw new Error("NOT_VOTABLE");
      }

      const existing = await tx.expertOpinionVote.findUnique({
        where: {
          userId_opinionId_pollType: {
            userId,
            opinionId,
            pollType: "IMPLICATION",
          },
        },
        select: { lockedAt: true },
      });
      if (existing?.lockedAt) throw new Error("LOCKED");

      await tx.expertOpinionVote.upsert({
        where: {
          userId_opinionId_pollType: {
            userId,
            opinionId,
            pollType: "IMPLICATION",
          },
        },
        update: { choice, lockedAt: new Date() },
        create: {
          userId,
          opinionId,
          pollType: "IMPLICATION",
          choice,
          lockedAt: new Date(),
        },
      });
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") return { status: "not-found" };
      if (err.message === "NOT_VOTABLE") return { status: "not-votable" };
      if (err.message === "LOCKED") return { status: "locked" };
    }
    throw err;
  }

  const tallies = await buildTalliesResponse(opinionId, userId);
  return { status: "ok", tallies };
}
