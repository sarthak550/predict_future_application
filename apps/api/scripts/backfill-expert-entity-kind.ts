/**
 * One-time classification pass for Expert.entityKind (round-2 dedup work, 2026-08-08).
 *
 * Expert.entityKind defaults to HUMAN (additive migration — see prisma/schema.prisma),
 * so every pre-existing row starts out HUMAN regardless of its actual class. This
 * script runs the classifier (lib/finance/expertEntityKind.ts#classifyExpertEntityKind)
 * against every existing Expert, using its REAL opinion history (the
 * isSourceAttribution ratio across all its ExpertOpinion rows) as an extra signal a
 * brand-new row doesn't have yet — see expertMatch.ts, which classifies at CREATE
 * time using only the single triggering opinion's isSourceAttribution flag.
 *
 * Prints the full FIRM list for orchestrator/founder review before prod execution
 * ("I'll eyeball it — the list should be small, ~dozens" — founder brief). Dry run
 * by default; only --execute writes.
 *
 * Idempotent: reclassifying an already-correctly-classified row is a no-op update
 * (Prisma still issues the UPDATE, but the value doesn't change) — safe to re-run.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/backfill-expert-entity-kind.ts              # dry run, prints the plan
 *   npx tsx scripts/backfill-expert-entity-kind.ts --execute    # writes entityKind
 *   npx tsx scripts/backfill-expert-entity-kind.ts --selftest   # classifier unit fixtures, no DB
 *
 * NEVER run --execute against prod from a dev sandbox — orchestrator's step, after
 * reviewing the printed FIRM list.
 */

import { classifyExpertEntityKind } from "../lib/finance/expertEntityKind";
import { prisma } from "../lib/prisma";

const EXECUTE = process.argv.includes("--execute");
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

  console.log("Running backfill-expert-entity-kind selftest (classifyExpertEntityKind)...\n");

  // ── The founder's reported bug, both shapes ──────────────────────────────────
  assert(
    "'JM Financial Analysis' / org 'JM Financial' -> FIRM (standard source-attribution naming)",
    classifyExpertEntityKind("JM Financial Analysis", "JM Financial") === "FIRM"
  );
  assert(
    "bare 'JM Financial' / org 'JM Financial' -> FIRM (org-as-analyst extraction quirk, no 'Analysis' suffix)",
    classifyExpertEntityKind("JM Financial", "JM Financial") === "FIRM"
  );

  // ── Real dev-DB "X Analysis" rows ────────────────────────────────────────────
  for (const [name, org] of [
    ["ETMarkets Analysis", "ETMarkets"],
    ["Macquarie Analysis", "Macquarie"],
    ["Independent Analysis", "Independent"],
    ["Publication Analysis", "Publication"],
    ["Nuvama Research Analysis", "Nuvama Research"],
  ] as const) {
    assert(`'${name}' / org '${org}' -> FIRM`, classifyExpertEntityKind(name, org) === "FIRM");
  }

  // ── Real dev-DB bare org-as-name rows (no "Analysis" suffix) ─────────────────
  for (const [name, org] of [
    ["JP Morgan", "JP Morgan"],
    ["Equirus", "Equirus"],
    ["Goldman Sachs", "Goldman Sachs"],
  ] as const) {
    assert(`bare '${name}' / org '${org}' -> FIRM`, classifyExpertEntityKind(name, org) === "FIRM");
  }

  // ── isSourceAttribution / ratio signals ──────────────────────────────────────
  assert(
    "isSourceAttribution=true on the triggering opinion -> FIRM even with a person-shaped name",
    classifyExpertEntityKind("Ambiguous Name", "Some Publication", { isSourceAttribution: true }) === "FIRM"
  );
  assert(
    "majority source-attribution history (ratio >= 0.6) -> FIRM",
    classifyExpertEntityKind("Ambiguous Name", "Some Publication", { sourceAttributionRatio: 0.75 }) === "FIRM"
  );
  assert(
    "minority source-attribution history (ratio < 0.6) does NOT force FIRM on its own",
    classifyExpertEntityKind("Rahul Shah", "Motilal Oswal Financial Services", { sourceAttributionRatio: 0.2 }) ===
      "HUMAN"
  );

  // ── Firm-vocabulary + acronym-shape signals ──────────────────────────────────
  assert(
    "name containing firm vocabulary ('Securities') -> FIRM",
    classifyExpertEntityKind("XYZ Securities", "Some Unrelated Org") === "FIRM"
  );
  assert("bare all-caps acronym name -> FIRM", classifyExpertEntityKind("MOFSL", "Motilal Oswal") === "FIRM");
  assert("bare all-caps acronym name (SBI) -> FIRM", classifyExpertEntityKind("SBI", "SBI Mutual Fund") === "FIRM");

  // ── Real human analysts — must NEVER misclassify (the insulting failure mode) ─
  for (const [name, org] of [
    ["Rahul Shah", "Motilal Oswal Financial Services"],
    ["Siddhartha Khemka", "MOSL"],
    ["Sandip Sabharwal", "Independent"],
    ["Nilesh Shah", "Kotak AMC"],
    ["Rohit Srivastava", "Strike Money Analytics and Indiacharts"],
    ["Sudip Bandyopadhyay", "Inditrade Capital"],
    ["CA Rudramurthy BV", "Vachana Investments"],
  ] as const) {
    assert(`real human '${name}' / org '${org}' -> HUMAN`, classifyExpertEntityKind(name, org) === "HUMAN");
  }

  // ── Founder-eponymous boutique firms — real false positives caught during
  // real dev-DB validation (rule 3 originally used the full org-variant test,
  // which shares a surname/brand token between a person and THEIR OWN firm) ────
  for (const [name, org] of [
    ["Sandip Sabharwal", "asksandipsabharwal.com"],
    ["Ed Yardeni", "Yardeni Research"],
    ["Anshul Saigal", "Saigal Capital"],
    ["Mark Mobius", "Mobius Emerging Opportunities Fund"],
    ["Ajay Kedia", "Kedia Commodities"],
    ["Puneet Dalmia", "Dalmia Bharat"],
  ] as const) {
    assert(
      `founder-eponymous firm: '${name}' / org '${org}' -> HUMAN (not an exact name===org match)`,
      classifyExpertEntityKind(name, org) === "HUMAN"
    );
  }

  // ── Blank-name edge (founder-reported prod bug, 2026-08-08: 7 legacy Expert
  // rows created with empty name strings — fixed on prod by converting them to
  // FIRM rows named by their org) ───────────────────────────────────────────
  assert(
    "blank name + org present -> FIRM (attribute to the org, never a blank-named HUMAN)",
    classifyExpertEntityKind("", "Goldman Sachs India") === "FIRM"
  );
  assert(
    "blank name + blank org -> HUMAN (last-resort fallback; callers must reject this shape before classification — see expertMatch.ts's blank-blank guard)",
    classifyExpertEntityKind("", "") === "HUMAN"
  );

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

// ─── DB-backed backfill ───────────────────────────────────────────────────────────

async function main() {
  if (SELFTEST) {
    selftest();
    return;
  }

  console.log(`Mode: ${EXECUTE ? "EXECUTE (writing to DB)" : "DRY RUN (no writes)"}\n`);

  const experts = await prisma.expert.findMany({
    select: {
      id: true,
      name: true,
      organization: true,
      entityKind: true,
      opinions: { select: { isSourceAttribution: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const changes: Array<{ id: string; name: string; organization: string; from: string; to: "HUMAN" | "FIRM" }> = [];

  for (const e of experts) {
    const total = e.opinions.length;
    const sourceAttributionRatio = total > 0 ? e.opinions.filter((o) => o.isSourceAttribution).length / total : undefined;
    const classified = classifyExpertEntityKind(e.name, e.organization, { sourceAttributionRatio });
    if (classified !== e.entityKind) {
      changes.push({ id: e.id, name: e.name, organization: e.organization, from: e.entityKind, to: classified });
    }
  }

  const toFirm = changes.filter((c) => c.to === "FIRM");
  const toHuman = changes.filter((c) => c.to === "HUMAN");

  console.log("=".repeat(72));
  console.log("ENTITY-KIND BACKFILL PLAN");
  console.log("=".repeat(72));
  console.log(`Total experts scanned:        ${experts.length}`);
  console.log(`Reclassify HUMAN -> FIRM:     ${toFirm.length}`);
  console.log(`Reclassify FIRM -> HUMAN:     ${toHuman.length} (should be 0 on a first run — all rows start HUMAN)`);
  console.log();

  if (toFirm.length > 0) {
    console.log(`${"-".repeat(72)}`);
    console.log(`FIRM LIST (for founder review — should be small, ~dozens)`);
    console.log("-".repeat(72));
    for (const c of toFirm) {
      console.log(`  "${c.name}" / "${c.organization}"  [${c.id}]`);
    }
  }

  if (toHuman.length > 0) {
    console.log(`\n${"-".repeat(72)}`);
    console.log(`UNEXPECTED: FIRM -> HUMAN reclassifications`);
    console.log("-".repeat(72));
    for (const c of toHuman) {
      console.log(`  "${c.name}" / "${c.organization}"  [${c.id}]`);
    }
  }

  if (!EXECUTE) {
    console.log(`\nDRY RUN — nothing written. Re-run with --execute to apply the ${changes.length} change(s) above.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying ${changes.length} change(s)...`);
  let updated = 0;
  for (const c of changes) {
    await prisma.expert.update({ where: { id: c.id }, data: { entityKind: c.to } });
    updated++;
  }
  console.log(`Done. ${updated} expert(s) updated.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
