/**
 * Sprint 55 demo seed — populates dev DB so the Explore tab actually shows
 * the new Community spotlight, Communities rail, and Hosted-by chips.
 *
 * 1. Creates (or reuses) an OPEN group "Mumbai Cricket Crew"
 * 2. Flips a few existing OPEN markets to belong to that group
 * 3. Membership backfill: makes the script-runner the owner so they appear
 *    in "My Groups" too
 *
 * Safe to re-run.
 *
 * Run: `npx tsx scripts/seed_s55_demo.ts` from apps/api
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma";

const GROUP_NAME = "Mumbai Cricket Crew";
const GROUP_SLUG = "mumbai-cricket-crew";
const GROUP_DESC =
  "Predictions, hot takes, and post-match arguments for everyone following Indian cricket. Run weekly markets on IPL, T20Is, and Mumbai Indians' next move.";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED_IN_PROD !== "yes-i-am-sure") {
    throw new Error("Refusing to run in production without ALLOW_DEMO_SEED_IN_PROD=yes-i-am-sure.");
  }

  console.log("Sprint 55 demo seed starting...\n");

  // 1. Pick any existing user as the group owner (first authenticated user found).
  const owner = await prisma.user.findFirst({
    where: { isSuspended: false },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("No users found to own the demo group.");
  console.log(`[1/3] Owner: ${owner.username || owner.id}`);

  // 2. Upsert the demo OPEN group.
  const group = await prisma.group.upsert({
    where: { slug: GROUP_SLUG },
    update: {
      visibility: "OPEN",
      category: "SPORTS",
      description: GROUP_DESC,
    },
    create: {
      slug: GROUP_SLUG,
      name: GROUP_NAME,
      description: GROUP_DESC,
      ownerId: owner.id,
      visibility: "OPEN",
      category: "SPORTS",
      memberCap: 10000,
      inviteCode: `demo-${Math.random().toString(36).slice(2, 10)}`,
    },
  });
  console.log(`       Group: ${group.name} (${group.id}, visibility=${group.visibility}, category=${group.category})`);

  // Ensure the owner has a membership row.
  await prisma.groupMembership.upsert({
    where: { groupId_userId: { groupId: group.id, userId: owner.id } },
    update: { role: "OWNER", bannedAt: null },
    create: { groupId: group.id, userId: owner.id, role: "OWNER" },
  });

  // 3. Tag 3 existing OPEN markets with this group so the Hosted-by chip renders.
  const markets = await prisma.market.findMany({
    where: { status: "OPEN", groupId: null },
    take: 3,
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
  });
  if (markets.length === 0) {
    console.log("[2/3] No untagged OPEN markets available to attach. Skipping market-tag step.");
  } else {
    for (const m of markets) {
      await prisma.market.update({ where: { id: m.id }, data: { groupId: group.id } });
      console.log(`       Tagged market ${m.id}: ${m.title.slice(0, 60)}`);
    }
  }

  console.log(`\nDone. Test it:`);
  console.log(`  curl http://localhost:3001/api/groups/discover`);
  console.log(`  → should return the Mumbai Cricket Crew at sort=members`);
  console.log(`\nIn the Expo app:`);
  console.log(`  - Open Explore → top should show the spotlight + communities rail`);
  console.log(`  - Scroll into the markets feed → tagged markets show "Hosted by Mumbai Cricket Crew"`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
