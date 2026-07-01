import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { getDisplayName } from "@/lib/users/displayName";
import styles from "./page.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfilePageProps {
  params: { username: string };
}

interface RecentCall {
  marketId: string;
  marketTitle: string;
  side: string;
  reasoning: string | null;
  reasoningUpvotes: number;
  createdAt: Date;
  marketStatus: string;
  outcome: string | null;
}

interface CategoryStat {
  category: string;
  accuracyScore: number;
  totalPredictions: number;
}

// Render on-demand (per request). This page reads live per-user data from the DB,
// so it must NOT be statically prerendered at build time — otherwise `next build`
// tries to hit the database with no connection available (breaks Docker/CI builds).
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Metadata (og: / twitter: head tags)
// ---------------------------------------------------------------------------

export async function generateMetadata(
  { params }: ProfilePageProps
): Promise<Metadata> {
  const username = decodeURIComponent(params.username);

  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayMode: true,
      isVerifiedAnalyst: true,
      accuracyScore: true,
      analystTier: true,
      stats: {
        select: {
          totalPredictions: true,
          accuracyScore: true,
        },
      },
    },
  });

  if (!user) {
    return { title: "Profile not found — Predict Future" };
  }

  const displayName = getDisplayName(user);
  const accuracy = user.stats?.accuracyScore ?? user.accuracyScore;
  const totalPredictions = user.stats?.totalPredictions ?? 0;
  // Fetch first recent call's reasoning for og:description override
  const firstReasoningPosition = await prisma.marketPosition.findFirst({
    where: {
      userId: user.id,
      reasoning: { not: null },
      market: {
        visibility: "PUBLIC",
        status: { notIn: ["DRAFT", "PENDING_REVIEW", "REJECTED"] },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { reasoning: true },
  });
  const firstReasoning = firstReasoningPosition?.reasoning ?? null;

  const accuracyPct = accuracy.toFixed(1);

  const tierLabel: Record<string, string> = {
    ANALYST: "Analyst",
    SENIOR_ANALYST: "Senior Analyst",
    CHIEF_ANALYST: "Chief Analyst",
  };
  const tierDesc = user.analystTier && user.analystTier !== "ROOKIE"
    ? `${tierLabel[user.analystTier] ?? user.analystTier} — `
    : "";

  // Use the real username in the URL (anonymity affects display, not discoverability).
  // Use the display name in the title/description so anonymous users are not exposed.
  const title = `${displayName}'s Analyst Profile — Predict Future`;
  const defaultDescription = `${displayName} — ${tierDesc}${totalPredictions} predictions, ${accuracyPct}% accuracy on Predict Future — India's Analyst Scorecard.`;
  const description = firstReasoning
    ? firstReasoning.slice(0, 155)
    : defaultDescription;
  const url = `https://predictfuture.app/profile/${user.username}`;

  return {
    title,
    description,
    openGraph: {
      type: "profile",
      title,
      description,
      url,
      siteName: "Predict Future",
      images: [
        {
          url: "https://predictfuture.app/og-default-banner.png",
          width: 1200,
          height: 630,
          alt: `${displayName} on Predict Future`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["https://predictfuture.app/og-default-banner.png"],
    },
  };
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchProfileData(username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayMode: true,
      isVerifiedAnalyst: true,
      accuracyScore: true,
      createdAt: true,
      stats: {
        select: {
          totalPredictions: true,
          bestStreak: true,
          accuracyScore: true,
        },
      },
      categoryStats: {
        select: {
          category: true,
          accuracyScore: true,
          totalPredictions: true,
        },
        orderBy: { accuracyScore: "desc" },
        take: 3,
      },
      _count: {
        select: { followers: true },
      },
    },
  });

  if (!user) return null;

  // Fetch recent calls: positions on public markets, preferring those with reasoning.
  const recentPositionsWithReasoning = await prisma.marketPosition.findMany({
    where: {
      userId: user.id,
      reasoning: { not: null },
      market: {
        visibility: "PUBLIC",
        status: { notIn: ["DRAFT", "PENDING_REVIEW", "REJECTED"] },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      side: true,
      reasoning: true,
      reasoningUpvotes: true,
      createdAt: true,
      market: {
        select: {
          id: true,
          title: true,
          status: true,
          outcome: true,
        },
      },
    },
  });

  let recentCallsRaw = recentPositionsWithReasoning;
  if (recentCallsRaw.length < 5) {
    const existingIds = new Set(recentCallsRaw.map((p) => p.id));
    const fallback = await prisma.marketPosition.findMany({
      where: {
        userId: user.id,
        id: { notIn: Array.from(existingIds) },
        market: {
          visibility: "PUBLIC",
          status: { notIn: ["DRAFT", "PENDING_REVIEW", "REJECTED"] },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 5 - recentCallsRaw.length,
      select: {
        id: true,
        side: true,
        reasoning: true,
        reasoningUpvotes: true,
        createdAt: true,
        market: {
          select: {
            id: true,
            title: true,
            status: true,
            outcome: true,
          },
        },
      },
    });
    recentCallsRaw = [...recentCallsRaw, ...fallback]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5);
  }

  const recentCalls: RecentCall[] = recentCallsRaw.map((p) => ({
    marketId: p.market.id,
    marketTitle: p.market.title,
    side: p.side ?? "UNKNOWN",
    reasoning: p.reasoning,
    reasoningUpvotes: p.reasoningUpvotes,
    createdAt: p.createdAt,
    marketStatus: p.market.status,
    outcome: p.market.outcome === "UNRESOLVED" ? null : p.market.outcome,
  }));

  const categoryStats: CategoryStat[] = user.categoryStats.map((cs) => ({
    category: cs.category,
    accuracyScore: cs.accuracyScore,
    totalPredictions: cs.totalPredictions,
  }));

  return {
    id: user.id,
    username: user.username, // real username — used for URLs/deep links
    displayName: getDisplayName(user), // public-facing name (pseudonym when ANONYMOUS)
    displayMode: user.displayMode,
    isVerifiedAnalyst: user.isVerifiedAnalyst,
    accuracyScore: user.stats?.accuracyScore ?? user.accuracyScore,
    totalPredictions: user.stats?.totalPredictions ?? 0,
    bestStreak: user.stats?.bestStreak ?? 0,
    followerCount: user._count.followers,
    createdAt: user.createdAt,
    recentCalls,
    categoryStats,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "YES": return "YES";
    case "NO": return "NO";
    case "CANCELLED": return "Cancelled";
    default: return outcome;
  }
}

function outcomeColorClass(outcome: string): string {
  switch (outcome) {
    case "YES": return styles.chipYes;
    case "NO": return styles.chipNo;
    case "CANCELLED": return styles.chipCancelled;
    default: return styles.chipDefault;
  }
}

function sideColorClass(side: string): string {
  switch (side) {
    case "YES": return styles.chipYes;
    case "NO": return styles.chipNo;
    default: return styles.chipDefault;
  }
}

function formatCategory(category: string): string {
  return category.charAt(0) + category.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function PublicProfilePage({ params }: ProfilePageProps) {
  const username = decodeURIComponent(params.username);
  const profile = await fetchProfileData(username);

  if (!profile) {
    notFound();
  }

  const accuracyPct = profile.accuracyScore.toFixed(1);

  return (
    <div className={styles.page}>
      {/* ------------------------------------------------------------------ */}
      {/* Header */}
      {/* ------------------------------------------------------------------ */}
      <header className={styles.header}>
        <div className={styles.usernameRow}>
          {/* Use displayName — shows pseudonym for ANONYMOUS users. Real username is never rendered publicly. */}
          <h1 className={styles.username}>@{profile.displayName}</h1>
          {profile.isVerifiedAnalyst && (
            <span className={styles.verifiedBadge} title="Verified Analyst">
              ✓ Verified Analyst
            </span>
          )}
        </div>
        <p className={styles.joinedAt}>
          Analyst since {formatDate(profile.createdAt)}
        </p>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Stats strip */}
      {/* ------------------------------------------------------------------ */}
      <section className={styles.statsStrip}>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{accuracyPct}%</span>
          <span className={styles.statLabel}>Accuracy</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <span className={styles.statValue}>{profile.totalPredictions}</span>
          <span className={styles.statLabel}>Predictions</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <span className={styles.statValue}>{profile.bestStreak}</span>
          <span className={styles.statLabel}>Best Streak</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <span className={styles.statValue}>{profile.followerCount}</span>
          <span className={styles.statLabel}>Followers</span>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Recent Calls (S30-T3) — positions with optional reasoning */}
      {/* ------------------------------------------------------------------ */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Calls</h2>
        {profile.recentCalls.length === 0 ? (
          <p className={styles.emptyState}>No public calls yet.</p>
        ) : (
          <ul className={styles.marketList}>
            {profile.recentCalls.map((call) => (
              <li key={`${call.marketId}-${call.createdAt.toISOString()}`} className={styles.marketRow}>
                <div className={styles.marketInfo}>
                  <p className={styles.marketTitle}>{call.marketTitle}</p>
                  {call.reasoning && (
                    <p className={styles.marketReasoning}>
                      &ldquo;{call.reasoning.length > 200 ? `${call.reasoning.slice(0, 200)}...` : call.reasoning}&rdquo;
                    </p>
                  )}
                  <p className={styles.marketDate}>{formatDate(call.createdAt)}</p>
                </div>
                <div className={styles.marketMeta}>
                  <span className={`${styles.chip} ${sideColorClass(call.side)}`}>
                    {call.side}
                  </span>
                  {call.outcome && (
                    <span className={`${styles.callChip} ${outcomeColorClass(call.outcome)}`}>
                      {outcomeLabel(call.outcome)}
                    </span>
                  )}
                  {call.reasoningUpvotes > 0 && (
                    <span className={styles.upvoteChip}>
                      {`👍 ${call.reasoningUpvotes}`}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Top categories */}
      {/* ------------------------------------------------------------------ */}
      {profile.categoryStats.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Top Categories</h2>
          <ul className={styles.categoryList}>
            {profile.categoryStats.map((cs) => (
              <li key={cs.category} className={styles.categoryRow}>
                <span className={styles.categoryName}>{formatCategory(cs.category)}</span>
                <span className={styles.categoryAccuracy}>
                  {cs.accuracyScore.toFixed(1)}%
                </span>
                <span className={styles.categoryPredictions}>
                  {cs.totalPredictions} calls
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* CTA */}
      {/* ------------------------------------------------------------------ */}
      <section className={styles.ctaSection}>
        <p className={styles.ctaText}>
          Follow <strong>@{profile.displayName}</strong> on Predict Future
        </p>
        <p className={styles.ctaSubtext}>
          India&apos;s Analyst Scorecard — make predictions, build your track record.
        </p>
        <div className={styles.ctaButtons}>
          <a
            href="https://apps.apple.com/in/app/predict-future/id123456789"
            className={styles.ctaButton}
            target="_blank"
            rel="noopener noreferrer"
          >
            Download on App Store
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=com.predictfuture"
            className={`${styles.ctaButton} ${styles.ctaButtonSecondary}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get it on Google Play
          </a>
        </div>
        <a
          href={`predictfuture://user/${profile.username}`}
          className={styles.deepLink}
        >
          Open in Predict Future app
        </a>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Footer */}
      {/* ------------------------------------------------------------------ */}
      <footer className={styles.footer}>
        <a href="https://predictfuture.app" className={styles.footerLink}>
          predictfuture.app
        </a>
      </footer>
    </div>
  );
}
