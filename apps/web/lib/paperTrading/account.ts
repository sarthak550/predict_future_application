/**
 * Paper Trading Phase 1 — account lazy-creation + reset (T9).
 *
 * Exactly one ACTIVE account per user at any time — app-layer enforced (no DB
 * constraint models "at most one ACTIVE row per userId", same convention as
 * PortfolioTransaction's "no update path for an EXECUTED row": the guarantee comes
 * from every write path going through these two functions, not from the schema).
 */

import { prisma } from "@/lib/prisma";

/** ₹1 crore (founder decision 2026-07-26, Moneybhai convention): index-futures margin at 15% of ~₹15-20L notional made the old ₹1L default unable to afford a single lot — every futures order would reject. */
export const PAPER_TRADING_STARTING_CAPITAL = 10_000_000;

/** Reset cooldown, in days, since the current ACTIVE account's createdAt. */
export const PAPER_TRADING_RESET_COOLDOWN_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PaperAccountRow {
  id: string;
  userId: string;
  status: "ACTIVE" | "ARCHIVED";
  generation: number;
  startingCapital: number;
  createdAt: Date;
  archivedAt: Date | null;
}

/**
 * Returns the caller's ACTIVE account, creating generation-1 on first visit.
 * Race-safe against two near-simultaneous first visits: re-checks for an
 * already-created ACTIVE row inside the transaction before creating a second one.
 */
export async function getOrCreateActiveAccount(userId: string): Promise<PaperAccountRow> {
  const existing = await prisma.paperTradingAccount.findFirst({ where: { userId, status: "ACTIVE" } });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const existingInTx = await tx.paperTradingAccount.findFirst({ where: { userId, status: "ACTIVE" } });
    if (existingInTx) return existingInTx;
    return tx.paperTradingAccount.create({
      data: { userId, startingCapital: PAPER_TRADING_STARTING_CAPITAL }
    });
  });
}

export interface ResetEligibility {
  eligible: boolean;
  /** Ceil'd days remaining until the cooldown clears. 0 when already eligible. */
  daysRemaining: number;
}

export function getResetEligibility(account: Pick<PaperAccountRow, "createdAt">, now: Date = new Date()): ResetEligibility {
  const ageDays = (now.getTime() - account.createdAt.getTime()) / MS_PER_DAY;
  if (ageDays >= PAPER_TRADING_RESET_COOLDOWN_DAYS) return { eligible: true, daysRemaining: 0 };
  return { eligible: false, daysRemaining: Math.ceil(PAPER_TRADING_RESET_COOLDOWN_DAYS - ageDays) };
}

export type ResetAccountResult =
  | { ok: true; account: PaperAccountRow }
  | { ok: false; status: 400 | 409; reason: string };

/**
 * Archives the current ACTIVE account and creates a new one at generation + 1,
 * same starting capital. Rejected with the days remaining if the cooldown (30 days
 * since the CURRENT account's createdAt — a fresh reset always creates a brand-new
 * createdAt, so this naturally re-anchors on every reset) hasn't elapsed. Order
 * history is never deleted — the archived account and its PaperOrder rows remain
 * queryable read-only forever.
 */
/** Reset-time capital bounds — Portfolios' convention (₹1L floor keeps costs meaningful; ₹1000Cr ceiling because investors aren't capped, per the founder's original Portfolios ruling). */
export const PAPER_TRADING_MIN_CAPITAL = 100_000;
export const PAPER_TRADING_MAX_CAPITAL = 10_000_000_000;

export async function resetAccount(userId: string, requestedCapital?: number): Promise<ResetAccountResult> {
  const active = await getOrCreateActiveAccount(userId);
  const eligibility = getResetEligibility(active);
  if (!eligibility.eligible) {
    return {
      ok: false,
      status: 409,
      reason: `You can reset your account again in ${eligibility.daysRemaining} day${eligibility.daysRemaining === 1 ? "" : "s"}.`
    };
  }

  // Founder 2026-07-26: the reset is where users set their own capital.
  if (requestedCapital !== undefined) {
    if (
      !Number.isInteger(requestedCapital) ||
      requestedCapital < PAPER_TRADING_MIN_CAPITAL ||
      requestedCapital > PAPER_TRADING_MAX_CAPITAL
    ) {
      return {
        ok: false,
        status: 400,
        reason: `Starting capital must be a whole rupee amount between ₹1,00,000 and ₹1,000 crore.`
      };
    }
  }

  const [, created] = await prisma.$transaction([
    prisma.paperTradingAccount.update({
      where: { id: active.id },
      data: { status: "ARCHIVED", archivedAt: new Date() }
    }),
    prisma.paperTradingAccount.create({
      // Resets adopt the CURRENT default (not the archived generation's) — pre-futures accounts upgrade to ₹1Cr on reset.
      data: { userId, startingCapital: requestedCapital ?? PAPER_TRADING_STARTING_CAPITAL, generation: active.generation + 1 }
    })
  ]);

  return { ok: true, account: created };
}
