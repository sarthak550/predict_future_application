import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { castVote, isWebVoteChoice } from "@/lib/finance/votes";

/**
 * POST /api/finance/expert-opinions/[id]/vote
 *
 * Free "take a side" vote (Agree/Neutral/Disagree) on a PENDING expert call —
 * the web equivalent of mobile's Opine poll, restricted to the 3 plain buckets.
 * One click both casts AND locks the vote (see lib/finance/votes.ts for why).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { choice?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isWebVoteChoice(body.choice)) {
    return NextResponse.json(
      { error: "choice must be one of: AGREE, NEUTRAL, DISAGREE" },
      { status: 400 }
    );
  }

  const result = await castVote(params.id, session.user.id, body.choice);

  switch (result.status) {
    case "not-found":
      return NextResponse.json({ error: "Opinion not found" }, { status: 404 });
    case "not-votable":
      return NextResponse.json(
        { error: "This call has resolved — voting is closed." },
        { status: 409 }
      );
    case "locked":
      return NextResponse.json(
        { error: "Your vote is locked and cannot be changed." },
        { status: 409 }
      );
    case "ok":
      return NextResponse.json(result.tallies);
  }
}
