import { NextResponse } from "next/server";

import {
  extractExpertOpinionsFromStory,
  hasPlausibleAnalystSignal,
  isApprovedFinanceSource,
  persistExpertOpinions,
} from "@/lib/ai/extractExpertOpinions";
import { fetchArticleBody } from "@/lib/news/articleBody";
import { prisma } from "@/lib/prisma";

function hasCronAccess(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

// Drain backlog of FINANCE stories from approved analyst-opinion domains that
// were never extracted (missed by the per-batch limit in the ingestion run).
// S74-T2: bumped 50 -> 120 to match the widened S74-T1 domain-only extraction gate.
const CATCHUP_BATCH_SIZE = 120;
const LOOKBACK_DAYS = 14;

async function runCatchup() {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!groqKey && !geminiKey) {
    return { ok: false, error: "No AI key configured", processed: 0, extracted: 0 };
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // Pull a wider candidate set, then filter in-memory to the approved analyst
  // domain allowlist. Prisma can't easily express the domain-suffix matching that
  // isApprovedFinanceSource encodes, so we over-fetch and filter.
  // S74-T2: over-fetch bumped 300 -> 600 to keep the larger CATCHUP_BATCH_SIZE full
  // under the widened S74-T1 domain-only gate.
  const candidates = await prisma.story.findMany({
    where: {
      category: "FINANCE",
      expertOpinions: { none: {} },
      createdAt: { gte: since },
      bodyFetchFailed: { not: true },
    },
    select: {
      id: true,
      headline: true,
      summary: true,
      sourceUrl: true,
      publishedAt: true,
      bodyText: true,
      bodyFetchFailed: true,
    },
    orderBy: { publishedAt: "desc" },
    take: 600,
  });

  const approved = candidates.filter((s) => isApprovedFinanceSource(s.sourceUrl));

  // S74-T2 throughput guardrail: same cheap headline+summary pre-filter as the inline
  // ingestion path, applied here BEFORE slicing to CATCHUP_BATCH_SIZE so we don't burn
  // AI calls (or backlog slots) on candidates with no plausible analyst signal.
  const preFiltered = approved.filter((s) => hasPlausibleAnalystSignal(s.headline, s.summary));
  const preFilterSkipped = approved.length - preFiltered.length;
  const batch = preFiltered.slice(0, CATCHUP_BATCH_SIZE);

  let extracted = 0;
  let opinionsTotal = 0;
  const errors: string[] = [];

  for (const story of batch) {
    try {
      let content: string;
      if (story.bodyText && story.bodyText.length >= 200) {
        content = story.bodyText;
      } else {
        const body = await fetchArticleBody(story.sourceUrl);
        if (body.text) {
          await prisma.story.update({
            where: { id: story.id },
            data: { bodyText: body.text, bodyFetchedAt: new Date(), bodyFetchFailed: false },
          });
          content = body.text;
        } else {
          await prisma.story.update({
            where: { id: story.id },
            data: { bodyFetchFailed: true, bodyFetchedAt: new Date() },
          });
          content = `${story.headline}\n\n${story.summary}`;
        }
      }

      const opinions = await extractExpertOpinionsFromStory({
        id: story.id,
        title: story.headline,
        content,
        sourceUrl: story.sourceUrl,
        publishedAt: story.publishedAt,
      });

      if (opinions.length > 0) {
        await persistExpertOpinions(prisma, story.id, story.sourceUrl, story.publishedAt, opinions);
        extracted++;
        opinionsTotal += opinions.length;
      }
    } catch (err) {
      errors.push(`${story.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.info(
    `[finance-opinions-catchup] done -- ${extracted} stories yielded opinions from ${batch.length} attempted (${preFilterSkipped} skipped by pre-filter of ${approved.length} approved-domain candidates)`
  );

  return {
    ok: true,
    backlogTotal: approved.length,
    processed: batch.length,
    storiesWithOpinions: extracted,
    opinionsExtracted: opinionsTotal,
    errors: errors.slice(0, 5),
  };
}

export async function POST(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await runCatchup();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[finance-opinions-catchup] failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Catchup failed." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
