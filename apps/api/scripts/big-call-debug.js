// Mirrors the scoring in apps/api/app/api/finance/big-call/route.ts
// Run with: node /Users/sarthak/predict_future/apps/api/scripts/big-call-debug.js
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

function freshnessScore(publishedAt) {
  const ageHours = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60);
  return Math.pow(0.5, ageHours / 24);
}

(async () => {
  // ── Stage 1: Pool selection (Live/Weekend variant — no after-hours filter) ──
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const pending = await p.expertOpinion.findMany({
    where: {
      resolutionStatus: "PENDING",
      suppressedAt: null,
      publishedAt: { gte: cutoff },
      isSourceAttribution: false,
    },
    include: { expert: { select: { name: true, organization: true, verified: true } } },
    orderBy: { publishedAt: "desc" },
    take: 200,
  });

  // ── Stage 2: Locked-vote counts per opinion (heat signal) ──
  const ids = pending.map((o) => o.id);
  const counts = await p.expertOpinionVote.groupBy({
    by: ["opinionId"],
    where: { opinionId: { in: ids }, pollType: "IMPLICATION", lockedAt: { not: null } },
    _count: { id: true },
  });
  const voteMap = new Map(counts.map((c) => [c.opinionId, c._count.id]));

  // ── Stage 3: Cluster heat (sum of locked votes per cluster, normalized) ──
  const opinionClusterMap = new Map();
  for (const op of pending) {
    if (op.eventClusterId) opinionClusterMap.set(op.id, op.eventClusterId);
  }
  const clusterVotes = await p.expertOpinionVote.groupBy({
    by: ["opinionId"],
    where: {
      pollType: "IMPLICATION",
      lockedAt: { not: null },
      opinionId: { in: pending.filter((o) => o.eventClusterId).map((o) => o.id) },
    },
    _count: { id: true },
  });
  const clusterSums = new Map();
  for (const row of clusterVotes) {
    const cId = opinionClusterMap.get(row.opinionId);
    if (cId) clusterSums.set(cId, (clusterSums.get(cId) ?? 0) + row._count.id);
  }
  const maxCluster = Math.max(1, ...Array.from(clusterSums.values()));
  const clusterHeatMap = new Map();
  for (const [cId, total] of clusterSums) clusterHeatMap.set(cId, total / maxCluster);

  // ── Stage 4: pollAVolume normalization ──
  const allCounts = pending.map((o) => voteMap.get(o.id) ?? 0);
  const maxLog = Math.max(1, ...allCounts.map((v) => Math.log10(v + 1)));

  // ── Score ──
  const scored = pending.map((op) => {
    const tier = op.expert.verified ? 1.0 : 0.5;
    const fresh = freshnessScore(op.publishedAt);
    const votes = voteMap.get(op.id) ?? 0;
    const volNorm = Math.log10(votes + 1) / maxLog;
    const clusterHeat = op.eventClusterId ? (clusterHeatMap.get(op.eventClusterId) ?? 0.1) : 0.1;
    const score = tier * fresh * clusterHeat * Math.max(volNorm, 0.1);
    const ageHours = (Date.now() - op.publishedAt.getTime()) / (1000 * 60 * 60);
    return { op, tier, fresh, clusterHeat, volNorm, votes, ageHours, score };
  });

  scored.sort((a, b) => b.score - a.score);

  console.log(`Pool size: ${pending.length}`);
  console.log(`Top 10 candidates by score:\n`);
  console.log(
    "rank | name                          | direction | inst                    | age(h)  | tier | fresh   | cluster | vol     | score"
  );
  console.log("-----+-------------------------------+-----------+-------------------------+---------+------+---------+---------+---------+--------");
  for (let i = 0; i < Math.min(10, scored.length); i++) {
    const r = scored[i];
    const name = (r.op.expert.name || r.op.expert.organization || "??").slice(0, 29).padEnd(29);
    const dir = r.op.direction.padEnd(9);
    const inst = (r.op.instrument || "-").slice(0, 23).padEnd(23);
    console.log(
      `  ${String(i + 1).padStart(2)} | ${name} | ${dir} | ${inst} | ${r.ageHours.toFixed(1).padStart(6)} | ${r.tier.toFixed(1)} | ${r.fresh.toExponential(2)} | ${r.clusterHeat.toFixed(3).padStart(7)} | ${r.volNorm.toFixed(3).padStart(7)} | ${r.score.toExponential(2)}`
    );
  }

  // ── Show what beats #2: explain why ──
  if (scored.length >= 2) {
    const w = scored[0], r2 = scored[1];
    console.log(`\n=== Why #1 (${w.op.expert.name || w.op.expert.organization}) beat #2 (${r2.op.expert.name || r2.op.expert.organization}) ===`);
    console.log(`#1: tier=${w.tier} × fresh=${w.fresh.toExponential(2)} × cluster=${w.clusterHeat.toFixed(3)} × vol=${Math.max(w.volNorm, 0.1).toFixed(3)} = ${w.score.toExponential(3)}`);
    console.log(`#2: tier=${r2.tier} × fresh=${r2.fresh.toExponential(2)} × cluster=${r2.clusterHeat.toFixed(3)} × vol=${Math.max(r2.volNorm, 0.1).toFixed(3)} = ${r2.score.toExponential(3)}`);
    console.log(`#1/#2 ratio: ${(w.score / r2.score).toFixed(2)}×`);
  }

  await p.$disconnect();
})();
