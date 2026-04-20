import { notFound } from "next/navigation";
import { Clock3, FileText, Gauge, ShieldCheck, Users } from "lucide-react";

import { ChallengeForm } from "@/components/markets/challenge-form";
import { CommentsSection } from "@/components/markets/comments-section";
import { HostBondForm } from "@/components/markets/host-bond-form";
import { HostResolutionForm } from "@/components/markets/host-resolution-form";
import { PositionForm } from "@/components/markets/position-form";
import { ReportMarketForm } from "@/components/markets/report-market-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import {
  challengeStatusLabels,
  marketCategoryLabels,
  marketTypeLabels,
  marketTemplateLabels,
  marketVisibilityLabels,
  numericTieBreakerLabels,
  poolRewardModeLabels,
  resolutionModeLabels,
  resolutionStatusLabels
} from "@/lib/constants";
import { canViewMarket } from "@/lib/markets/access";
import {
  canCreatorParticipateInMarket,
  isHostResolvedMode,
  normalizeResolutionMode
} from "@/lib/markets/policies";
import { calculateProbabilities } from "@/lib/markets/probability";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatNumericValue, formatPercent, formatPoints, formatRelativeTime } from "@/lib/utils";

function badgeVariantForOutcome(outcome: "YES" | "NO" | "CANCELLED" | "UNRESOLVED") {
  if (outcome === "YES") {
    return "success" as const;
  }

  if (outcome === "NO") {
    return "danger" as const;
  }

  return "warning" as const;
}

function badgeVariantForResolutionStatus(status: string) {
  if (status === "FINALIZED") {
    return "success" as const;
  }

  if (status === "OVERTURNED") {
    return "danger" as const;
  }

  if (status === "DISPUTED" || status === "RESOLVED_PENDING_CHALLENGE") {
    return "warning" as const;
  }

  return "default" as const;
}

export default async function MarketDetailPage({
  params
}: {
  params: { marketId: string };
}) {
  const user = await getCurrentUser();
  const market = await prisma.market.findUnique({
    where: { id: params.marketId },
    include: {
      group: user?.id
        ? {
            select: {
              id: true,
              name: true,
              inviteCode: true,
              ownerId: true,
              memberships: {
                where: {
                  userId: user.id
                },
                select: {
                  userId: true
                }
              }
            }
          }
        : {
            select: {
              id: true,
              name: true,
              inviteCode: true,
              ownerId: true
            }
          },
      creator: {
        select: {
          id: true,
          username: true,
          createdAt: true,
          reputationScore: true,
          role: true,
          stats: {
            select: {
              hostTrustScore: true,
              publicHostingEligibility: true,
              finalizedHostedMarketsCount: true,
              validFinalizedHostedMarketsCount: true,
              cleanFinalizationCount: true,
              hostTimeoutCount: true,
              overturnedHostedMarketsCount: true,
              avgHostCommissionBps: true
            }
          }
        }
      },
      adminActions: {
        where: {
          type: "REJECT_MARKET"
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      },
      comments: {
        include: {
          user: {
            select: {
              username: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      },
      resolution: true,
      challenges: {
        include: {
          challenger: {
            select: {
              username: true
            }
          },
          reviewedBy: {
            select: {
              username: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      },
      positions: {
        include: {
          user: {
            select: {
              username: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 6
      }
    }
  });

  if (!market) {
    notFound();
  }

  if (!canViewMarket(market, user ? { id: user.id, role: user.role } : null)) {
    notFound();
  }

  const [viewerPositionCount, viewerOpenChallenge] = user
    ? await Promise.all([
        prisma.marketPosition.count({
          where: {
            marketId: market.id,
            userId: user.id
          }
        }),
        prisma.challenge.findFirst({
          where: {
            marketId: market.id,
            challengerUserId: user.id,
            status: "OPEN"
          },
          select: {
            id: true
          }
        })
      ])
    : [0, null];

  const probability = calculateProbabilities(market.yesPool, market.noPool);
  const userBalance = user?.wallet?.balance ?? 0;
  const normalizedResolutionMode = normalizeResolutionMode(market.resolutionMode);
  const trustedHostMarket = normalizedResolutionMode === "TRUSTED_HOST";
  const hostStyleMarket = isHostResolvedMode(market.resolutionMode);
  const numericMarket = market.marketType === "NUMERIC";
  const commissionBasedHosting = market.poolRewardMode === "COMMISSION_BASED";
  const bondBasedHosting = market.poolRewardMode === "BOND_BASED";
  const now = new Date();
  const payoutDistribution = Array.isArray(market.payoutDistributionJson)
    ? market.payoutDistributionJson.filter((value): value is number => typeof value === "number")
    : [];
  const challengeWindowOpen =
    Boolean(market.challengeWindowEndsAt) && new Date(market.challengeWindowEndsAt as Date) > now;
  const hostEvidence =
    market.hostResolutionEvidenceJson && typeof market.hostResolutionEvidenceJson === "object" && !Array.isArray(market.hostResolutionEvidenceJson)
      ? (market.hostResolutionEvidenceJson as { text?: string | null; url?: string | null })
      : null;
  const hostStats = market.creator.stats;
  const cleanResolutionRate =
    (hostStats?.finalizedHostedMarketsCount ?? 0) > 0
      ? Math.max(
          0,
          ((hostStats?.cleanFinalizationCount ?? 0) / (hostStats?.finalizedHostedMarketsCount ?? 1)) * 100
        )
      : 0;

  let tradeDisabledReason: string | undefined;
  if (!user) {
    tradeDisabledReason = undefined;
  } else if (user.isSuspended) {
    tradeDisabledReason = "Suspended accounts cannot take positions.";
  } else if (market.status !== "OPEN" || market.closeAt <= new Date()) {
    tradeDisabledReason = "This market is closed to new positions.";
  } else if (market.creatorId === user.id && !canCreatorParticipateInMarket(market.resolutionMode)) {
    tradeDisabledReason = trustedHostMarket
      ? "Trusted hosts cannot take positions in their own public markets."
      : "Hosts cannot take positions in their own host-resolved markets.";
  } else if (
    hostStyleMarket &&
    commissionBasedHosting &&
    market.maxPoolAllowed !== null &&
    market.totalVolume >= market.maxPoolAllowed
  ) {
    tradeDisabledReason =
      "This commission-based market has reached the host's current bond-supported max pool. The host must add more bond before new entries can open again.";
  }

  const viewerCanTrade = Boolean(user && !tradeDisabledReason);

  const viewerIsHost = Boolean(user && market.creatorId === user.id);
  let hostResolutionDisabledReason: string | undefined;
  if (!viewerIsHost) {
    hostResolutionDisabledReason = "Only the market host can submit this resolution.";
  } else if (!["HOST", "GROUP_VOTE", "TRUSTED_HOST"].includes(normalizedResolutionMode)) {
    hostResolutionDisabledReason = "This market does not use host-driven resolution.";
  } else if ((numericMarket && market.actualValue !== null) || (!numericMarket && market.outcome !== "UNRESOLVED")) {
    hostResolutionDisabledReason = "A resolution has already been submitted.";
  } else if (market.closeAt > new Date()) {
    hostResolutionDisabledReason = "Wait until the market closes before submitting a resolution.";
  } else if (market.status === "HOST_TIMEOUT") {
    hostResolutionDisabledReason = "This market timed out and has already been cancelled with refunds.";
  }

  let hostBondDisabledReason: string | undefined;
  if (!viewerIsHost) {
    hostBondDisabledReason = "Only the host can add more bond cap.";
  } else if (!hostStyleMarket) {
    hostBondDisabledReason = "This market does not use host bond safeguards.";
  } else if (["FINALIZED", "OVERTURNED", "CANCELLED", "HOST_TIMEOUT"].includes(market.resolutionStatus)) {
    hostBondDisabledReason = "This market is already finalized and cannot accept more bond.";
  }

  const canChallenge =
    Boolean(user) &&
    hostStyleMarket &&
    market.resolutionStatus === "RESOLVED_PENDING_CHALLENGE" &&
    challengeWindowOpen &&
    viewerPositionCount > 0 &&
    !viewerOpenChallenge;

  let challengeDisabledReason: string | undefined;
  if (!hostStyleMarket) {
    challengeDisabledReason = "Challenges only apply to host-resolved markets.";
  } else if (!user) {
    challengeDisabledReason = "Sign in to challenge a host resolution.";
  } else if (viewerPositionCount === 0) {
    challengeDisabledReason = "Only participants in the market can challenge the host outcome.";
  } else if (market.resolutionStatus === "DISPUTED") {
    challengeDisabledReason = "This market is already in moderator review.";
  } else if (market.resolutionStatus !== "RESOLVED_PENDING_CHALLENGE") {
    challengeDisabledReason = "This market is not currently challengeable.";
  } else if (!challengeWindowOpen) {
    challengeDisabledReason = "The challenge window has closed.";
  } else if (viewerOpenChallenge) {
    challengeDisabledReason = "You already have an open challenge on this market.";
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-6">
        <Card className="overflow-hidden border-0 bg-ink-900 text-white">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-white/10 text-white">{marketCategoryLabels[market.category]}</Badge>
              <Badge className="bg-white/10 text-white">{marketTemplateLabels[market.template]}</Badge>
              <Badge className="bg-white/10 text-white">{marketVisibilityLabels[market.visibility]}</Badge>
              <Badge className="bg-white/10 text-white">{marketTypeLabels[market.marketType]}</Badge>
              <Badge className="bg-white/10 text-white">{resolutionModeLabels[market.resolutionMode]}</Badge>
              {hostStyleMarket && <Badge className="bg-white/10 text-white">{poolRewardModeLabels[market.poolRewardMode]}</Badge>}
              <Badge className="bg-white/10 text-white">{market.status.toLowerCase()}</Badge>
              <Badge className="bg-white/10 text-white">
                {resolutionStatusLabels[market.resolutionStatus]}
              </Badge>
            </div>
            <CardTitle className="pt-4 text-3xl text-white">{market.title}</CardTitle>
            <CardDescription className="max-w-3xl text-white/70">{market.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-[24px] bg-white/10 p-4">
              <Gauge className="h-5 w-5 text-signal-sky" />
              <p className="mt-3 text-sm text-white/60">
                {numericMarket ? "Winner slots" : "YES probability"}
              </p>
              <p className="text-2xl font-semibold">
                {numericMarket ? market.winnersCount : formatPercent(probability.yesProbability)}
              </p>
            </div>
            <div className="rounded-[24px] bg-white/10 p-4">
              <Users className="h-5 w-5 text-signal-teal" />
              <p className="mt-3 text-sm text-white/60">Participants</p>
              <p className="text-2xl font-semibold">{market.totalParticipants}</p>
            </div>
            <div className="rounded-[24px] bg-white/10 p-4">
              <Clock3 className="h-5 w-5 text-signal-amber" />
              <p className="mt-3 text-sm text-white/60">Closes</p>
              <p className="text-sm font-semibold">{formatDateTime(market.closeAt)}</p>
            </div>
            <div className="rounded-[24px] bg-white/10 p-4">
              <FileText className="h-5 w-5 text-signal-coral" />
              <p className="mt-3 text-sm text-white/60">Volume</p>
              <p className="text-2xl font-semibold">{formatPoints(market.totalVolume)}</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {market.status === "REJECTED" && market.adminActions[0]?.notes && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Staff feedback</CardTitle>
                <CardDescription>This market is currently rejected and hidden from public discovery.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm leading-7 text-ink-600">
                {market.adminActions[0].notes}
              </CardContent>
            </Card>
          )}

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Market status</CardTitle>
              <CardDescription>Deadlines, host timeline, and current review state.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-ink-600">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={badgeVariantForResolutionStatus(market.resolutionStatus)}>
                  {resolutionStatusLabels[market.resolutionStatus]}
                </Badge>
                <Badge variant="accent">{market.status.toLowerCase()}</Badge>
                {hostStyleMarket && <Badge variant="accent">{poolRewardModeLabels[market.poolRewardMode]}</Badge>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[20px] bg-ink-50 p-4">
                  <p className="font-medium text-ink-900">Entries close</p>
                  <p className="mt-1">{formatDateTime(market.closeAt)}</p>
                </div>
                <div className="rounded-[20px] bg-ink-50 p-4">
                  <p className="font-medium text-ink-900">Outcome expected</p>
                  <p className="mt-1">{formatDateTime(market.resolveAt)}</p>
                </div>
                <div className="rounded-[20px] bg-ink-50 p-4">
                  <p className="font-medium text-ink-900">Host resolution deadline</p>
                  <p className="mt-1">
                    {market.finalResolutionDeadline ? formatDateTime(market.finalResolutionDeadline) : "Not active"}
                  </p>
                </div>
                <div className="rounded-[20px] bg-ink-50 p-4">
                  <p className="font-medium text-ink-900">Challenge window</p>
                  <p className="mt-1">
                    {market.challengeWindowEndsAt ? formatDateTime(market.challengeWindowEndsAt) : `${market.challengeWindowHours}h after host resolution`}
                  </p>
                </div>
              </div>
              {market.resolutionStatus === "AWAITING_RESOLUTION" && market.finalResolutionDeadline && (
                <div className="rounded-[20px] bg-amber-50 p-4 text-amber-900">
                  Waiting for host. The creator must submit the result before{" "}
                  <span className="font-semibold">{formatDateTime(market.finalResolutionDeadline)}</span>
                  {" · "}
                  {formatRelativeTime(market.finalResolutionDeadline)}.
                </div>
              )}
              {market.resolutionStatus === "RESOLVED_PENDING_CHALLENGE" && market.challengeWindowEndsAt && (
                <div className="rounded-[20px] bg-amber-50 p-4 text-amber-900">
                  Challenge window is {challengeWindowOpen ? "open" : "closed"} until{" "}
                  <span className="font-semibold">{formatDateTime(market.challengeWindowEndsAt)}</span>.
                </div>
              )}
              {market.resolutionStatus === "DISPUTED" && (
                <div className="rounded-[20px] bg-amber-50 p-4 text-amber-900">
                  A participant challenge is under moderator review. Final payouts and host reward stay on hold.
                </div>
              )}
              {market.resolutionStatus === "HOST_TIMEOUT" && (
                <div className="rounded-[20px] bg-rose-50 p-4 text-rose-800">
                  The host missed the deadline. Participant stakes were refunded and host reward was forfeited.
                </div>
              )}
              {(market.resolution?.resolvedAt || market.finalizationAt) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {market.resolution?.resolvedAt && (
                    <div>
                      <p className="font-medium text-ink-900">Host submitted</p>
                      <p>{formatDateTime(market.resolution.resolvedAt)}</p>
                    </div>
                  )}
                  {market.finalizationAt && (
                    <div>
                      <p className="font-medium text-ink-900">Finalized</p>
                      <p>{formatDateTime(market.finalizationAt)}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resolution framework</CardTitle>
              <CardDescription>Objective rules and named sources reduce ambiguity.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-7 text-ink-600">
              <div>
                <p className="font-medium text-ink-900">Source</p>
                <p>{market.resolutionSourceName}</p>
                {market.resolutionSourceUrl && (
                  <a
                    href={market.resolutionSourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-signal-sky"
                  >
                    View source
                  </a>
                )}
              </div>
              <div>
                <p className="font-medium text-ink-900">Resolution rule</p>
                <p>{market.resolutionRuleText}</p>
              </div>
              {market.fallbackRuleText && (
                <div>
                  <p className="font-medium text-ink-900">Fallback rule</p>
                  <p>{market.fallbackRuleText}</p>
                </div>
              )}
              {numericMarket && (
                <div className="rounded-[20px] bg-ink-50 p-4">
                  <p className="font-medium text-ink-900">Numeric rules</p>
                  <p className="mt-2">
                    Closest {market.winnersCount} guess{market.winnersCount === 1 ? "" : "es"} win.
                    {payoutDistribution.length > 0 && ` Distribution: ${payoutDistribution.map((value) => `${value}%`).join(" / ")}.`}
                  </p>
                  <p className="mt-2">
                    {market.minValue !== null ? `Min ${formatNumericValue(market.minValue, { unit: market.unit, precision: market.precision })}` : "No minimum"}
                    {" · "}
                    {market.maxValue !== null ? `Max ${formatNumericValue(market.maxValue, { unit: market.unit, precision: market.precision })}` : "No maximum"}
                    {" · "}
                    Tie-breaker {market.tieBreakerRule ? numericTieBreakerLabels[market.tieBreakerRule] : "system default"}
                  </p>
                </div>
              )}
              {hostStyleMarket && (
                <div className="rounded-[20px] bg-amber-50 p-4 text-amber-900">
                  <p className="font-medium text-ink-900">
                    {trustedHostMarket ? "Trusted host safeguards" : "Host safeguards"}
                  </p>
                  <p className="mt-2">
                    {commissionBasedHosting
                      ? `Commission-based hosting is active. Host reward is fixed at ${(market.hostCommissionBps / 100).toFixed(2)}% of the final pool and does not vary by outcome.`
                      : `Bond-based hosting is active. The host reward comes from the locked bond, not from a commission percentage.`}{" "}
                    The host cannot participate in their own market.
                  </p>
                  {market.challengeWindowEndsAt && (
                    <p className="mt-2">
                      Challenge window {challengeWindowOpen ? "closes" : "closed"}{" "}
                      {challengeWindowOpen
                        ? formatRelativeTime(market.challengeWindowEndsAt)
                        : `at ${formatDateTime(market.challengeWindowEndsAt)}`}
                      .
                    </p>
                  )}
                  {market.lockedBondAmount > 0 && (
                    <p className="mt-2">
                      Locked bond: {formatPoints(market.lockedBondAmount)} pts.
                      {commissionBasedHosting && market.maxPoolAllowed !== null
                        ? ` Max pool: ${formatPoints(market.maxPoolAllowed)} pts.`
                        : ""}
                      {bondBasedHosting ? " No pool cap applies in bond-based mode. The host loses this bond on timeout or confirmed misconduct." : ""}
                    </p>
                  )}
                  {market.finalResolutionDeadline && market.resolutionStatus === "AWAITING_RESOLUTION" && (
                    <p className="mt-2">
                      Resolution deadline: {formatDateTime(market.finalResolutionDeadline)}.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{numericMarket ? "Guess structure" : "Live pools"}</CardTitle>
              <CardDescription>
                {numericMarket
                  ? "Numeric markets rank guesses by absolute error once the actual value is submitted."
                  : "Crowd demand directly updates the implied probability."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {numericMarket ? (
                <>
                  <div className="rounded-[24px] bg-ink-50 p-4">
                    <p className="text-sm font-medium text-ink-700">Total pool</p>
                    <p className="mt-1 text-2xl font-semibold text-ink-900">{formatPoints(market.totalVolume)} pts</p>
                  </div>
                  <div className="rounded-[24px] bg-ink-50 p-4">
                    <p className="text-sm font-medium text-ink-700">Closest guess rule</p>
                    <p className="mt-1 text-sm text-ink-600">
                      Winners are ranked by distance from the actual value. The host cannot manually pick winners or payouts.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-[24px] bg-emerald-50 p-4">
                    <p className="text-sm font-medium text-emerald-700">YES pool</p>
                    <p className="mt-1 text-2xl font-semibold text-ink-900">{formatPoints(market.yesPool)} pts</p>
                  </div>
                  <div className="rounded-[24px] bg-rose-50 p-4">
                    <p className="text-sm font-medium text-rose-700">NO pool</p>
                    <p className="mt-1 text-2xl font-semibold text-ink-900">{formatPoints(market.noPool)} pts</p>
                  </div>
                </>
              )}
              <div className="rounded-[24px] bg-ink-50 p-4 text-sm text-ink-600">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink-900">{hostStyleMarket ? "Host" : "Creator"}</p>
                  {hostStyleMarket && (
                    <Badge variant={market.creator.stats?.publicHostingEligibility ? "accent" : "default"}>
                      {market.creator.stats?.publicHostingEligibility ? "Trusted host eligible" : "Host account"}
                    </Badge>
                  )}
                </div>
                <p className="mt-2">
                  @{market.creator.username} · {market.creator.reputationScore} reputation
                </p>
                {hostStyleMarket && hostStats && (
                  <div className="mt-2 space-y-1">
                    <p>
                      Trust score {hostStats.hostTrustScore} · finalized {hostStats.finalizedHostedMarketsCount} · clean rate{" "}
                      {cleanResolutionRate.toFixed(0)}%
                    </p>
                    <p>
                      Overturned {hostStats.overturnedHostedMarketsCount} · timeouts {hostStats.hostTimeoutCount} · avg fee{" "}
                      {(hostStats.avgHostCommissionBps / 100).toFixed(2)}%
                    </p>
                    <p>Member since {formatDateTime(market.creator.createdAt)}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {market.visibility === "PRIVATE" && market.group && (
            <Card>
              <CardHeader>
                <CardTitle>Group access</CardTitle>
                <CardDescription>This prediction is shared only inside the linked private group.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-7 text-ink-600">
                <div>
                  <p className="font-medium text-ink-900">Group</p>
                  <p>{market.group.name}</p>
                </div>
                <div>
                  <p className="font-medium text-ink-900">Invite code</p>
                  <p>{market.group.inviteCode}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {hostStyleMarket && (
            <Card>
              <CardHeader>
                <CardTitle>Host trust</CardTitle>
                <CardDescription>
                  Clear host stats help participants decide whether this market is worth joining.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-7 text-ink-600">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[20px] bg-ink-50 p-4">
                    <p className="font-medium text-ink-900">Trust score</p>
                    <p className="mt-1 text-xl font-semibold text-ink-900">{hostStats?.hostTrustScore ?? 30}</p>
                  </div>
                  <div className="rounded-[20px] bg-ink-50 p-4">
                    <p className="font-medium text-ink-900">Valid hosted markets</p>
                    <p className="mt-1 text-xl font-semibold text-ink-900">
                      {hostStats?.validFinalizedHostedMarketsCount ?? 0}
                    </p>
                  </div>
                  <div className="rounded-[20px] bg-ink-50 p-4">
                    <p className="font-medium text-ink-900">Timeouts</p>
                    <p className="mt-1 text-xl font-semibold text-ink-900">{hostStats?.hostTimeoutCount ?? 0}</p>
                  </div>
                  <div className="rounded-[20px] bg-ink-50 p-4">
                    <p className="font-medium text-ink-900">Overturns</p>
                    <p className="mt-1 text-xl font-semibold text-ink-900">
                      {hostStats?.overturnedHostedMarketsCount ?? 0}
                    </p>
                  </div>
                </div>
                <div className="rounded-[20px] bg-ink-50 p-4">
                  <p className="font-medium text-ink-900">Eligibility</p>
                  <p className="mt-1">
                    {hostStats?.publicHostingEligibility
                      ? "Eligible for public trusted-host markets."
                      : "Not currently eligible for public trusted-host markets."}
                  </p>
                </div>
                <p>
                  Host participation is blocked for this market. Resolution actions, challenges, and moderation outcomes all feed back into host trust and future eligibility.
                </p>
                <div className="rounded-[20px] bg-ink-50 p-4">
                  <p className="font-medium text-ink-900">Hosting model</p>
                  <p className="mt-1">
                    {commissionBasedHosting
                      ? `Commission-based. Host reward is ${(market.hostCommissionBps / 100).toFixed(2)}% of the final pool, subject to clean finalization.`
                      : `Bond-based. Host reward comes from the locked bond itself, does not depend on final pool size, and is forfeited on timeout or misconduct.`}
                  </p>
                </div>
                {market.hostResolutionNote && (
                  <div>
                    <p className="font-medium text-ink-900">Host note</p>
                    <p>{market.hostResolutionNote}</p>
                  </div>
                )}
                {(hostEvidence?.text || hostEvidence?.url) && (
                  <div>
                    <p className="font-medium text-ink-900">Host evidence</p>
                    {hostEvidence?.text && <p>{hostEvidence.text}</p>}
                    {hostEvidence?.url && (
                      <a href={hostEvidence.url} target="_blank" rel="noreferrer" className="text-signal-sky">
                        Review evidence link
                      </a>
                    )}
                  </div>
                )}
                {market.overturnedReason && (
                  <div>
                    <p className="font-medium text-ink-900">Overturned reason</p>
                    <p>{market.overturnedReason}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {(market.resolution || market.hostResolutionNote) && (
          <Card>
            <CardHeader>
              <CardTitle>Resolution result</CardTitle>
              <CardDescription>
                {trustedHostMarket
                  ? "Trusted-host outcome with note, evidence, and current review state."
                  : "Source-based or host-based outcome with written explanation."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-7 text-ink-600">
              <div className="flex flex-wrap items-center gap-2">
                {!numericMarket && <Badge variant={badgeVariantForOutcome(market.outcome)}>{market.outcome}</Badge>}
                <Badge variant={badgeVariantForResolutionStatus(market.resolutionStatus)}>
                  {resolutionStatusLabels[market.resolutionStatus]}
                </Badge>
              </div>
              {numericMarket && market.actualValue !== null && (
                <p className="text-lg font-semibold text-ink-900">
                  Actual value: {formatNumericValue(market.actualValue, { unit: market.unit, precision: market.precision })}
                </p>
              )}
              <p className="font-medium text-ink-900">
                {market.resolution?.sourceName ?? market.resolutionSourceName}
              </p>
              <p>{market.resolution?.explanation ?? market.hostResolutionNote}</p>
              {(market.resolution?.sourceUrl || hostEvidence?.url) && (
                <a
                  href={market.resolution?.sourceUrl ?? hostEvidence?.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-signal-sky"
                >
                  Inspect evidence
                </a>
              )}
              {market.finalizationAt && (
                <p className="text-xs text-ink-500">Finalized at {formatDateTime(market.finalizationAt)}</p>
              )}
            </CardContent>
          </Card>
        )}

        {market.challenges.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Challenge record</CardTitle>
              <CardDescription>Every challenge is logged for moderation review and host trust scoring.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {market.challenges.map((challenge) => (
                <div key={challenge.id} className="rounded-[24px] border border-ink-100 p-4 text-sm text-ink-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badgeVariantForResolutionStatus(challenge.status)}>
                      {challengeStatusLabels[challenge.status]}
                    </Badge>
                    <p className="font-medium text-ink-900">@{challenge.challenger.username}</p>
                  </div>
                  {challenge.reasonText && <p className="mt-2">{challenge.reasonText}</p>}
                  {challenge.evidenceText && <p className="mt-2">{challenge.evidenceText}</p>}
                  {challenge.evidenceUrl && (
                    <a href={challenge.evidenceUrl} target="_blank" rel="noreferrer" className="mt-2 block text-signal-sky">
                      Review challenger evidence
                    </a>
                  )}
                  <p className="mt-2 text-xs text-ink-500">
                    Filed {formatRelativeTime(challenge.createdAt)}
                    {challenge.reviewedBy?.username ? ` · reviewed by @${challenge.reviewedBy.username}` : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <CommentsSection marketId={market.id} comments={market.comments} canComment={Boolean(user)} />
      </div>

      <div className="space-y-6">
        <PositionForm
          marketId={market.id}
          marketType={market.marketType}
          status={market.status}
          yesPool={market.yesPool}
          noPool={market.noPool}
          totalVolume={market.totalVolume}
          balance={userBalance}
          isAuthenticated={Boolean(user)}
          canTrade={viewerCanTrade}
          disabledReason={tradeDisabledReason}
          winnersCount={market.winnersCount}
          payoutDistribution={payoutDistribution}
          unit={market.unit}
          minValue={market.minValue}
          maxValue={market.maxValue}
          precision={market.precision}
        />

        {hostStyleMarket && (
          <Card>
            <CardHeader>
              <CardTitle>{bondBasedHosting ? "Host bond and reward" : "Host bond and pool support"}</CardTitle>
              <CardDescription>
                {commissionBasedHosting
                  ? "Bond is locked from the host wallet for accountability. Higher commission requires more bond to support larger pools."
                  : "Bond is both the host's accountability stake and the reward source if the market finalizes cleanly."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-[20px] bg-ink-50 p-4 text-sm text-ink-600">
                <p>
                  Locked bond: <span className="font-semibold text-ink-900">{formatPoints(market.lockedBondAmount)} pts</span>
                </p>
                <p className="mt-1">
                  Bond cap: <span className="font-semibold text-ink-900">{formatPoints(market.bondCap)} pts</span>
                  {commissionBasedHosting && market.maxPoolAllowed !== null
                    ? ` · max pool ${formatPoints(market.maxPoolAllowed)} pts`
                    : ""}
                </p>
                {commissionBasedHosting ? (
                  <p className="mt-1">
                    Current required bond:{" "}
                    <span className="font-semibold text-ink-900">{formatPoints(market.currentRequiredBond)} pts</span>
                    {" · "}commission {(market.hostCommissionBps / 100).toFixed(2)}%
                  </p>
                ) : (
                  <p className="mt-1">
                    Host reward if finalized cleanly:{" "}
                    <span className="font-semibold text-ink-900">{formatPoints(market.lockedBondAmount)} pts</span>
                    {" · "}no pool cap
                  </p>
                )}
              </div>
              <HostBondForm
                marketId={market.id}
                disabled={Boolean(hostBondDisabledReason)}
                disabledReason={hostBondDisabledReason}
              />
            </CardContent>
          </Card>
        )}

        {hostStyleMarket && (
          <Card>
            <CardHeader>
              <CardTitle>
                {trustedHostMarket ? "Trusted host resolution" : normalizedResolutionMode === "GROUP_VOTE" ? "Group result" : "Host resolution"}
              </CardTitle>
              <CardDescription>
                {trustedHostMarket
                  ? "Submit the initial outcome, note, and evidence. Finalization waits for the challenge window or moderator review."
                  : numericMarket
                    ? "Submit the actual value, note, and evidence. The system will rank the closest guesses automatically."
                    : "Submit the outcome using the pre-written rule once the event window is over."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HostResolutionForm
                marketId={market.id}
                modeLabel={resolutionModeLabels[market.resolutionMode]}
                marketType={market.marketType}
                unit={market.unit}
                minValue={market.minValue}
                maxValue={market.maxValue}
                precision={market.precision}
                disabled={Boolean(hostResolutionDisabledReason)}
                disabledReason={hostResolutionDisabledReason}
              />
            </CardContent>
          </Card>
        )}

        {hostStyleMarket && (
          <Card>
            <CardHeader>
              <CardTitle>Challenge outcome</CardTitle>
              <CardDescription>
                Participants can challenge a host-submitted resolution during the open review window.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChallengeForm
                marketId={market.id}
                canChallenge={canChallenge}
                disabledReason={challengeDisabledReason}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Recent positions</CardTitle>
            <CardDescription>Latest activity in this market.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {market.positions.map((position) => (
              <div key={position.id} className="rounded-[24px] border border-ink-100 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-ink-900">@{position.user.username}</p>
                  {numericMarket ? (
                    <Badge variant="accent">
                      {position.numericValue !== null
                        ? formatNumericValue(position.numericValue, { unit: market.unit, precision: market.precision })
                        : "No guess"}
                    </Badge>
                  ) : (
                    <Badge variant={position.side === "YES" ? "success" : "danger"}>{position.side}</Badge>
                  )}
                </div>
                <p className="mt-2 text-ink-500">
                  {formatPoints(position.amount)} pts committed
                  {numericMarket && position.absoluteError !== null
                    ? ` · absolute error ${formatNumericValue(position.absoluteError, {
                        unit: market.unit,
                        precision: market.precision
                      })}`
                    : ""}
                </p>
              </div>
            ))}
            {market.positions.length === 0 && <p className="text-sm text-ink-500">No positions yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Moderation and trust</CardTitle>
            <CardDescription>Report ambiguous or disallowed content.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[24px] bg-ink-50 p-4 text-sm text-ink-600">
              <div className="flex items-center gap-2 font-medium text-ink-900">
                <ShieldCheck className="h-4 w-4 text-signal-sky" />
                Allowed market types only
              </div>
              <p className="mt-2">
                Death, injury, criminal acts, private-person events, and disturbing speculation are excluded.
              </p>
            </div>
            <ReportMarketForm marketId={market.id} canReport={Boolean(user)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
