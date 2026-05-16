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

interface ResolvedMarket {
  id: string;
  title: string;
  outcome: string;
  resolveAt: Date;
  userSide: string | null;
}

interface CategoryStat {
  category: string;
  accuracyScore: number;
  totalPredictions: number;
}

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
  const accuracyPct = accuracy.toFixed(1);

  // Use the real username in the URL (anonymity affects display, not discoverability).
  // Use the display name in the title/description so anonymous users are not exposed.
  const title = `${displayName}'s Analyst Profile — Predict Future`;
  const description = `${displayName} has made ${totalPredictions} predictions with ${accuracyPct}% accuracy on Predict Future — India's Analyst Scorecard.`;
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

  // Fetch last 5 finalized markets created by this user, with the user's
  // position on each market for the "your call" column.
  const recentMarkets = await prisma.market.findMany({
    where: {
      creatorId: user.id,
      resolutionStatus: "FINALIZED",
    },
    orderBy: { resolveAt: "desc" },
    take: 5,
    select: {
      id: true,
      title: true,
      outcome: true,
      resolveAt: true,
      positions: {
        where: { userId: user.id },
        select: { side: true },
        take: 1,
      },
    },
  });

  const resolvedMarkets: ResolvedMarket[] = recentMarkets.map((m) => ({
    id: m.id,
    title: m.title,
    outcome: m.outcome,
    resolveAt: m.resolveAt,
    userSide: m.positions[0]?.side ?? null,
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
    resolvedMarkets,
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

function callColorClass(side: string | null, outcome: string): string {
  if (!side) return "";
  const correct = side === outcome;
  return correct ? styles.callCorrect : styles.callWrong;
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
      {/* Recent resolved markets */}
      {/* ------------------------------------------------------------------ */}
      {profile.resolvedMarkets.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Recent Calls</h2>
          <ul className={styles.marketList}>
            {profile.resolvedMarkets.map((market) => (
              <li key={market.id} className={styles.marketRow}>
                <div className={styles.marketInfo}>
                  <p className={styles.marketTitle}>{market.title}</p>
                  <p className={styles.marketDate}>{formatDate(market.resolveAt)}</p>
                </div>
                <div className={styles.marketMeta}>
                  <span className={`${styles.chip} ${outcomeColorClass(market.outcome)}`}>
                    {outcomeLabel(market.outcome)}
                  </span>
                  {market.userSide && (
                    <span className={`${styles.callChip} ${callColorClass(market.userSide, market.outcome)}`}>
                      Called {market.userSide}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

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
