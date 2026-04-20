import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { addHostBondCap } from "@/lib/markets/bond";

const addBondSchema = z.object({
  amount: z.coerce.number().int().min(50).max(100000)
});

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const payload = addBondSchema.parse(await request.json());
    const result = await addHostBondCap({
      marketId: params.marketId,
      hostUserId: session.user.id,
      amount: payload.amount
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to add host bond."
      },
      { status: 400 }
    );
  }
}
