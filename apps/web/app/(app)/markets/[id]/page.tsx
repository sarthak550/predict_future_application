import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateProbabilities } from "@/lib/markets/probability";
import { formatPoints, formatPercent, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BettingPanel } from "@/components/markets/betting-panel";

// ─── Data helpers ────────────────────────────────────────────────────────────

async function fetchMarket(id: string) {
  const market = await prisma.market.findUnique({
    where: { id },
    include: {
      creator: {
        select: { username: true, reputationScore: true }
      },
      resolution: true
    }
  });

  // Only expose public markets (or use the existing visibility rules)
  if (!market || market.visibility === "PRIVATE") {
    return null;
  }

  return market;
}

// ─── generateMetadata ────────────────────────────────────────────────────────

export async function generateMetadata({
  params
}: {
  params: { id: string };
}): Promise<Metadata> {
  const market = await fetchMarket(params.id);

  if (!market) {
    return { title: "Market not found — Predict Future" };
  }

  const probability = calculateProbabilities(market.yesPool, market.noPool);
  const description =
    market.description ??
    `Current crowd probability: YES ${formatPercent(probability.yesProbability)}. ${market.totalParticipants ?? 0} participants.`;

  return {
    title: `${market.title} — Predict Future`,
    description,
    openGraph: {
      title: market.title,
      description,
      type: "website",
      url: `https://predictfuture.app/markets/${market.id}`
    },
    twitter: {
      card: "summary",
      title: market.title,
      description
    }
  };
}

// ─── Status chip helper ───────────────────────────────────────────────────────

function statusVariant(
  status: string
): "success" | "warning" | "danger" | "accent" | "default" {
  switch (status) {
    case "OPEN":
      return "success";
    case "DRAFT":
      return "warning";
    case "REJECTED":
      return "danger";
    case "RESOLVED":
      return "accent";
    default:
      return "default";
  }
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    OPEN: "Open",
    CLOSED: "Closed",
    DRAFT: "Draft",
    PENDING_REVIEW: "Pending review",
    AWAITING_RESOLUTION: "Awaiting resolution",
    RESOLVING: "Resolving",
    RESOLVED: "Resolved",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
    HOST_TIMEOUT: "Host timeout"
  };
  return labels[status] ?? status;
}

// ─── Page (server component) ─────────────────────────────────────────────────

export default async function MarketDetailPage({
  params
}: {
  params: { id: string };
}) {
  const market = await fetchMarket(params.id);

  if (!market) {
    notFound();
  }

  const session = await getSession();
  const isAuthenticated = Boolean(session?.user?.id);

  const probability = calculateProbabilities(market.yesPool, market.noPool);
  const isNumeric = market.marketType === "NUMERIC";
  const isOpen = market.status === "OPEN";
  const totalPool = market.yesPool + market.noPool;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Back link */}
      <div>
        <Link
          href="/markets"
          className="text-sm font-medium text-signal-sky hover:underline"
        >
          ← All markets
        </Link>
      </div>

      {/* Main card */}
      <div className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-sm backdrop-blur sm:p-8">
        {/* Status + category chips */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(market.status)}>
            {statusLabel(market.status)}
          </Badge>
          {market.category && (
            <Badge>{market.category.charAt(0) + market.category.slice(1).toLowerCase()}</Badge>
          )}
          {isOpen && (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
        </div>

        {/* Title */}
        <h1 className="mt-4 text-2xl font-semibold leading-tight text-ink-900 sm:text-3xl">
          {market.title}
        </h1>

        {/* Description */}
        {market.description && (
          <p className="mt-3 text-sm leading-7 text-ink-600">{market.description}</p>
        )}

        {/* Probability / numeric bar */}
        <div className="mt-6 rounded-2xl bg-ink-50 p-4">
          {isNumeric ? (
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-ink-600">Average prediction</span>
                <span className="text-lg font-semibold text-ink-900">
                  {market.averageNumericValue != null
                    ? `${Number(market.averageNumericValue).toLocaleString(undefined, {
                        maximumFractionDigits: 2
                      })}${market.unit ? ` ${market.unit}` : ""}`
                    : "No guesses yet"}
                </span>
              </div>
              {market.totalParticipants != null && market.totalParticipants > 0 && (
                <p className="text-xs text-ink-500">
                  {market.totalParticipants}{" "}
                  {market.totalParticipants === 1 ? "guess" : "guesses"}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-ink-600">Crowd YES probability</span>
                <span className="text-lg font-semibold text-ink-900">
                  {formatPercent(probability.yesProbability)}
                </span>
              </div>
              <Progress value={probability.yesProbability * 100} />
              <div className="grid grid-cols-2 gap-3 text-sm text-ink-500">
                <div>
                  <p className="font-medium text-emerald-700">YES pool</p>
                  <p>{formatPoints(market.yesPool)} pts</p>
                </div>
                <div>
                  <p className="font-medium text-rose-700">NO pool</p>
                  <p>{formatPoints(market.noPool)} pts</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Stats grid */}
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm text-ink-500 sm:grid-cols-4">
          <div>
            <p className="font-medium text-ink-800">Volume</p>
            <p>{formatPoints(market.totalVolume ?? totalPool)} pts</p>
          </div>
          <div>
            <p className="font-medium text-ink-800">Participants</p>
            <p>{market.totalParticipants ?? 0}</p>
          </div>
          {market.closeAt && (
            <div>
              <p className="font-medium text-ink-800">Closes</p>
              <p>{formatDateTime(market.closeAt)}</p>
            </div>
          )}
          {market.resolveAt && (
            <div>
              <p className="font-medium text-ink-800">Resolves</p>
              <p>{formatDateTime(market.resolveAt)}</p>
            </div>
          )}
        </div>

        {/* Host */}
        {market.creator?.username && (
          <p className="mt-4 text-sm font-medium text-signal-sky">
            Hosted by @{market.creator.username}
          </p>
        )}

        {/* Resolution rules */}
        {market.resolutionRuleText && (
          <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
            <p className="mb-1 font-semibold">Resolution rules</p>
            <p className="leading-6">{market.resolutionRuleText}</p>
          </div>
        )}
      </div>

      {/* Betting panel (client component) */}
      <BettingPanel
        marketId={market.id}
        marketStatus={market.status}
        marketType={market.marketType}
        yesPool={market.yesPool}
        noPool={market.noPool}
        isAuthenticated={isAuthenticated}
      />

      {/* Share link */}
      <div className="rounded-2xl border border-ink-100 bg-white/60 p-4 text-sm text-ink-500">
        <span className="font-medium text-ink-700">Share this market: </span>
        <span className="break-all text-signal-sky">
          https://predictfuture.app/markets/{market.id}
        </span>
      </div>
    </div>
  );
}
