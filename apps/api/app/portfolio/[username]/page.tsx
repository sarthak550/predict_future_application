import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import styles from "./page.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortfolioPageProps {
  params: { username: string };
}

interface ResolvedMarketRow {
  id: string;
  title: string;
  outcome: string;
  resolvedAt: Date;
  userCall: { side: string; amount: number } | null;
}

interface OpenMarketRow {
  id: string;
  title: string;
  userCall: { side: string; amount: number } | null;
}

// Render on-demand (per request). This page reads live per-user data from the DB,
// so it must NOT be statically prerendered at build time — otherwise `next build`
// tries to hit the database with no connection available (breaks Docker/CI builds).
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Metadata (og: / twitter: head tags)
// ---------------------------------------------------------------------------

export async function generateMetadata(
  { params }: PortfolioPageProps
): Promise<Metadata> {
  const username = decodeURIComponent(params.username);

  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      username: true,
      isVerifiedAnalyst: true,
      stats: {
        select: {
          accuracyScore: true,
          totalPredictions: true,
          totalNetPoints: true,
        },
      },
    },
  });

  if (!user) {
    return { title: "Portfolio not found — Predict Future" };
  }

  const accuracy = (user.stats?.accuracyScore ?? 0).toFixed(1);
  const totalPredictions = user.stats?.totalPredictions ?? 0;
  const totalNetPoints = user.stats?.totalNetPoints ?? 0;

  const title = `${user.username} Portfolio — Predict Future`;
  const description = `${user.username}: ${accuracy}% accuracy · ${totalPredictions} calls · ${totalNetPoints} net pts`;
  const url = `https://predictfuture.app/portfolio/${user.username}`;

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
          alt: `${user.username}'s portfolio on Predict Future`,
        },
      ],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: ["https://predictfuture.app/og-default-banner.png"],
    },
  };
}

// ---------------------------------------------------------------------------
// Data fetching (called directly — no fetch-to-self)
// ---------------------------------------------------------------------------

async function fetchPortfolioData(username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      isVerifiedAnalyst: true,
      // Intentionally omit: email, phone, referralCode, wallet
      stats: {
        select: {
          accuracyScore: true,
          totalPredictions: true,
          totalNetPoints: true,
          bestStreak: true,
        },
      },
      _count: {
        select: { followers: true },
      },
    },
  });

  if (!user) return null;

  // Last 5 FINALIZED markets created by this user, with their own position.
  const recentResolved = await prisma.market.findMany({
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
        select: { side: true, amount: true },
        take: 1,
      },
    },
  });

  // Top 5 OPEN markets created by this user, with their own position.
  const openMarkets = await prisma.market.findMany({
    where: {
      creatorId: user.id,
      status: "OPEN",
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      title: true,
      positions: {
        where: { userId: user.id },
        select: { side: true, amount: true },
        take: 1,
      },
    },
  });

  const resolvedMarkets: ResolvedMarketRow[] = recentResolved.map((m) => ({
    id: m.id,
    title: m.title,
    outcome: m.outcome,
    resolvedAt: m.resolveAt,
    userCall:
      m.positions[0] != null
        ? { side: m.positions[0].side ?? "?", amount: m.positions[0].amount }
        : null,
  }));

  const openList: OpenMarketRow[] = openMarkets.map((m) => ({
    id: m.id,
    title: m.title,
    userCall:
      m.positions[0] != null
        ? { side: m.positions[0].side ?? "?", amount: m.positions[0].amount }
        : null,
  }));

  return {
    username: user.username,
    isVerifiedAnalyst: user.isVerifiedAnalyst,
    accuracyScore: user.stats?.accuracyScore ?? 0,
    totalPredictions: user.stats?.totalPredictions ?? 0,
    totalNetPoints: user.stats?.totalNetPoints ?? 0,
    bestStreak: user.stats?.bestStreak ?? 0,
    followerCount: user._count.followers,
    resolvedMarkets,
    openList,
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
    case "YES":
      return "YES";
    case "NO":
      return "NO";
    case "CANCELLED":
      return "Cancelled";
    default:
      return outcome;
  }
}

function outcomeColorClass(outcome: string): string {
  switch (outcome) {
    case "YES":
      return styles.chipYes;
    case "NO":
      return styles.chipNo;
    case "CANCELLED":
      return styles.chipCancelled;
    default:
      return styles.chipDefault;
  }
}

function callColorClass(side: string, outcome: string): string {
  const correct = side === outcome;
  return correct ? styles.callCorrect : styles.callWrong;
}

function formatNetPoints(pts: number): string {
  if (pts > 0) return `+${pts.toLocaleString()}`;
  return pts.toLocaleString();
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function PortfolioPage({ params }: PortfolioPageProps) {
  const username = decodeURIComponent(params.username);
  const portfolio = await fetchPortfolioData(username);

  if (!portfolio) {
    notFound();
  }

  const accuracyPct = portfolio.accuracyScore.toFixed(1);

  return (
    <div className={styles.page}>
      {/* ------------------------------------------------------------------ */}
      {/* Header */}
      {/* ------------------------------------------------------------------ */}
      <header className={styles.header}>
        <p className={styles.portfolioLabel}>Predict Future Portfolio</p>
        <div className={styles.usernameRow}>
          <h1 className={styles.username}>@{portfolio.username}</h1>
          {portfolio.isVerifiedAnalyst && (
            <span className={styles.verifiedBadge} title="Verified Analyst">
              ✓ Verified Analyst
            </span>
          )}
        </div>
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
          <span className={styles.statValue}>{portfolio.totalPredictions}</span>
          <span className={styles.statLabel}>Predictions</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <span className={styles.statValue}>
            {formatNetPoints(portfolio.totalNetPoints)}
          </span>
          <span className={styles.statLabel}>Net Pts</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <span className={styles.statValue}>{portfolio.bestStreak}</span>
          <span className={styles.statLabel}>Best Streak</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <span className={styles.statValue}>{portfolio.followerCount}</span>
          <span className={styles.statLabel}>Followers</span>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Recent resolved markets */}
      {/* ------------------------------------------------------------------ */}
      {portfolio.resolvedMarkets.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Recent Calls</h2>
          <ul className={styles.marketList}>
            {portfolio.resolvedMarkets.map((market) => (
              <li key={market.id} className={styles.marketRow}>
                <div className={styles.marketInfo}>
                  <p className={styles.marketTitle}>{market.title}</p>
                  <p className={styles.marketDate}>
                    {formatDate(market.resolvedAt)}
                  </p>
                </div>
                <div className={styles.marketMeta}>
                  <span
                    className={`${styles.chip} ${outcomeColorClass(market.outcome)}`}
                  >
                    {outcomeLabel(market.outcome)}
                  </span>
                  {market.userCall && (
                    <span
                      className={`${styles.callChip} ${callColorClass(market.userCall.side, market.outcome)}`}
                    >
                      Called {market.userCall.side} · {market.userCall.amount.toLocaleString()} pts
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Open markets */}
      {/* ------------------------------------------------------------------ */}
      {portfolio.openList.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Live Markets</h2>
          <ul className={styles.marketList}>
            {portfolio.openList.map((market) => (
              <li key={market.id} className={styles.openMarketRow}>
                <div className={styles.openMarketInfo}>
                  <p className={styles.marketTitle}>{market.title}</p>
                </div>
                <div className={styles.openMarketMeta}>
                  <span className={styles.openChip}>OPEN</span>
                  {market.userCall && (
                    <span className={styles.stakeChip}>
                      {market.userCall.side} · {market.userCall.amount.toLocaleString()} pts
                    </span>
                  )}
                </div>
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
          Follow <strong>@{portfolio.username}</strong> on Predict Future
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
          href={`predictfuture://user/${portfolio.username}`}
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
