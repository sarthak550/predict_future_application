/**
 * Backfill eventClusterId on opinions where it's null.
 *
 * Strategy:
 * - Fetch all active event clusters with their slug/name/description/dateRange
 * - For each opinion with no cluster, check if its quote/headline/instrument
 *   mentions cluster keywords (e.g. "RBI" matches "May 2026 RBI Policy Day").
 * - This is a deterministic keyword-match pass. AI-fallback could come later.
 *
 * Usage:
 *   npx tsx scripts/backfill-cluster-assignment.ts
 *
 * Env:
 *   LIMIT=200    — opinions per run (default 200)
 *   DRY_RUN=true — print decisions without DB writes
 */

import { prisma } from "../lib/prisma";

const LIMIT = parseInt(process.env.LIMIT ?? "500", 10);
const DRY_RUN = process.env.DRY_RUN === "true";

/**
 * Per-cluster keyword matchers. Substring match on lowercased headline + quote.
 */
type ClusterMatcher = {
  clusterId: string;
  clusterName: string;
  keywords: string[];
};

function buildMatchers(
  clusters: Array<{ id: string; name: string; description: string | null; slug: string }>
): ClusterMatcher[] {
  return clusters.map((c) => {
    const keywords: string[] = [];
    const name = c.name.toLowerCase();
    // Extract keyword tokens from cluster name (filter generic words)
    const tokens = name
      .split(/[\s\-_/]+/)
      .filter((t) => t.length > 2 && !["the", "and", "for", "with", "from", "policy", "day", "may", "jun", "june", "july", "aug", "2026", "2025", "2027"].includes(t));
    keywords.push(...tokens);
    // Specific overrides
    if (name.includes("rbi")) keywords.push("rbi", "monetary policy", "repo rate", "mpc");
    if (name.includes("budget")) keywords.push("budget", "fiscal", "finance minister", "nirmala sitharaman");
    if (name.includes("fed")) keywords.push("fed", "fomc", "powell", "federal reserve");
    if (name.includes("gst")) keywords.push("gst", "goods and services tax");
    return { clusterId: c.id, clusterName: c.name, keywords: [...new Set(keywords)] };
  });
}

async function main() {
  const clusters = await prisma.marketEventCluster.findMany({
    where: { endsAt: { gte: new Date() } },
    select: { id: true, name: true, description: true, slug: true },
  });
  console.log(`Active clusters: ${clusters.length}`);
  for (const c of clusters) console.log(`  - ${c.name}`);

  const matchers = buildMatchers(clusters);
  console.log("\nMatchers (keywords used):");
  for (const m of matchers) console.log(`  ${m.clusterName}: [${m.keywords.join(", ")}]`);

  const ops = await prisma.expertOpinion.findMany({
    where: {
      eventClusterId: null,
      suppressedAt: null,
    },
    select: {
      id: true,
      quote: true,
      instrument: true,
      story: { select: { headline: true } },
    },
    take: LIMIT,
  });

  console.log(`\nProcessing ${ops.length} unclustered opinions${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  const matchCounts = new Map<string, number>();
  let unmatched = 0;

  for (const op of ops) {
    const haystack = `${op.story?.headline ?? ""} ${op.quote} ${op.instrument ?? ""}`.toLowerCase();
    let assigned: ClusterMatcher | null = null;
    for (const m of matchers) {
      if (m.keywords.some((kw) => haystack.includes(kw))) {
        assigned = m;
        break;
      }
    }
    if (assigned) {
      matchCounts.set(assigned.clusterName, (matchCounts.get(assigned.clusterName) ?? 0) + 1);
      if (!DRY_RUN) {
        await prisma.expertOpinion.update({
          where: { id: op.id },
          data: { eventClusterId: assigned.clusterId },
        });
      }
    } else {
      unmatched++;
    }
  }

  console.log("Assignment summary:");
  for (const [name, count] of matchCounts) console.log(`  ${name}: ${count}`);
  console.log(`  (unmatched: ${unmatched})`);
  await prisma.$disconnect();
}

void main();
