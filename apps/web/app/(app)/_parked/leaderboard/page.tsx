import Link from "next/link";
import { MarketCategory } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { marketCategoryLabels } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { formatPercent, formatPoints } from "@/lib/utils";

export default async function LeaderboardPage({
  searchParams
}: {
  searchParams?: { category?: string };
}) {
  const selectedCategory =
    searchParams?.category && Object.values(MarketCategory).includes(searchParams.category as MarketCategory)
      ? (searchParams.category as MarketCategory)
      : null;

  const [globalEntries, categoryEntries] = await Promise.all([
    prisma.user.findMany({
      include: {
        stats: true
      },
      orderBy: [{ reputationScore: "desc" }, { accuracyScore: "desc" }],
      take: 25
    }),
    selectedCategory
      ? prisma.userCategoryStat.findMany({
          where: {
            category: selectedCategory
          },
          include: {
            user: true
          },
          orderBy: [{ accuracyScore: "desc" }, { totalNetPoints: "desc" }],
          take: 25
        })
      : Promise.resolve([])
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink-900">Leaderboard</h1>
          <p className="mt-2 text-sm text-ink-500">
            Rankings emphasize forecasting quality, activity, and reputation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/leaderboard">
            <Badge variant={!selectedCategory ? "accent" : "default"}>Global</Badge>
          </Link>
          {Object.entries(marketCategoryLabels).map(([value, label]) => (
            <Link key={value} href={`/leaderboard?category=${value}`}>
              <Badge variant={selectedCategory === value ? "accent" : "default"}>{label}</Badge>
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{selectedCategory ? `${marketCategoryLabels[selectedCategory]} ranking` : "Global ranking"}</CardTitle>
          <CardDescription>
            {selectedCategory
              ? "Category ranking uses accuracy and net virtual-point performance in that category."
              : "Global ranking uses reputation, accuracy, and sustained participation."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Rank</TableHeaderCell>
                <TableHeaderCell>User</TableHeaderCell>
                <TableHeaderCell>Accuracy</TableHeaderCell>
                <TableHeaderCell>Predictions</TableHeaderCell>
                <TableHeaderCell>{selectedCategory ? "Net points" : "Reputation"}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {selectedCategory
                ? categoryEntries.map((entry, index) => (
                    <TableRow key={entry.id}>
                      <TableCell>#{index + 1}</TableCell>
                      <TableCell>@{entry.user.username}</TableCell>
                      <TableCell>{formatPercent(entry.accuracyScore / 100)}</TableCell>
                      <TableCell>{entry.totalPredictions}</TableCell>
                      <TableCell>{formatPoints(entry.totalNetPoints)} pts</TableCell>
                    </TableRow>
                  ))
                : globalEntries.map((entry, index) => (
                    <TableRow key={entry.id}>
                      <TableCell>#{index + 1}</TableCell>
                      <TableCell>@{entry.username}</TableCell>
                      <TableCell>{formatPercent(entry.accuracyScore / 100)}</TableCell>
                      <TableCell>{entry.stats?.totalPredictions ?? 0}</TableCell>
                      <TableCell>{entry.reputationScore}</TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
