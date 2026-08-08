/**
 * Merge duplicate Expert rows caused by org-spelling drift in AI extraction.
 *
 * Founder priority (2026-08): the same real analyst ends up with multiple Expert
 * profiles because Expert has `@@unique([name, organization])` — any new org
 * spelling for an already-known name creates a brand-new row (e.g. "Geojit
 * Investments" / "Geojit Investments Limited" / "Geojit Financial Services";
 * "Rohit Srivastava" split across "Independent", "Strike Money Analytics and
 * Indiacharts", "Strike Money Analytics & Indiacharts", "strike.money and
 * indiacharts.com"). This script finds and merges those, offline and reviewably.
 *
 * lib/finance/expertMatch.ts is the extraction-time PREVENTION half — new dupes of
 * this exact shape should stop forming once that's deployed. This script is the
 * CLEANUP half for dupes that already exist. Both share the same classification
 * logic in lib/finance/expertDedup.ts — see that module's doc comment for why they
 * must never diverge.
 *
 * ── The hard law ─────────────────────────────────────────────────────────────
 * SAME NAME DOES NOT MEAN SAME PERSON. Two different real people can share a name
 * (e.g. two well-known "Nilesh Shah"s in Indian finance media — one at Kotak
 * Mahindra AMC, one at Envision Capital, both quoted regularly). This script only
 * ever auto-merges experts that share a normalized name AND whose organizations
 * pass a confident variant test (lib/finance/expertDedup.ts#orgVariantConfidence).
 * Anything else — including "Independent" vs a named org for the same name — goes
 * to the REVIEW list and is NEVER touched automatically.
 *
 * ── What gets merged, per cluster ────────────────────────────────────────────
 * 1. Pick a canonical expert: most opinions, tiebreak verified > has bio/avatar/
 *    tipranksUrl > oldest (createdAt).
 * 2. Canonical keeps its slug, gains the "best" (longest/most complete) org string
 *    among the cluster's variants, and backfills any bio/avatarUrl/tipranksUrl/
 *    linkedinUrl it's missing from a dupe that has one.
 * 3. Per dupe, in a single per-cluster transaction:
 *    a. ExpertOpinion.expertId -> canonical.id. Where the reassignment would
 *       collide with the @@unique([expertId, storyId, quoteHash]) constraint
 *       (canonical already has the identical quote for the identical story), the
 *       dupe's colliding row is deleted instead — it's a true duplicate opinion,
 *       not new information — and counted separately in the report.
 *    b. ExpertFollow -> reassigned to canonical, deduped on @@unique([userId,
 *       expertId]) the same way (delete the dupe's follow row if the user already
 *       follows canonical).
 *    c. ExpertOpinionVote: verified no-op — it references opinionId/userId only,
 *       never expertId, so votes move automatically with their opinion row.
 *    d. Portfolio (SHADOW kind, ownerExpertId): if only the dupe owns one, it's
 *       reassigned to canonical. If canonical ALSO already owns one, the dupe's
 *       portfolio is deleted instead (never merging two independent cash-simulated
 *       transaction histories by hand) — per lib/portfolios/shadowGenerator.ts,
 *       shadow portfolios are fully regenerated from an expert's current graded
 *       opinions on every incremental run ("found-or-created per Expert",
 *       transaction list "recomputed from scratch every run"), so canonical's
 *       existing portfolio will naturally pick up the newly-merged opinions on the
 *       next portfolios-shadow cron run with no manual reconciliation needed.
 *    e. Delete the dupe Expert row.
 * 4. Idempotent: once dupes are deleted, a re-run finds no cluster left to merge.
 *
 * ── Usage (from apps/api) ────────────────────────────────────────────────────
 *   npx tsx scripts/merge-duplicate-experts.ts                # dry run (default), human + JSON report
 *   npx tsx scripts/merge-duplicate-experts.ts --execute       # actually perform the merges
 *   npx tsx scripts/merge-duplicate-experts.ts --json-only     # suppress the human table, JSON only
 *   npx tsx scripts/merge-duplicate-experts.ts --selftest      # run normalizer/classifier unit fixtures, no DB
 *
 * NEVER run --execute against prod from a dev sandbox — that's the orchestrator's
 * step, after reviewing a dry-run plan.
 */

import type { PrismaClient } from "@prisma/client";

import {
  clusterOrgVariants,
  normalizeExpertName,
  orgVariantConfidence,
  pickBestOrgString,
} from "../lib/finance/expertDedup";
import { prisma } from "../lib/prisma";

const EXECUTE = process.argv.includes("--execute");
const JSON_ONLY = process.argv.includes("--json-only");
const SELFTEST = process.argv.includes("--selftest");

// ─── Selftest (no DB) ────────────────────────────────────────────────────────────

function selftest(): void {
  let pass = 0;
  let fail = 0;
  const assert = (label: string, cond: boolean) => {
    if (cond) {
      pass++;
    } else {
      fail++;
      console.error(`  FAIL: ${label}`);
    }
  };

  console.log("Running merge-duplicate-experts selftest (normalizer + classifier)...\n");

  // normalizeExpertName
  assert(
    "case/whitespace normalized",
    normalizeExpertName("  Rohit   Srivastava ") === normalizeExpertName("rohit srivastava")
  );
  assert(
    "punctuation stripped",
    normalizeExpertName("Sudip Bandyopadhyay,") === normalizeExpertName("Sudip Bandyopadhyay")
  );
  assert("blank stays blank", normalizeExpertName("   ") === "");

  // orgVariantConfidence — real dupes from actual dev-DB clusters (see task notes)
  assert(
    "Geojit suffix variant (substring)",
    orgVariantConfidence("Geojit Investments", "Geojit Investments Limited")
  );
  assert(
    "Geojit brand-token variant",
    orgVariantConfidence("Geojit Financial Services", "Geojit Investments Limited")
  );
  assert(
    "Carnelian suffix variant",
    orgVariantConfidence("Carnelian Asset Management", "Carnelian Asset Management & Advisors")
  );
  assert(
    "Nuvama suffix variant",
    orgVariantConfidence("Nuvama Institutional Equities", "Nuvama Institutional")
  );
  assert("case-only variant", orgVariantConfidence("Mirae Asset ShareKhan", "Mirae Asset Sharekhan"));
  assert(
    "SBI short brand token (3 chars)",
    orgVariantConfidence("SBI Cap Securities", "SBI Securities")
  );
  assert(
    "web-domain variant, punctuation-heavy",
    orgVariantConfidence("Strike Money Analytics and Indiacharts", "strike.money and indiacharts.com")
  );
  assert(
    "& vs and are equivalent connectors",
    orgVariantConfidence("Strike Money Analytics and Indiacharts", "Strike Money Analytics & Indiacharts")
  );
  assert("AMC vs MF brand token", orgVariantConfidence("Kotak AMC", "Kotak MF"));
  assert(
    "fund-house brand name vs formal AMC name",
    orgVariantConfidence("Tata Mutual Fund", "Tata Asset Management")
  );

  // Hard-law negatives — must NEVER match
  assert(
    "Independent never matches a named org",
    !orgVariantConfidence("Independent", "HDFC Securities")
  );
  assert(
    "Independent never matches even a plausible sibling",
    !orgVariantConfidence("Independent", "Strike Money Analytics and Indiacharts")
  );
  assert(
    "different unrelated firms, same person's name coincidence (Nilesh Shah landmine)",
    !orgVariantConfidence("Kotak AMC", "Envision Capital")
  );
  assert(
    "different unrelated firms, no shared token",
    !orgVariantConfidence("Morgan Stanley India", "Goldman Sachs India")
  );
  assert(
    "acronym expansion NOT attempted (documented limitation)",
    !orgVariantConfidence("ABSL AMC", "Aditya Birla Sun Life AMC")
  );
  assert("empty org never matches", !orgVariantConfidence("", "HDFC Securities"));

  // clusterOrgVariants — transitive bridging + correct singleton split
  const rohitOrgs = [
    "Independent",
    "Strike Money Analytics and Indiacharts",
    "Strike Money Analytics & Indiacharts",
    "strike.money and indiacharts.com",
  ];
  const rohitGroups = clusterOrgVariants(rohitOrgs).map((g) => g.sort((a, b) => a - b));
  assert("Rohit: 4 orgs split into exactly 2 components", rohitGroups.length === 2);
  assert(
    "Rohit: the 3 Strike/Indiacharts variants form one component",
    rohitGroups.some((g) => g.length === 3 && !g.includes(0))
  );
  assert(
    "Rohit: Independent is its own singleton component",
    rohitGroups.some((g) => g.length === 1 && g[0] === 0)
  );

  const nileshOrgs = ["Kotak AMC", "Kotak MF", "Envision Capital"];
  const nileshGroups = clusterOrgVariants(nileshOrgs).map((g) => g.sort((a, b) => a - b));
  assert("Nilesh Shah: 3 orgs split into exactly 2 components", nileshGroups.length === 2);
  assert(
    "Nilesh Shah: Kotak AMC + Kotak MF merge, Envision Capital stays isolated",
    nileshGroups.some((g) => g.length === 1 && g[0] === 2) &&
      nileshGroups.some((g) => g.length === 2 && g.includes(0) && g.includes(1))
  );

  // pickBestOrgString
  assert(
    "picks the longest/most complete variant",
    pickBestOrgString(["Geojit", "Geojit Investments", "Geojit Investments Limited"]) ===
      "Geojit Investments Limited"
  );

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

// ─── DB-backed clustering + planning ─────────────────────────────────────────────

type ExpertRow = {
  id: string;
  name: string;
  organization: string;
  verified: boolean;
  bio: string | null;
  avatarUrl: string | null;
  tipranksUrl: string | null;
  linkedinUrl: string | null;
  slug: string | null;
  createdAt: Date;
  opinionCount: number;
  followerCount: number;
};

type MergeGroupPlan = {
  canonical: ExpertRow;
  dupes: ExpertRow[];
  bestOrg: string;
  orgWillChange: boolean;
  fieldsToBackfill: Partial<Record<"bio" | "avatarUrl" | "tipranksUrl" | "linkedinUrl", string>>;
};

type ClusterReport = {
  normalizedName: string;
  memberCount: number;
  autoMergeGroups: Array<{
    canonicalId: string;
    canonicalLabel: string;
    currentOrg: string;
    newOrg: string;
    dupeIds: string[];
    dupeLabels: string[];
  }>;
  reviewMembers: Array<{ id: string; label: string }>;
};

const completenessScore = (e: Pick<ExpertRow, "bio" | "avatarUrl" | "tipranksUrl">) =>
  (e.bio ? 1 : 0) + (e.avatarUrl ? 1 : 0) + (e.tipranksUrl ? 1 : 0);

/** most opinions, tiebreak verified > has bio/avatar/tipranksUrl > oldest */
function pickCanonical(members: ExpertRow[]): ExpertRow {
  return [...members].sort((a, b) => {
    if (b.opinionCount !== a.opinionCount) return b.opinionCount - a.opinionCount;
    if (b.verified !== a.verified) return b.verified ? 1 : -1;
    const scoreDiff = completenessScore(b) - completenessScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0]!;
}

function label(e: ExpertRow): string {
  return `"${e.name || "(blank)"}" / "${e.organization}" [${e.id}] (${e.opinionCount} opinions${e.verified ? ", verified" : ""})`;
}

async function buildPlan(): Promise<{ groups: MergeGroupPlan[]; reports: ClusterReport[] }> {
  const experts = await prisma.expert.findMany({
    select: {
      id: true,
      name: true,
      organization: true,
      verified: true,
      bio: true,
      avatarUrl: true,
      tipranksUrl: true,
      linkedinUrl: true,
      slug: true,
      createdAt: true,
      _count: { select: { opinions: true, followers: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: ExpertRow[] = experts.map((e) => ({
    id: e.id,
    name: e.name,
    organization: e.organization,
    verified: e.verified,
    bio: e.bio,
    avatarUrl: e.avatarUrl,
    tipranksUrl: e.tipranksUrl,
    linkedinUrl: e.linkedinUrl,
    slug: e.slug,
    createdAt: e.createdAt,
    opinionCount: e._count.opinions,
    followerCount: e._count.followers,
  }));

  // Cluster pass 1: normalized name. Blank names carry no name signal and are
  // near-certainly unrelated source-attribution entities that happen to share an
  // empty string — never cluster them (see expertMatch.ts's blank-name guard).
  const byName = new Map<string, ExpertRow[]>();
  for (const row of rows) {
    const key = normalizeExpertName(row.name);
    if (!key) continue;
    const arr = byName.get(key) ?? [];
    arr.push(row);
    byName.set(key, arr);
  }

  const groups: MergeGroupPlan[] = [];
  const reports: ClusterReport[] = [];

  for (const [normalizedName, members] of byName) {
    if (members.length < 2) continue; // no possible dupe

    // Cluster pass 2: org-variant confidence within this name-group.
    const orgs = members.map((m) => m.organization);
    const components = clusterOrgVariants(orgs);

    const report: ClusterReport = {
      normalizedName,
      memberCount: members.length,
      autoMergeGroups: [],
      reviewMembers: [],
    };

    for (const component of components) {
      const componentMembers = component.map((i) => members[i]!);
      if (componentMembers.length < 2) {
        report.reviewMembers.push({ id: componentMembers[0]!.id, label: label(componentMembers[0]!) });
        continue;
      }

      const canonical = pickCanonical(componentMembers);
      const dupes = componentMembers.filter((m) => m.id !== canonical.id);
      const bestOrg = pickBestOrgString(componentMembers.map((m) => m.organization));

      const fieldsToBackfill: MergeGroupPlan["fieldsToBackfill"] = {};
      for (const field of ["bio", "avatarUrl", "tipranksUrl", "linkedinUrl"] as const) {
        if (!canonical[field]) {
          const donor = componentMembers.find((m) => m[field]);
          if (donor?.[field]) fieldsToBackfill[field] = donor[field]!;
        }
      }

      groups.push({
        canonical,
        dupes,
        bestOrg,
        orgWillChange: bestOrg !== canonical.organization,
        fieldsToBackfill,
      });

      report.autoMergeGroups.push({
        canonicalId: canonical.id,
        canonicalLabel: label(canonical),
        currentOrg: canonical.organization,
        newOrg: bestOrg,
        dupeIds: dupes.map((d) => d.id),
        dupeLabels: dupes.map((d) => label(d)),
      });
    }

    reports.push(report);
  }

  return { groups, reports };
}

// ─── Migration (per cluster transaction) ─────────────────────────────────────────

type GroupMigrationResult = {
  canonicalId: string;
  dupesMerged: number;
  opinionsMoved: number;
  opinionsCollided: number;
  followsMoved: number;
  followsCollided: number;
  portfolioReassigned: number;
  portfolioDeleted: number;
};

async function migrateGroup(client: PrismaClient, plan: MergeGroupPlan): Promise<GroupMigrationResult> {
  const result: GroupMigrationResult = {
    canonicalId: plan.canonical.id,
    dupesMerged: 0,
    opinionsMoved: 0,
    opinionsCollided: 0,
    followsMoved: 0,
    followsCollided: 0,
    portfolioReassigned: 0,
    portfolioDeleted: 0,
  };

  return client.$transaction(async (tx) => {
    // NOTE: the canonical org/field backfill (below) MUST run AFTER every dupe has
    // been deleted, not before. plan.bestOrg is frequently the EXACT organization
    // string of one of the dupes being merged away (e.g. canonical "Geojit
    // Investments" upgrading to dupe's "Geojit Investments Limited") — updating
    // canonical's org first would collide with @@unique([name, organization]) on
    // that still-live dupe row.

    // Canonical's existing (storyId, quoteHash) set — for collision detection below.
    const canonicalOpinions = await tx.expertOpinion.findMany({
      where: { expertId: plan.canonical.id },
      select: { storyId: true, quoteHash: true },
    });
    const canonicalOpinionKeys = new Set(
      canonicalOpinions.filter((o) => o.storyId !== null).map((o) => `${o.storyId}::${o.quoteHash}`)
    );

    // Canonical's existing followers — for ExpertFollow collision detection.
    const canonicalFollows = await tx.expertFollow.findMany({
      where: { expertId: plan.canonical.id },
      select: { userId: true },
    });
    const canonicalFollowerIds = new Set(canonicalFollows.map((f) => f.userId));

    // Canonical's existing SHADOW portfolio, if any.
    const canonicalPortfolio = await tx.portfolio.findFirst({
      where: { ownerExpertId: plan.canonical.id, kind: "SHADOW" },
      select: { id: true },
    });

    for (const dupe of plan.dupes) {
      // ── ExpertOpinion ──────────────────────────────────────────────────────
      const dupeOpinions = await tx.expertOpinion.findMany({
        where: { expertId: dupe.id },
        select: { id: true, storyId: true, quoteHash: true },
      });

      const toDelete: string[] = [];
      const toMove: string[] = [];
      for (const op of dupeOpinions) {
        const key = op.storyId !== null ? `${op.storyId}::${op.quoteHash}` : null;
        if (key && canonicalOpinionKeys.has(key)) {
          toDelete.push(op.id);
        } else {
          toMove.push(op.id);
          if (key) canonicalOpinionKeys.add(key); // avoid intra-batch collisions across dupes
        }
      }

      if (toDelete.length > 0) {
        await tx.expertOpinion.deleteMany({ where: { id: { in: toDelete } } });
        result.opinionsCollided += toDelete.length;
      }
      if (toMove.length > 0) {
        await tx.expertOpinion.updateMany({
          where: { id: { in: toMove } },
          data: { expertId: plan.canonical.id },
        });
        result.opinionsMoved += toMove.length;
      }

      // ── ExpertFollow ────────────────────────────────────────────────────────
      const dupeFollows = await tx.expertFollow.findMany({
        where: { expertId: dupe.id },
        select: { id: true, userId: true },
      });
      const followDelete: string[] = [];
      const followMove: string[] = [];
      for (const f of dupeFollows) {
        if (canonicalFollowerIds.has(f.userId)) {
          followDelete.push(f.id);
        } else {
          followMove.push(f.id);
          canonicalFollowerIds.add(f.userId);
        }
      }
      if (followDelete.length > 0) {
        await tx.expertFollow.deleteMany({ where: { id: { in: followDelete } } });
        result.followsCollided += followDelete.length;
      }
      if (followMove.length > 0) {
        await tx.expertFollow.updateMany({
          where: { id: { in: followMove } },
          data: { expertId: plan.canonical.id },
        });
        result.followsMoved += followMove.length;
      }

      // ── Portfolio (SHADOW) ──────────────────────────────────────────────────
      // ExpertOpinionVote is NOT touched here — it references opinionId/userId
      // only, never expertId, so votes move automatically with their opinion row.
      const dupePortfolio = await tx.portfolio.findFirst({
        where: { ownerExpertId: dupe.id, kind: "SHADOW" },
        select: { id: true },
      });
      if (dupePortfolio) {
        if (canonicalPortfolio) {
          // Both own a shadow portfolio — never hand-merge two independent
          // cash-simulated transaction histories. Delete the dupe's (cascades
          // its transactions/dailyValues); canonical's portfolio is fully
          // regenerated from its (now-merged) opinion set on the next
          // portfolios-shadow cron run — see shadowGenerator.ts.
          await tx.portfolio.delete({ where: { id: dupePortfolio.id } });
          result.portfolioDeleted++;
        } else {
          await tx.portfolio.update({
            where: { id: dupePortfolio.id },
            data: { ownerExpertId: plan.canonical.id },
          });
          result.portfolioReassigned++;
        }
      }

      // ── Delete the dupe Expert ──────────────────────────────────────────────
      // Must run last: ExpertOpinion.expert has no onDelete action (defaults to
      // RESTRICT), so this fails loudly if any opinion was somehow left behind —
      // a defensive backstop, not the primary correctness mechanism.
      await tx.expert.delete({ where: { id: dupe.id } });
      result.dupesMerged++;
    }

    // Canonical field backfill (org upgrade + missing bio/avatar/links) — now safe:
    // every dupe row that might hold the target org string is gone.
    const updateData: Record<string, string> = {};
    if (plan.orgWillChange) updateData.organization = plan.bestOrg;
    for (const [field, value] of Object.entries(plan.fieldsToBackfill)) {
      updateData[field] = value;
    }
    if (Object.keys(updateData).length > 0) {
      await tx.expert.update({ where: { id: plan.canonical.id }, data: updateData });
    }

    return result;
  });
}

// ─── Reporting ────────────────────────────────────────────────────────────────────

function printHumanReport(reports: ClusterReport[]): void {
  const withAutoMerge = reports.filter((r) => r.autoMergeGroups.length > 0);
  const reviewOnly = reports.filter((r) => r.autoMergeGroups.length === 0 && r.reviewMembers.length > 0);

  console.log("=".repeat(72));
  console.log("DUPLICATE EXPERT MERGE PLAN");
  console.log("=".repeat(72));
  console.log(`Name-clusters scanned (>=2 experts sharing a normalized name): ${reports.length}`);
  console.log(`  -> containing at least one AUTO-MERGE group: ${withAutoMerge.length}`);
  console.log(`  -> review-only (no confident org match at all):              ${reviewOnly.length}`);
  console.log();

  for (const r of withAutoMerge) {
    console.log(`\n[${r.normalizedName}]  (${r.memberCount} experts)`);
    for (const g of r.autoMergeGroups) {
      console.log(`  AUTO-MERGE -> canonical ${g.canonicalLabel}`);
      if (g.currentOrg !== g.newOrg) {
        console.log(`    org upgrade: "${g.currentOrg}" -> "${g.newOrg}"`);
      }
      for (const d of g.dupeLabels) {
        console.log(`    - merge & delete: ${d}`);
      }
    }
    if (r.reviewMembers.length > 0) {
      console.log(`  REVIEW (not merged, same name, no confident org match):`);
      for (const m of r.reviewMembers) console.log(`    - ${m.label}`);
    }
  }

  if (reviewOnly.length > 0) {
    console.log(`\n${"-".repeat(72)}`);
    console.log("REVIEW-ONLY CLUSTERS (same name, NO confident org match among any members)");
    console.log("-".repeat(72));
    for (const r of reviewOnly) {
      console.log(`\n[${r.normalizedName}]`);
      for (const m of r.reviewMembers) console.log(`  - ${m.label}`);
    }
  }

  const totalAutoMergeGroups = reports.reduce((n, r) => n + r.autoMergeGroups.length, 0);
  const totalDupes = reports.reduce(
    (n, r) => n + r.autoMergeGroups.reduce((m, g) => m + g.dupeIds.length, 0),
    0
  );
  const totalReview = reports.reduce((n, r) => n + r.reviewMembers.length, 0);

  console.log(`\n${"=".repeat(72)}`);
  console.log("SUMMARY");
  console.log("=".repeat(72));
  console.log(`Auto-merge groups:        ${totalAutoMergeGroups}`);
  console.log(`Experts to be merged away: ${totalDupes}`);
  console.log(`Experts routed to review: ${totalReview}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────────

async function main() {
  if (SELFTEST) {
    selftest();
    return;
  }

  console.log(`Mode: ${EXECUTE ? "EXECUTE (writing to DB)" : "DRY RUN (no writes)"}\n`);

  const { groups, reports } = await buildPlan();

  if (!JSON_ONLY) {
    printHumanReport(reports);
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log("JSON REPORT");
  console.log("=".repeat(72));
  console.log(
    JSON.stringify(
      {
        mode: EXECUTE ? "execute" : "dry-run",
        clusterCount: reports.length,
        autoMergeGroupCount: groups.length,
        clusters: reports,
      },
      null,
      2
    )
  );

  if (!EXECUTE) {
    console.log(`\nDRY RUN — nothing written. Re-run with --execute to perform the ${groups.length} merge(s) above.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\nExecuting ${groups.length} merge group(s)...\n`);
  let totalOpinionsMoved = 0;
  let totalOpinionsCollided = 0;
  let totalFollowsMoved = 0;
  let totalFollowsCollided = 0;
  let totalPortfolioReassigned = 0;
  let totalPortfolioDeleted = 0;
  let totalDupesMerged = 0;
  let failures = 0;

  for (const plan of groups) {
    try {
      const r = await migrateGroup(prisma, plan);
      totalOpinionsMoved += r.opinionsMoved;
      totalOpinionsCollided += r.opinionsCollided;
      totalFollowsMoved += r.followsMoved;
      totalFollowsCollided += r.followsCollided;
      totalPortfolioReassigned += r.portfolioReassigned;
      totalPortfolioDeleted += r.portfolioDeleted;
      totalDupesMerged += r.dupesMerged;
      console.log(
        `  OK canonical=${plan.canonical.id} merged=${r.dupesMerged} opinions(moved=${r.opinionsMoved},collided=${r.opinionsCollided}) follows(moved=${r.followsMoved},collided=${r.followsCollided}) portfolio(reassigned=${r.portfolioReassigned},deleted=${r.portfolioDeleted})`
      );
    } catch (err) {
      failures++;
      console.error(
        `  FAILED canonical=${plan.canonical.id}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log("EXECUTION SUMMARY");
  console.log("=".repeat(72));
  console.log(`Groups processed successfully: ${groups.length - failures}`);
  console.log(`Groups failed:                 ${failures}`);
  console.log(`Experts merged & deleted:      ${totalDupesMerged}`);
  console.log(`Opinions moved:                ${totalOpinionsMoved}`);
  console.log(`Opinions deleted (collisions): ${totalOpinionsCollided}`);
  console.log(`Follows moved:                 ${totalFollowsMoved}`);
  console.log(`Follows deleted (collisions):  ${totalFollowsCollided}`);
  console.log(`Portfolios reassigned:         ${totalPortfolioReassigned}`);
  console.log(`Portfolios deleted (regen):    ${totalPortfolioDeleted}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
