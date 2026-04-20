import { ResolutionForm } from "@/components/admin/resolution-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  challengeStatusLabels,
  poolRewardModeLabels,
  resolutionModeLabels,
  resolutionStatusLabels
} from "@/lib/constants";
import { normalizeResolutionMode } from "@/lib/markets/policies";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatPoints } from "@/lib/utils";

export default async function ResolutionsPage() {
  const markets = await prisma.market.findMany({
    where: {
      OR: [
        {
          status: {
            in: ["CLOSED", "RESOLVING"]
          }
        },
        {
          resolutionStatus: {
            in: ["RESOLVED_PENDING_CHALLENGE", "DISPUTED"]
          }
        }
      ]
    },
    include: {
      creator: true,
      resolution: true,
      challenges: {
        include: {
          challenger: {
            select: {
              username: true
            }
          }
        },
        orderBy: { createdAt: "desc" }
      }
    },
    orderBy: [{ resolutionStatus: "asc" }, { resolveAt: "asc" }]
  });

  const verifiedMarkets = markets.filter(
    (market) =>
      normalizeResolutionMode(market.resolutionMode) === "VERIFIED" &&
      ["CLOSED", "RESOLVING"].includes(market.status)
  );
  const hostReviewMarkets = markets.filter(
    (market) =>
      ["HOST", "TRUSTED_HOST"].includes(normalizeResolutionMode(market.resolutionMode)) &&
      ["RESOLVED_PENDING_CHALLENGE", "DISPUTED"].includes(market.resolutionStatus)
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Resolution queue</h1>
        <p className="mt-2 text-sm text-ink-500">
          Verified markets resolve against the written rule and named source. Trusted-host markets need uphold, overturn, or cancel review once the host submits an outcome.
        </p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-ink-900">Verified markets</h2>
          <p className="mt-1 text-sm text-ink-500">Use this queue for source-based or verified public/private markets.</p>
        </div>
        <div className="space-y-4">
          {verifiedMarkets.map((market) => (
            <Card key={market.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning">{market.status.toLowerCase()}</Badge>
                  <Badge>{resolutionModeLabels[market.resolutionMode]}</Badge>
                  <Badge>{market.category.toLowerCase()}</Badge>
                </div>
                <CardTitle className="pt-4">{market.title}</CardTitle>
                <CardDescription>
                  @{market.creator.username} · resolves at {formatDateTime(market.resolveAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
                <div className="space-y-3 text-sm leading-7 text-ink-600">
                  <div>
                    <p className="font-medium text-ink-900">Rule</p>
                    <p>{market.resolutionRuleText}</p>
                  </div>
                  {market.fallbackRuleText && (
                    <div>
                      <p className="font-medium text-ink-900">Fallback</p>
                      <p>{market.fallbackRuleText}</p>
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-ink-900">Source</p>
                    <p>{market.resolutionSourceName}</p>
                  </div>
                </div>
                <ResolutionForm marketId={market.id} marketType={market.marketType} mode="verified" />
              </CardContent>
            </Card>
          ))}
          {verifiedMarkets.length === 0 && (
            <p className="text-sm text-ink-500">No verified markets need manual resolution.</p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-ink-900">Host review</h2>
          <p className="mt-1 text-sm text-ink-500">
            Review challenged or pending host-resolved markets before commission and payouts finalize.
          </p>
        </div>
        <div className="space-y-4">
          {hostReviewMarkets.map((market) => {
            const hostEvidence =
              market.hostResolutionEvidenceJson &&
              typeof market.hostResolutionEvidenceJson === "object" &&
              !Array.isArray(market.hostResolutionEvidenceJson)
                ? (market.hostResolutionEvidenceJson as { text?: string | null; url?: string | null })
                : null;

            return (
              <Card key={market.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">{resolutionStatusLabels[market.resolutionStatus]}</Badge>
                    <Badge>{resolutionModeLabels[market.resolutionMode]}</Badge>
                    <Badge variant="accent">{poolRewardModeLabels[market.poolRewardMode]}</Badge>
                    <Badge>{market.category.toLowerCase()}</Badge>
                  </div>
                  <CardTitle className="pt-4">{market.title}</CardTitle>
                  <CardDescription>
                    Host @{market.creator.username} · {market.marketType === "NUMERIC" ? "numeric" : "binary"} market
                    {" · "}
                    {market.poolRewardMode === "COMMISSION_BASED"
                      ? `commission ${(market.hostCommissionBps / 100).toFixed(2)}%`
                      : `bond reward ${formatPoints(market.lockedBondAmount)} pts`}
                    {" · "}bond {formatPoints(market.lockedBondAmount)} pts
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
                  <div className="space-y-4 text-sm leading-7 text-ink-600">
                    <div>
                      <p className="font-medium text-ink-900">Host note</p>
                      <p>{market.hostResolutionNote ?? market.resolution?.explanation ?? "No note attached."}</p>
                    </div>
                    {(hostEvidence?.text || hostEvidence?.url) && (
                      <div>
                        <p className="font-medium text-ink-900">Host evidence</p>
                        {hostEvidence?.text && <p>{hostEvidence.text}</p>}
                        {hostEvidence?.url && (
                          <a href={hostEvidence.url} target="_blank" rel="noreferrer" className="text-signal-sky">
                            Open host evidence
                          </a>
                        )}
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-ink-900">
                        {market.marketType === "NUMERIC" ? "Submitted actual value" : "Submitted outcome"}
                      </p>
                      <p>{market.marketType === "NUMERIC" ? market.actualValue ?? "Pending" : market.outcome}</p>
                    </div>
                    <div>
                      <p className="font-medium text-ink-900">Challenges</p>
                      <div className="space-y-2">
                        {market.challenges.length > 0 ? (
                          market.challenges.map((challenge) => (
                            <div key={challenge.id} className="rounded-[20px] border border-ink-100 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge>{challengeStatusLabels[challenge.status]}</Badge>
                                <p className="font-medium text-ink-900">@{challenge.challenger.username}</p>
                              </div>
                              {challenge.reasonText && <p className="mt-2">{challenge.reasonText}</p>}
                              {challenge.evidenceText && <p className="mt-2">{challenge.evidenceText}</p>}
                              {challenge.evidenceUrl && (
                                <a
                                  href={challenge.evidenceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 block text-signal-sky"
                                >
                                  Open challenger evidence
                                </a>
                              )}
                            </div>
                          ))
                        ) : (
                          <p>No participant challenge text yet. Staff can still uphold or cancel after review.</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <ResolutionForm marketId={market.id} marketType={market.marketType} mode="host_review" />
                </CardContent>
              </Card>
            );
          })}
          {hostReviewMarkets.length === 0 && (
            <p className="text-sm text-ink-500">No host-resolved markets currently need moderator review.</p>
          )}
        </div>
      </section>
    </div>
  );
}
