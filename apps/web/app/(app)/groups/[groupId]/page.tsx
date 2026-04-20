import Link from "next/link";
import { notFound } from "next/navigation";

import { MarketCard } from "@/components/markets/market-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { rankMarkets } from "@/lib/markets/ranking";
import { prisma } from "@/lib/prisma";

export default async function GroupDetailPage({
  params
}: {
  params: { groupId: string };
}) {
  const user = await requireUser();

  const group = await prisma.group.findUnique({
    where: {
      id: params.groupId
    },
    include: {
      owner: {
        select: {
          username: true
        }
      },
      memberships: {
        include: {
          user: {
            select: {
              username: true,
              reputationScore: true
            }
          }
        },
        orderBy: {
          joinedAt: "asc"
        }
      },
      markets: {
        where: {
          visibility: "PRIVATE",
          status: {
            notIn: ["REJECTED"]
          }
        },
        include: {
          creator: {
            select: {
              username: true,
              reputationScore: true,
              stats: {
                select: {
                  hostTrustScore: true,
                  cleanStreakCount: true,
                  recentHostTimeoutCount: true,
                  overturnedHostedMarketsCount: true,
                  publicHostingEligibility: true
                }
              }
            }
          },
          _count: {
            select: {
              comments: true
            }
          }
        }
      }
    }
  });

  if (!group) {
    notFound();
  }

  const isMember =
    user.role === "ADMIN" ||
    user.role === "MODERATOR" ||
    group.ownerId === user.id ||
    group.memberships.some((membership) => membership.userId === user.id);

  if (!isMember) {
    notFound();
  }

  const rankedMarkets = rankMarkets(group.markets);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">{group.memberships.length} members</Badge>
            <Badge>Invite code {group.inviteCode}</Badge>
          </div>
          <h1 className="mt-3 text-3xl font-semibold text-ink-900">{group.name}</h1>
          <p className="mt-2 text-sm text-ink-500">
            Owned by @{group.owner.username}. Private predictions in this group open immediately for members.
          </p>
        </div>
        <Link
          href={`/markets/create?visibility=private&groupId=${group.id}`}
          className="rounded-2xl bg-ink-900 px-4 py-3 text-sm font-medium text-white"
        >
          Create group prediction
        </Link>
      </div>

      {group.description && (
        <Card>
          <CardHeader>
            <CardTitle>About this group</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-7 text-ink-600">{group.description}</CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Private markets</CardTitle>
            <CardDescription>Only members can see or trade these prediction cards.</CardDescription>
          </CardHeader>
          <CardContent>
            {group.markets.length === 0 ? (
              <EmptyState
                title="No private markets yet"
                description="Start the first private prediction for this group."
              />
            ) : (
              <div className="grid gap-5">
                {rankedMarkets.map((market) => (
                  <MarketCard key={market.id} market={market} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>Current group roster.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {group.memberships.map((membership) => (
              <div key={membership.id} className="rounded-[24px] border border-ink-100 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink-900">@{membership.user.username}</p>
                    <p className="text-sm text-ink-500">{membership.user.reputationScore} reputation</p>
                  </div>
                  <Badge>{membership.role.toLowerCase()}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
