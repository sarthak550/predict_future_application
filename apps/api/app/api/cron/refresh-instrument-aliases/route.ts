import { NextResponse } from "next/server";

import { retryUnresolvedInstrumentAliases } from "@/lib/finance/instrumentAlias";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/refresh-instrument-aliases
 *
 * InstrumentAlias self-healing (founder, 2026-08-15: instruments in Opinions
 * "mapped but not clickable... needs to [be] handled at database level and
 * not always code, as we can't change the code every time a new instrument
 * comes in") — re-attempts every `resolved: false` alias row against the
 * CURRENT authoritative universe: ticker retry first (new listings flip old
 * negatives), then unanimous label-consensus name matching (fixes
 * extraction-mangled tickers whose display label identifies the company) —
 * see retryUnresolvedInstrumentAliases' own doc for the two passes and
 * their precision guards.
 *
 * Web linkification (apps/web/lib/finance/instrumentLink.ts) reads
 * InstrumentAlias at render time, so a row flipping here makes every
 * opinion carrying that instrument clickable with no other deploy/step.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret), same contract as
 * every other cron. Intended cadence — daily, after the evening EOD ingests
 * so a listing that traded for the first time TODAY resolves the same
 * night:
 *   30 16 * * * /bin/bash /home/ubuntu/run-cron.sh refresh-instrument-aliases
 * Cheap and idempotent (the negative-row set is ~100 rows and shrinks as
 * rows flip); safe to fire manually after growing any identity registry —
 * replaces the manual scripts/refresh-stale-index-aliases.ts chore.
 */
function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await retryUnresolvedInstrumentAliases(prisma);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/refresh-instrument-aliases] retry pass failed:", err);
    return NextResponse.json({ ok: false, error: "retry pass failed" });
  }
}

export const GET = run;
export const POST = run;
