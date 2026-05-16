import bcrypt from "bcryptjs";
import {
  GroupRole,
  LeagueTier,
  MarketCategory,
  MarketStatus,
  MarketTemplate,
  MarketType,
  MarketVisibility,
  NumericTieBreakerRule,
  PoolRewardMode,
  PositionSide,
  ResolutionMode,
  Prisma
} from "@prisma/client";

import { STARTING_BALANCE } from "../lib/constants";
import {
  finalizeMarketResolution,
  upholdTrustedHostResolution,
  submitHostMarketResolution,
  submitMarketChallenge
} from "../lib/markets/resolution";
import { prisma } from "../lib/prisma";
import { backfillReferralCodes } from "../lib/referrals/backfill";
import { refreshUserStats } from "../lib/stats";
import type { StoryInput } from "../lib/validations/story";
import { ingestStories } from "../lib/news/ingestion";

async function upsertUser(input: {
  email: string;
  username: string;
  password: string;
  role?: "USER" | "ADMIN";
  avatarUrl?: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 10);

  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      username: input.username,
      passwordHash,
      role: input.role ?? "USER",
      avatarUrl: input.avatarUrl ?? null,
      isSuspended: false,
      suspendedReason: null
    },
    // Seed users intentionally skip the welcome notification — seeded notifications are added explicitly below.
    create: {
      email: input.email,
      username: input.username,
      passwordHash,
      role: input.role ?? "USER",
      avatarUrl: input.avatarUrl ?? null,
      wallet: {
        create: {
          balance: STARTING_BALANCE,
          startingBalance: STARTING_BALANCE
        }
      },
      stats: {
        create: {}
      }
    },
    include: {
      wallet: true,
      stats: true
    }
  });
}

async function seedBadges() {
  const badges = [
    {
      slug: "sharp-eye",
      name: "Sharp Eye",
      description: "Maintain 60%+ accuracy across at least 10 graded forecasts."
    },
    {
      slug: "hot-streak",
      name: "Hot Streak",
      description: "Hit a five-story winning streak."
    },
    {
      slug: "market-maker",
      name: "Story Forecaster",
      description: "Create five or more high-quality source-backed prediction stories."
    },
    {
      slug: "expert-weather",
      name: "Weather Savant",
      description: "Consistently outperform in weather stories.",
      category: MarketCategory.WEATHER
    },
    {
      slug: "expert-sports",
      name: "Match Reader",
      description: "Consistently outperform in sports stories.",
      category: MarketCategory.SPORTS
    },
    {
      slug: "expert-business",
      name: "Macro Reader",
      description: "Consistently outperform in business stories.",
      category: MarketCategory.BUSINESS
    },
    {
      slug: "expert-tech",
      name: "Launch Watcher",
      description: "Consistently outperform in tech stories.",
      category: MarketCategory.TECH
    },
    {
      slug: "best-reasoner-1",
      name: "Best Reasoner",
      description: "Top 1% of analysts by reasoning upvotes (minimum 5 upvotes to qualify)."
    }
  ] satisfies Array<Prisma.BadgeUncheckedCreateInput>;

  for (const badge of badges) {
    await prisma.badge.upsert({
      where: { slug: badge.slug },
      update: badge,
      create: badge
    });
  }
}

async function seedPosition(input: {
  marketId: string;
  userId: string;
  side: PositionSide;
  amount: number;
}) {
  const existing = await prisma.marketPosition.findFirst({
    where: {
      marketId: input.marketId,
      userId: input.userId,
      side: input.side,
      amount: input.amount
    }
  });
  if (existing) {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const market = await tx.market.findUniqueOrThrow({
      where: { id: input.marketId }
    });
    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId: input.userId }
    });

    const priorPositions = await tx.marketPosition.count({
      where: {
        userId: input.userId,
        marketId: input.marketId
      }
    });

    const totalPool = market.yesPool + market.noPool;
    const probabilityAtEntry =
      totalPool === 0
        ? 0.5
        : input.side === PositionSide.YES
          ? market.yesPool / totalPool
          : market.noPool / totalPool;
    const updatedWinningPool =
      input.side === PositionSide.YES ? market.yesPool + input.amount : market.noPool + input.amount;
    const updatedLosingPool =
      input.side === PositionSide.YES ? market.noPool : market.yesPool;
    const estimatedReturn =
      updatedWinningPool === 0 ? input.amount : input.amount + Math.floor((input.amount / updatedWinningPool) * updatedLosingPool);

    const position = await tx.marketPosition.create({
      data: {
        marketId: input.marketId,
        userId: input.userId,
        side: input.side,
        amount: input.amount,
        probabilityAtEntry,
        estimatedReturnAtEntry: estimatedReturn
      }
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          decrement: input.amount
        }
      }
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "POSITION_COMMITMENT",
        amount: -input.amount,
        description: `Seeded position on "${market.title}"`,
        marketId: market.id,
        positionId: position.id
      }
    });

    await tx.market.update({
      where: { id: market.id },
      data: {
        yesPool: input.side === PositionSide.YES ? { increment: input.amount } : undefined,
        noPool: input.side === PositionSide.NO ? { increment: input.amount } : undefined,
        totalVolume: { increment: input.amount },
        totalParticipants: priorPositions === 0 ? { increment: 1 } : undefined
      }
    });

    return position;
  });
}

async function seedNumericPosition(input: {
  marketId: string;
  userId: string;
  numericValue: number;
  amount: number;
}) {
  const existing = await prisma.marketPosition.findFirst({
    where: {
      marketId: input.marketId,
      userId: input.userId,
      numericValue: input.numericValue,
      amount: input.amount
    }
  });
  if (existing) {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const market = await tx.market.findUniqueOrThrow({
      where: { id: input.marketId }
    });
    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId: input.userId }
    });

    const priorPositions = await tx.marketPosition.count({
      where: {
        userId: input.userId,
        marketId: input.marketId
      }
    });

    const position = await tx.marketPosition.create({
      data: {
        marketId: input.marketId,
        userId: input.userId,
        numericValue: input.numericValue,
        amount: input.amount
      }
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          decrement: input.amount
        }
      }
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "POSITION_COMMITMENT",
        amount: -input.amount,
        description: `Seeded numeric guess on "${market.title}"`,
        marketId: market.id,
        positionId: position.id
      }
    });

    await tx.market.update({
      where: { id: market.id },
      data: {
        totalVolume: { increment: input.amount },
        totalParticipants: priorPositions === 0 ? { increment: 1 } : undefined
      }
    });

    return position;
  });
}

async function upsertGroup(input: {
  slug: string;
  name: string;
  description?: string;
  inviteCode: string;
  ownerId: string;
  members: Array<{
    userId: string;
    role?: GroupRole;
  }>;
}) {
  const group = await prisma.group.upsert({
    where: { slug: input.slug },
    update: {
      name: input.name,
      description: input.description ?? null,
      inviteCode: input.inviteCode,
      ownerId: input.ownerId,
      isArchived: false
    },
    create: {
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      inviteCode: input.inviteCode,
      ownerId: input.ownerId
    }
  });

  for (const member of input.members) {
    await prisma.groupMembership.upsert({
      where: {
        groupId_userId: {
          groupId: group.id,
          userId: member.userId
        }
      },
      update: {
        role: member.role ?? GroupRole.MEMBER
      },
      create: {
        groupId: group.id,
        userId: member.userId,
        role: member.role ?? GroupRole.MEMBER
      }
    });
  }

  return group;
}

/**
 * Returns the current IST month as 'YYYY-MM'.
 * IST = UTC+5:30.
 */
function getIstMonthString(now?: Date): string {
  const d = now ?? new Date();
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  const yyyy = istDate.getUTCFullYear();
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

/**
 * Seed MonthlyLeagueEntry for every user that has ever made at least one prediction.
 * Places them all in BRONZE for the current IST month.
 * Also sets User.currentLeagueTier = BRONZE for each seeded user.
 * Uses upsert so it is idempotent.
 */
async function seedMonthlyLeagues() {
  const month = getIstMonthString();

  // Find all users with at least one prediction recorded
  const activeUserStats = await prisma.userStat.findMany({
    where: { totalPredictions: { gte: 1 } },
    select: { userId: true }
  });

  // Also seed all users regardless (even with 0 predictions) so the tier badge shows on seed
  const allUsers = await prisma.user.findMany({
    select: { id: true }
  });

  const userIds = allUsers.map((u) => u.id);

  for (const userId of userIds) {
    await prisma.monthlyLeagueEntry.upsert({
      where: { userId_month: { userId, month } },
      update: {},
      create: {
        userId,
        month,
        tier: LeagueTier.BRONZE,
        startingTier: LeagueTier.BRONZE,
        netPointsMonth: 0
      }
    });

    await prisma.user.update({
      where: { id: userId },
      data: { currentLeagueTier: LeagueTier.BRONZE }
    });
  }

  console.log(`Seeded MonthlyLeagueEntry for ${userIds.length} user(s) in BRONZE for month ${month}.`);

  // Suppress unused variable warning for activeUserStats
  void activeUserStats;
}

async function seedFinanceExperts() {
  const v1Organizations = [
    { name: "", organization: "CNBC TV18" },
    { name: "", organization: "HDFC Securities" },
    { name: "", organization: "ICICI Securities" },
    { name: "", organization: "Morgan Stanley India" },
    { name: "", organization: "Goldman Sachs India" },
  ];

  for (const org of v1Organizations) {
    await prisma.expert.upsert({
      where: { name_organization: { name: org.name, organization: org.organization } },
      update: {},
      create: { name: org.name, organization: org.organization, verified: true },
    });
  }
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@predictfuture.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin12345!";

  await seedBadges();
  await seedFinanceExperts();

  // System bot user that owns all markets imported from Manifold.
  // The import script uses this account as creatorId / approvedById.
  await upsertUser({
    email: "archive@manifold.internal",
    username: "manifold-archive",
    password: "ManifoldArchive1!",
    role: "ADMIN"
  });

  const admin = await upsertUser({
    email: adminEmail,
    username: "admin",
    password: adminPassword,
    role: "ADMIN"
  });
  const kira = await upsertUser({
    email: "kira@example.com",
    username: "kira",
    password: "Password123!"
  });
  const devdeep = await upsertUser({
    email: "dev@example.com",
    username: "devdeep",
    password: "Password123!"
  });
  const maya = await upsertUser({
    email: "maya@example.com",
    username: "maya",
    password: "Password123!"
  });

  const officeGroup = await upsertGroup({
    slug: "mumbai-office-forecasters",
    name: "Mumbai Office Forecasters",
    description: "Private office leaderboard for launch deadlines, sports days, and internal bragging rights.",
    inviteCode: "MUMBAI26",
    ownerId: kira.id,
    members: [
      { userId: kira.id, role: GroupRole.OWNER },
      { userId: devdeep.id, role: GroupRole.ADMIN },
      { userId: maya.id, role: GroupRole.MEMBER }
    ]
  });

  const stories: StoryInput[] = [
    {
      headline: "India name unchanged XI ahead of the Mumbai ODI against Australia",
      summary:
        "India retained the same lineup for tomorrow's ODI in Mumbai after training under clear skies. Australia also named a full-strength squad, making the result market a clean sports forecast tied to the official match result.",
      category: "SPORTS",
      sourceName: "ESPN Cricinfo",
      sourceUrl: "https://www.espncricinfo.com/story/india-unchanged-xi-mumbai-odi-2026-04-10",
      sourceHomepageUrl: "https://www.espncricinfo.com",
      imageUrl: "https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=80",
      publishedAt: "2026-04-10T08:15:00.000Z",
      language: "en",
      status: "APPROVED",
      ingestionType: "CURATED",
      externalId: "seed:sports:india-australia-odi-2026-04-10",
      isFeatured: true,
      isTrending: true,
      attachedPrediction: {
        title: "Will India win the Mumbai ODI against Australia on April 11, 2026?",
        description:
          "Resolve YES if India is declared the winner in the official match summary for the ODI played in Mumbai on April 11, 2026.",
        template: "SPORTS_WINNER",
        closeAt: "2025-04-11T08:00:00.000Z",
        resolveAt: "2025-04-11T18:00:00.000Z",
        resolutionSourceType: "SPORTS_API",
        resolutionSourceName: "Official match result feed",
        resolutionSourceUrl: "https://www.espncricinfo.com/series/odi-mumbai-2026-04-11",
        resolutionRuleText:
          "Resolve YES if India is declared the winner in the official scorecard or match summary for the April 11, 2026 ODI in Mumbai.",
        fallbackRuleText:
          "If the primary feed is unavailable, use the organizing board's published result page for the same match."
      }
    },
    {
      headline: "Mumbai forecast calls for a wetter Saturday as humidity rises across the city",
      summary:
        "Forecasters expect moisture to build through Saturday, raising the chance of measurable rainfall in Mumbai. The attached market uses a simple precipitation threshold and resolves against a published weather dataset for the calendar day.",
      category: "WEATHER",
      sourceName: "Reuters",
      sourceUrl: "https://www.reuters.com/world/india/mumbai-wet-weather-outlook-2026-04-10",
      sourceHomepageUrl: "https://www.reuters.com",
      imageUrl: "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1200&q=80",
      publishedAt: "2026-04-10T06:40:00.000Z",
      language: "en",
      status: "APPROVED",
      ingestionType: "API",
      externalId: "seed:weather:mumbai-rainfall-2026-04-10",
      isFeatured: true,
      attachedPrediction: {
        title: "Will Mumbai record at least 2.5 mm rainfall on April 11, 2026?",
        description:
          "Resolve YES if daily rainfall reported for Mumbai between 00:00 and 23:59 IST on April 11, 2026 is at least 2.5 mm.",
        template: "WEATHER_RAINFALL",
        closeAt: "2025-04-11T17:30:00.000Z",
        resolveAt: "2025-04-11T20:30:00.000Z",
        resolutionSourceType: "WEATHER_API",
        resolutionSourceName: "Open-Meteo",
        resolutionRuleText:
          "Resolve YES if the weather source reports daily precipitation of at least 2.5 mm in Mumbai on April 11, 2026.",
        fallbackRuleText:
          "If the API fails, an admin should verify the named source's published daily precipitation total for Mumbai and apply the same threshold.",
        structuredData: {
          cityKey: "mumbai",
          date: "2026-04-11",
          thresholdMm: 2.5
        }
      }
    },
    {
      headline: "Nova Devices says its AI pin will ship before the June deadline after supplier reset",
      summary:
        "Nova Devices told reporters that production has restarted after a supplier issue delayed final assembly. The attached prediction tracks whether the company meets its announced launch deadline using a press release or official shipping announcement.",
      category: "TECH",
      sourceName: "The Verge",
      sourceUrl: "https://www.theverge.com/2026/04/10/nova-devices-ai-pin-june-deadline",
      sourceHomepageUrl: "https://www.theverge.com",
      imageUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
      publishedAt: "2026-04-10T05:20:00.000Z",
      language: "en",
      status: "APPROVED",
      ingestionType: "CURATED",
      externalId: "seed:tech:nova-pin-2026-04-10",
      isTrending: true,
      attachedPrediction: {
        title: "Will Nova Devices launch its AI pin before June 30, 2026?",
        description:
          "Resolve YES if Nova Devices publicly announces the product launch or shipping availability on or before June 30, 2026.",
        template: "PRODUCT_LAUNCH",
        closeAt: "2025-06-30T12:00:00.000Z",
        resolveAt: "2025-06-30T18:30:00.000Z",
        resolutionSourceType: "PRESS_RELEASE",
        resolutionSourceName: "Nova Devices press releases",
        resolutionSourceUrl: "https://news.novadevices.example/press",
        resolutionRuleText:
          "Resolve YES if Nova Devices publishes an official launch, ship, or availability announcement for the AI pin on or before June 30, 2026.",
        fallbackRuleText:
          "If no press release is available, use the company's official newsroom or investor update covering the same deadline."
      }
    },
    {
      headline: "Studio Nova opens strongly, keeping the 100 crore domestic benchmark in sight",
      summary:
        "Studio Nova's latest release posted a robust opening weekend and analysts now focus on whether the film can cross the 100 crore domestic mark before the month ends. The attached forecast resolves against a named box office tracker.",
      category: "ENTERTAINMENT",
      sourceName: "Variety",
      sourceUrl: "https://variety.com/2026/film/asia/studio-nova-opening-weekend-100-crore-123600001",
      sourceHomepageUrl: "https://variety.com",
      imageUrl: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80",
      publishedAt: "2026-04-09T16:00:00.000Z",
      language: "en",
      status: "APPROVED",
      ingestionType: "API",
      externalId: "seed:entertainment:studio-nova-filmx-2026-04-09",
      attachedPrediction: {
        title: "Will Studio Nova's Film X cross 100 crore domestic gross by May 1, 2026?",
        description:
          "Resolve YES if the domestic gross published by the named box office source is at least 100 crore on or before May 1, 2026.",
        template: "BOX_OFFICE_THRESHOLD",
        closeAt: "2025-04-30T18:00:00.000Z",
        resolveAt: "2025-05-01T18:30:00.000Z",
        resolutionSourceType: "BOX_OFFICE_SOURCE",
        resolutionSourceName: "Industry box office tracker",
        resolutionSourceUrl: "https://boxoffice.example/film-x",
        resolutionRuleText:
          "Resolve YES if the named box office tracker publishes a domestic gross of at least 100 crore on or before May 1, 2026.",
        fallbackRuleText:
          "If the tracker is unavailable, resolve using the distributor's official domestic gross disclosure for the same deadline."
      }
    },
    {
      headline: "Inflation cools for a second month as analysts debate the next RBI move",
      summary:
        "India's latest inflation print came in softer than expected, renewing debate around whether policymakers will cut rates at the next decision. The forecast uses the official RBI announcement as the resolution source for an objective deadline.",
      category: "BUSINESS",
      sourceName: "Business Standard",
      sourceUrl: "https://www.business-standard.com/economy/news/inflation-cools-rbi-rate-cut-watch-april-2026",
      sourceHomepageUrl: "https://www.business-standard.com",
      imageUrl: "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1200&q=80",
      publishedAt: "2026-04-09T09:30:00.000Z",
      language: "en",
      status: "APPROVED",
      ingestionType: "CURATED",
      externalId: "seed:business:rbi-rate-cut-2026-04-09",
      isTrending: true,
      attachedPrediction: {
        title: "Will the RBI announce a rate cut before May 31, 2026?",
        description:
          "Resolve YES if the Reserve Bank of India announces a reduction in its policy rate on or before May 31, 2026.",
        template: "COMPANY_ANNOUNCEMENT",
        closeAt: "2025-05-31T11:00:00.000Z",
        resolveAt: "2025-05-31T14:00:00.000Z",
        resolutionSourceType: "PRESS_RELEASE",
        resolutionSourceName: "Reserve Bank of India statements",
        resolutionSourceUrl: "https://www.rbi.org.in",
        resolutionRuleText:
          "Resolve YES if an official RBI statement announces a reduction in the policy rate on or before May 31, 2026.",
        fallbackRuleText:
          "If the press release page is unavailable, resolve using the RBI's official monetary policy summary covering the same period."
      }
    },
    {
      headline: "Acme Mobility says its electric scooter export launch remains on track for July",
      summary:
        "Acme Mobility reiterated its July export timeline during a media briefing, but analysts remain unconvinced after repeated supplier delays. Staff can review this draft story before deciding whether it belongs in the public feed.",
      category: "COMPANY",
      sourceName: "Economic Times",
      sourceUrl: "https://economictimes.indiatimes.com/industry/auto/acme-mobility-export-launch-july-2026/articleshow/120001234.cms",
      sourceHomepageUrl: "https://economictimes.indiatimes.com",
      publishedAt: "2026-04-10T07:00:00.000Z",
      language: "en",
      status: "DRAFT",
      ingestionType: "MANUAL",
      externalId: "seed:company:acme-export-2026-04-10",
      attachedPrediction: {
        title: "Will Acme Mobility begin electric scooter exports before July 31, 2026?",
        description:
          "Resolve YES if Acme Mobility publicly confirms that export deliveries have begun on or before July 31, 2026.",
        template: "PRODUCT_LAUNCH",
        closeAt: "2025-07-31T12:00:00.000Z",
        resolveAt: "2025-07-31T18:00:00.000Z",
        resolutionSourceType: "PRESS_RELEASE",
        resolutionSourceName: "Acme Mobility press releases",
        resolutionSourceUrl: "https://acmemobility.example/newsroom",
        resolutionRuleText:
          "Resolve YES if Acme Mobility publishes an official announcement confirming export deliveries started on or before July 31, 2026.",
        fallbackRuleText:
          "If the newsroom is unavailable, use a stock exchange filing or official investor update confirming the same event."
      }
    }
  ];

  await ingestStories(stories, admin.id);

  const seededStories = await prisma.story.findMany({
    where: {
      sourceUrl: {
        in: stories.map((story) => story.sourceUrl)
      }
    },
    include: {
      market: true
    }
  });

  const storyBySourceUrl = new Map(seededStories.map((story) => [story.sourceUrl, story]));
  const openSportsStory = storyBySourceUrl.get(stories[0].sourceUrl);
  const weatherStory = storyBySourceUrl.get(stories[1].sourceUrl);
  const techStory = storyBySourceUrl.get(stories[2].sourceUrl);
  const entertainmentStory = storyBySourceUrl.get(stories[3].sourceUrl);
  const businessStory = storyBySourceUrl.get(stories[4].sourceUrl);
  const pendingReviewStory = storyBySourceUrl.get(stories[5].sourceUrl);

  if (
    !openSportsStory?.market ||
    !weatherStory?.market ||
    !techStory?.market ||
    !entertainmentStory?.market ||
    !businessStory?.market
  ) {
    throw new Error("Seed stories did not create expected prediction markets.");
  }

  const privateMarket = await prisma.market.upsert({
    where: {
      slug: "nova-office-laptop-launch-2026"
    },
    update: {
      title: "Will Nova Devices reveal the new office laptop before June 15, 2026?",
      description:
        "Private office prediction for the Mumbai team. Resolve YES if Nova Devices publicly confirms the laptop reveal before June 15, 2026.",
      category: MarketCategory.TECH,
      template: MarketTemplate.CUSTOM,
      creatorId: kira.id,
      visibility: MarketVisibility.PRIVATE,
      groupId: officeGroup.id,
      status: MarketStatus.OPEN,
      closeAt: new Date("2025-06-15T09:00:00.000Z"),
      resolveAt: new Date("2025-06-15T18:00:00.000Z"),
      resolutionMode: ResolutionMode.HOST,
      resolutionStatus: "OPEN",
      resolutionSourceType: "MANUAL",
      resolutionSourceName: "Host resolution",
      resolutionSourceUrl: null,
      resolutionRuleText:
        "Resolve YES if Nova Devices publicly reveals the office laptop before June 15, 2026 according to the pre-agreed host review in the group.",
      fallbackRuleText:
        "If the host cannot resolve cleanly, cancel the market and refund everyone in the group.",
      creatorReputationSnapshot: kira.reputationScore,
      poolRewardMode: PoolRewardMode.COMMISSION_BASED,
      hostCommissionBps: 200,
      bondCap: 500,
      lockedBondAmount: 500,
      currentRequiredBond: 0,
      dynamicPoolEnabled: false,
      maxPoolAllowed: 25000
    },
    create: {
      slug: "nova-office-laptop-launch-2026",
      title: "Will Nova Devices reveal the new office laptop before June 15, 2026?",
      description:
        "Private office prediction for the Mumbai team. Resolve YES if Nova Devices publicly confirms the laptop reveal before June 15, 2026.",
      category: MarketCategory.TECH,
      template: MarketTemplate.CUSTOM,
      creatorId: kira.id,
      visibility: MarketVisibility.PRIVATE,
      groupId: officeGroup.id,
      status: MarketStatus.OPEN,
      closeAt: new Date("2025-06-15T09:00:00.000Z"),
      resolveAt: new Date("2025-06-15T18:00:00.000Z"),
      resolutionMode: ResolutionMode.HOST,
      resolutionStatus: "OPEN",
      resolutionSourceType: "MANUAL",
      resolutionSourceName: "Host resolution",
      resolutionSourceUrl: null,
      resolutionRuleText:
        "Resolve YES if Nova Devices publicly reveals the office laptop before June 15, 2026 according to the pre-agreed host review in the group.",
      fallbackRuleText:
        "If the host cannot resolve cleanly, cancel the market and refund everyone in the group.",
      creatorReputationSnapshot: kira.reputationScore,
      poolRewardMode: PoolRewardMode.COMMISSION_BASED,
      hostCommissionBps: 200,
      bondCap: 500,
      lockedBondAmount: 500,
      currentRequiredBond: 0,
      dynamicPoolEnabled: false,
      maxPoolAllowed: 25000
    }
  });

  const numericPrivateMarket = await prisma.market.upsert({
    where: {
      slug: "mumbai-office-ai-deal-size-guess-2026"
    },
    update: {
      title: "How many enterprise AI deals will the Mumbai office close in Q3 2026?",
      description:
        "Private numeric challenge. The host submits the final closed-deal count after the quarter ends, and the closest guesses win automatically.",
      category: MarketCategory.BUSINESS,
      template: MarketTemplate.CUSTOM,
      creatorId: kira.id,
      visibility: MarketVisibility.PRIVATE,
      groupId: officeGroup.id,
      resolutionRuleText:
        "Resolve using the final Q3 2026 closed-deal count from the team's internal tracker. The host must submit the actual number with a note and evidence summary.",
      fallbackRuleText:
        "If the host cannot provide the final count before the grace deadline, cancel and refund the market.",
      resolutionSourceName: "Host resolution",
      resolutionSourceType: "MANUAL",
      marketType: MarketType.NUMERIC,
      unit: "deals",
      minValue: 0,
      maxValue: 50,
      precision: 0,
      winnersCount: 3,
      payoutDistributionJson: [50, 30, 20],
      tieBreakerRule: NumericTieBreakerRule.SPLIT,
      challengeWindowHours: 24,
      gracePeriodHours: 48,
      creatorReputationSnapshot: kira.reputationScore,
      poolRewardMode: PoolRewardMode.BOND_BASED,
      hostCommissionBps: 0,
      bondCap: 400,
      lockedBondAmount: 400,
      currentRequiredBond: 400,
      dynamicPoolEnabled: false,
      maxPoolAllowed: null
    },
    create: {
      slug: "mumbai-office-ai-deal-size-guess-2026",
      title: "How many enterprise AI deals will the Mumbai office close in Q3 2026?",
      description:
        "Private numeric challenge. The host submits the final closed-deal count after the quarter ends, and the closest guesses win automatically.",
      category: MarketCategory.BUSINESS,
      template: MarketTemplate.CUSTOM,
      creatorId: kira.id,
      visibility: MarketVisibility.PRIVATE,
      groupId: officeGroup.id,
      status: MarketStatus.OPEN,
      closeAt: new Date("2025-07-01T12:00:00.000Z"),
      resolveAt: new Date("2025-10-02T12:00:00.000Z"),
      resolutionMode: ResolutionMode.HOST,
      resolutionStatus: "OPEN",
      resolutionSourceType: "MANUAL",
      resolutionSourceName: "Host resolution",
      resolutionSourceUrl: null,
      resolutionRuleText:
        "Resolve using the final Q3 2026 closed-deal count from the team's internal tracker. The host must submit the actual number with a note and evidence summary.",
      fallbackRuleText:
        "If the host cannot provide the final count before the grace deadline, cancel and refund the market.",
      marketType: MarketType.NUMERIC,
      unit: "deals",
      minValue: 0,
      maxValue: 50,
      precision: 0,
      winnersCount: 3,
      payoutDistributionJson: [50, 30, 20],
      tieBreakerRule: NumericTieBreakerRule.SPLIT,
      challengeWindowHours: 24,
      gracePeriodHours: 48,
      creatorReputationSnapshot: kira.reputationScore,
      poolRewardMode: PoolRewardMode.BOND_BASED,
      hostCommissionBps: 0,
      bondCap: 400,
      lockedBondAmount: 400,
      currentRequiredBond: 400,
      dynamicPoolEnabled: false,
      maxPoolAllowed: null
    }
  });

  const hostedHistoryBinaryMarket = await prisma.market.upsert({
    where: {
      slug: "mumbai-office-hardware-pilot-may-2026"
    },
    update: {
      title: "Will the office hardware pilot launch before May 20, 2026?",
      description:
        "Historical private host market used to establish trust. Resolve YES if the team pilot started before May 20, 2026.",
      category: MarketCategory.TECH,
      template: MarketTemplate.CUSTOM,
      creatorId: kira.id,
      visibility: MarketVisibility.PRIVATE,
      groupId: officeGroup.id,
      resolutionRuleText:
        "Resolve YES if the pilot kickoff was recorded on or before May 20, 2026 in the internal launch tracker.",
      fallbackRuleText:
        "If the tracker entry is unclear, cancel and refund the market.",
      resolutionSourceName: "Host resolution",
      resolutionSourceType: "MANUAL",
      creatorReputationSnapshot: kira.reputationScore,
      challengeWindowHours: 24,
      gracePeriodHours: 48,
      status: MarketStatus.CLOSED,
      closeAt: new Date("2025-05-19T09:00:00.000Z"),
      resolveAt: new Date("2025-05-20T18:00:00.000Z"),
    },
    create: {
      slug: "mumbai-office-hardware-pilot-may-2026",
      title: "Will the office hardware pilot launch before May 20, 2026?",
      description:
        "Historical private host market used to establish trust. Resolve YES if the team pilot started before May 20, 2026.",
      category: MarketCategory.TECH,
      template: MarketTemplate.CUSTOM,
      creatorId: kira.id,
      visibility: MarketVisibility.PRIVATE,
      groupId: officeGroup.id,
      status: MarketStatus.CLOSED,
      closeAt: new Date("2025-05-19T09:00:00.000Z"),
      resolveAt: new Date("2025-05-20T18:00:00.000Z"),
      resolutionMode: ResolutionMode.HOST,
      resolutionStatus: "OPEN",
      resolutionSourceType: "MANUAL",
      resolutionSourceName: "Host resolution",
      resolutionSourceUrl: null,
      resolutionRuleText:
        "Resolve YES if the pilot kickoff was recorded on or before May 20, 2026 in the internal launch tracker.",
      fallbackRuleText:
        "If the tracker entry is unclear, cancel and refund the market.",
      creatorReputationSnapshot: kira.reputationScore,
      challengeWindowHours: 24,
      gracePeriodHours: 48
    }
  });

  const hostedHistoryNumericMarket = await prisma.market.upsert({
    where: {
      slug: "mumbai-office-q2-ticket-backlog-guess-2026"
    },
    update: {
      title: "How many unresolved tickets will the office backlog have at Q2 close?",
      description:
        "Historical private numeric market used to establish trust. Closest backlog guesses win after the host submits the final count.",
      category: MarketCategory.BUSINESS,
      template: MarketTemplate.CUSTOM,
      creatorId: kira.id,
      visibility: MarketVisibility.PRIVATE,
      groupId: officeGroup.id,
      resolutionRuleText:
        "Resolve with the final unresolved-ticket count from the Q2 close report. The host submits the actual value and evidence summary.",
      fallbackRuleText:
        "If the final count cannot be confirmed, cancel and refund the market.",
      resolutionSourceName: "Host resolution",
      resolutionSourceType: "MANUAL",
      marketType: MarketType.NUMERIC,
      unit: "tickets",
      minValue: 0,
      maxValue: 500,
      precision: 0,
      winnersCount: 2,
      payoutDistributionJson: [70, 30],
      tieBreakerRule: NumericTieBreakerRule.EARLIEST,
      challengeWindowHours: 24,
      gracePeriodHours: 48,
      creatorReputationSnapshot: kira.reputationScore,
      status: MarketStatus.CLOSED,
      closeAt: new Date("2025-06-29T12:00:00.000Z"),
      resolveAt: new Date("2025-06-30T18:00:00.000Z"),
    },
    create: {
      slug: "mumbai-office-q2-ticket-backlog-guess-2026",
      title: "How many unresolved tickets will the office backlog have at Q2 close?",
      description:
        "Historical private numeric market used to establish trust. Closest backlog guesses win after the host submits the final count.",
      category: MarketCategory.BUSINESS,
      template: MarketTemplate.CUSTOM,
      creatorId: kira.id,
      visibility: MarketVisibility.PRIVATE,
      groupId: officeGroup.id,
      status: MarketStatus.CLOSED,
      closeAt: new Date("2025-06-29T12:00:00.000Z"),
      resolveAt: new Date("2025-06-30T18:00:00.000Z"),
      resolutionMode: ResolutionMode.HOST,
      resolutionStatus: "OPEN",
      resolutionSourceType: "MANUAL",
      resolutionSourceName: "Host resolution",
      resolutionSourceUrl: null,
      resolutionRuleText:
        "Resolve with the final unresolved-ticket count from the Q2 close report. The host submits the actual value and evidence summary.",
      fallbackRuleText:
        "If the final count cannot be confirmed, cancel and refund the market.",
      marketType: MarketType.NUMERIC,
      unit: "tickets",
      minValue: 0,
      maxValue: 500,
      precision: 0,
      winnersCount: 2,
      payoutDistributionJson: [70, 30],
      tieBreakerRule: NumericTieBreakerRule.EARLIEST,
      challengeWindowHours: 24,
      gracePeriodHours: 48,
      creatorReputationSnapshot: kira.reputationScore
    }
  });

  const trustedHostMarket = await prisma.market.upsert({
    where: {
      slug: "global-ai-chip-export-window-2026"
    },
    update: {
      title: "Will Nova Devices begin AI chip exports before July 31, 2026?",
      description:
        "Public trusted-host market. The host must resolve using the written rule, cannot take a position, and faces review if participants challenge the outcome.",
      category: MarketCategory.TECH,
      template: MarketTemplate.CUSTOM,
      creatorId: admin.id,
      visibility: MarketVisibility.PUBLIC,
      groupId: null,
      status: MarketStatus.CLOSED,
      closeAt: new Date("2025-07-30T18:00:00.000Z"),
      resolveAt: new Date("2025-07-31T18:00:00.000Z"),
      resolutionMode: ResolutionMode.TRUSTED_HOST,
      resolutionStatus: "OPEN",
      resolutionSourceType: "MANUAL",
      resolutionSourceName: "Trusted host resolution",
      resolutionSourceUrl: null,
      resolutionRuleText:
        "Resolve YES if Nova Devices publicly confirms export shipments of its AI chip before July 31, 2026. The host must attach a note and evidence link when resolving.",
      fallbackRuleText:
        "If the host cannot provide a clear source-backed outcome, moderators should review and cancel if the written rule cannot be applied cleanly.",
      creatorReputationSnapshot: admin.reputationScore,
      poolRewardMode: PoolRewardMode.COMMISSION_BASED,
      hostCommissionBps: 200,
      bondCap: 600,
      lockedBondAmount: 600,
      currentRequiredBond: 0,
      dynamicPoolEnabled: false,
      maxPoolAllowed: 30000,
      outcome: "UNRESOLVED",
      finalizationAt: null,
      challengeWindowEndsAt: null,
      hostResolutionNote: null,
      hostResolutionEvidenceJson: Prisma.DbNull,
      resolutionFinalizedById: null,
      overturnedReason: null
    },
    create: {
      slug: "global-ai-chip-export-window-2026",
      title: "Will Nova Devices begin AI chip exports before July 31, 2026?",
      description:
        "Public trusted-host market. The host must resolve using the written rule, cannot take a position, and faces review if participants challenge the outcome.",
      category: MarketCategory.TECH,
      template: MarketTemplate.CUSTOM,
      creatorId: admin.id,
      visibility: MarketVisibility.PUBLIC,
      status: MarketStatus.CLOSED,
      closeAt: new Date("2025-07-30T18:00:00.000Z"),
      resolveAt: new Date("2025-07-31T18:00:00.000Z"),
      resolutionMode: ResolutionMode.TRUSTED_HOST,
      resolutionStatus: "OPEN",
      resolutionSourceType: "MANUAL",
      resolutionSourceName: "Trusted host resolution",
      resolutionSourceUrl: null,
      resolutionRuleText:
        "Resolve YES if Nova Devices publicly confirms export shipments of its AI chip before July 31, 2026. The host must attach a note and evidence link when resolving.",
      fallbackRuleText:
        "If the host cannot provide a clear source-backed outcome, moderators should review and cancel if the written rule cannot be applied cleanly.",
      creatorReputationSnapshot: admin.reputationScore,
      poolRewardMode: PoolRewardMode.COMMISSION_BASED,
      hostCommissionBps: 200,
      bondCap: 600,
      lockedBondAmount: 600,
      currentRequiredBond: 0,
      dynamicPoolEnabled: false,
      maxPoolAllowed: 30000
    }
  });

  await seedPosition({
    marketId: openSportsStory.market.id,
    userId: kira.id,
    side: PositionSide.YES,
    amount: 1200
  });
  await seedPosition({
    marketId: openSportsStory.market.id,
    userId: devdeep.id,
    side: PositionSide.NO,
    amount: 900
  });
  await seedPosition({
    marketId: openSportsStory.market.id,
    userId: maya.id,
    side: PositionSide.YES,
    amount: 1500
  });

  await seedPosition({
    marketId: weatherStory.market.id,
    userId: kira.id,
    side: PositionSide.NO,
    amount: 800
  });
  await seedPosition({
    marketId: weatherStory.market.id,
    userId: maya.id,
    side: PositionSide.YES,
    amount: 1100
  });

  await seedPosition({
    marketId: techStory.market.id,
    userId: devdeep.id,
    side: PositionSide.YES,
    amount: 1400
  });
  await seedPosition({
    marketId: techStory.market.id,
    userId: admin.id,
    side: PositionSide.NO,
    amount: 700
  });

  await seedPosition({
    marketId: entertainmentStory.market.id,
    userId: kira.id,
    side: PositionSide.YES,
    amount: 1000
  });
  await seedPosition({
    marketId: entertainmentStory.market.id,
    userId: maya.id,
    side: PositionSide.NO,
    amount: 600
  });

  await seedPosition({
    marketId: businessStory.market.id,
    userId: kira.id,
    side: PositionSide.NO,
    amount: 900
  });
  await seedPosition({
    marketId: businessStory.market.id,
    userId: devdeep.id,
    side: PositionSide.YES,
    amount: 1300
  });
  await seedPosition({
    marketId: businessStory.market.id,
    userId: maya.id,
    side: PositionSide.NO,
    amount: 700
  });
  await seedPosition({
    marketId: privateMarket.id,
    userId: devdeep.id,
    side: PositionSide.YES,
    amount: 500
  });
  await seedPosition({
    marketId: privateMarket.id,
    userId: maya.id,
    side: PositionSide.NO,
    amount: 400
  });
  await seedPosition({
    marketId: trustedHostMarket.id,
    userId: kira.id,
    side: PositionSide.YES,
    amount: 1000
  });
  await seedPosition({
    marketId: trustedHostMarket.id,
    userId: devdeep.id,
    side: PositionSide.NO,
    amount: 850
  });
  await seedPosition({
    marketId: trustedHostMarket.id,
    userId: maya.id,
    side: PositionSide.YES,
    amount: 650
  });
  await seedNumericPosition({
    marketId: numericPrivateMarket.id,
    userId: devdeep.id,
    numericValue: 19,
    amount: 700
  });
  await seedNumericPosition({
    marketId: numericPrivateMarket.id,
    userId: maya.id,
    numericValue: 23,
    amount: 850
  });
  await seedPosition({
    marketId: hostedHistoryBinaryMarket.id,
    userId: devdeep.id,
    side: PositionSide.YES,
    amount: 600
  });
  await seedPosition({
    marketId: hostedHistoryBinaryMarket.id,
    userId: maya.id,
    side: PositionSide.NO,
    amount: 700
  });
  await seedNumericPosition({
    marketId: hostedHistoryNumericMarket.id,
    userId: devdeep.id,
    numericValue: 134,
    amount: 650
  });
  await seedNumericPosition({
    marketId: hostedHistoryNumericMarket.id,
    userId: maya.id,
    numericValue: 141,
    amount: 650
  });

  const existingResolution = await prisma.marketResolution.findUnique({
    where: {
      marketId: businessStory.market.id
    }
  });

  if (!existingResolution) {
    await prisma.market.update({
      where: { id: businessStory.market.id },
      data: {
        status: "CLOSED"
      }
    });

    await finalizeMarketResolution({
      marketId: businessStory.market.id,
      outcome: "NO",
      sourceName: "Reserve Bank of India statements",
      sourceUrl: "https://www.rbi.org.in",
      explanation:
        "The RBI did not announce a rate cut before May 31, 2026, so the story-linked market resolves NO.",
      resolvedById: admin.id,
      automated: false,
      auditData: {
        resolvedFromSeed: true,
        decisionWindow: "2026-05-31"
      }
    });
  }

  const trustedHostResolution = await prisma.marketResolution.findUnique({
    where: {
      marketId: trustedHostMarket.id
    }
  });

  if (!trustedHostResolution) {
    await prisma.market.update({
      where: { id: trustedHostMarket.id },
      data: {
        status: "CLOSED",
        resolutionStatus: "CLOSED",
        outcome: "UNRESOLVED"
      }
    });

    await submitHostMarketResolution({
      marketId: trustedHostMarket.id,
      hostUserId: admin.id,
      outcome: "YES",
      resolutionNote:
        "The host reviewed Nova Devices' newsroom post and marked the market YES based on the announced export start date.",
      evidenceText:
        "Company newsroom update said the first export batch shipped before the deadline.",
      evidenceUrl: "https://news.novadevices.example/exports/first-batch"
    });
  }

  const trustedHostChallenges = await prisma.challenge.count({
    where: {
      marketId: trustedHostMarket.id
    }
  });

  if (trustedHostChallenges === 0) {
    await submitMarketChallenge({
      marketId: trustedHostMarket.id,
      challengerUserId: kira.id,
      reasonText:
        "The evidence link does not clearly show the shipment date. Moderator review is needed before finalization.",
      evidenceText:
        "The press note mentions launch readiness but the export shipment timestamp is ambiguous.",
      evidenceUrl: "https://community.example/nova-exports-review"
    });
  }

  const hostedHistoryBinaryResolution = await prisma.marketResolution.findUnique({
    where: {
      marketId: hostedHistoryBinaryMarket.id
    }
  });

  if (!hostedHistoryBinaryResolution) {
    await submitHostMarketResolution({
      marketId: hostedHistoryBinaryMarket.id,
      hostUserId: kira.id,
      outcome: "YES",
      resolutionNote:
        "The internal launch tracker recorded the pilot kickoff before the May 20 deadline, so the market resolves YES.",
      evidenceText:
        "Pilot kickoff entry in the internal tracker showed the launch date as May 18, 2026.",
      evidenceUrl: "https://intranet.example/pilot-tracker/hardware-kickoff"
    });
  }

  const hostedHistoryBinaryMarketState = await prisma.market.findUniqueOrThrow({
    where: { id: hostedHistoryBinaryMarket.id },
    select: {
      resolutionStatus: true
    }
  });

  if (hostedHistoryBinaryMarketState.resolutionStatus !== "FINALIZED") {
    await upholdTrustedHostResolution({
      marketId: hostedHistoryBinaryMarket.id,
      actorId: admin.id,
      explanation: "Host note and evidence match the written rule. Finalizing the private host market."
    });
  }

  const hostedHistoryNumericResolution = await prisma.marketResolution.findUnique({
    where: {
      marketId: hostedHistoryNumericMarket.id
    }
  });

  if (!hostedHistoryNumericResolution) {
    await submitHostMarketResolution({
      marketId: hostedHistoryNumericMarket.id,
      hostUserId: kira.id,
      actualValue: 138,
      resolutionNote:
        "The Q2 close report listed 138 unresolved tickets. The system should now rank the closest guesses automatically.",
      evidenceText:
        "Quarter-end backlog summary confirmed the unresolved ticket count at 138.",
      evidenceUrl: "https://intranet.example/q2-backlog-summary"
    });
  }

  const hostedHistoryNumericMarketState = await prisma.market.findUniqueOrThrow({
    where: { id: hostedHistoryNumericMarket.id },
    select: {
      resolutionStatus: true
    }
  });

  if (hostedHistoryNumericMarketState.resolutionStatus !== "FINALIZED") {
    await upholdTrustedHostResolution({
      marketId: hostedHistoryNumericMarket.id,
      actorId: admin.id,
      explanation:
        "Host evidence matches the recorded Q2 backlog figure. Finalizing the numeric private host market."
    });
  }

  const openSportsComments = await prisma.marketComment.count({
    where: {
      marketId: openSportsStory.market.id
    }
  });

  if (openSportsComments === 0) {
    await prisma.marketComment.createMany({
      data: [
        {
          marketId: openSportsStory.market.id,
          userId: kira.id,
          body: "This is the kind of story card that works well in the swipe feed: quick context, clean question."
        },
        {
          marketId: openSportsStory.market.id,
          userId: maya.id,
          body: "Source is clear and the market closes before first ball. Good structure."
        }
      ]
    });
  }

  const weatherComments = await prisma.marketComment.count({
    where: {
      marketId: weatherStory.market.id
    }
  });

  if (weatherComments === 0) {
    await prisma.marketComment.create({
      data: {
        marketId: weatherStory.market.id,
        userId: devdeep.id,
        body: "Threshold-based weather stories feel fair because the rule is explicit and measurable."
      }
    });
  }

  const reportCount = await prisma.marketReport.count({
    where: {
      marketId: techStory.market.id
    }
  });

  if (reportCount === 0) {
    await prisma.marketReport.create({
      data: {
        reporterId: kira.id,
        marketId: techStory.market.id,
        reason: "Looks good overall, but the summary may need a shorter second sentence for the feed.",
        status: "OPEN"
      }
    });
  }

  const curatedFeeds = [
    {
      slug: "for-you",
      title: "For You",
      description: "Featured and personalized story cards.",
      feedType: "FOR_YOU",
      stories: [openSportsStory.id, weatherStory.id, techStory.id, entertainmentStory.id]
    },
    {
      slug: "latest",
      title: "Latest",
      description: "Newest published stories with attached markets.",
      feedType: "LATEST",
      stories: [openSportsStory.id, weatherStory.id, techStory.id, entertainmentStory.id, businessStory.id]
    },
    {
      slug: "trending",
      title: "Trending",
      description: "Most active story-linked predictions right now.",
      feedType: "TRENDING",
      stories: [openSportsStory.id, techStory.id, businessStory.id]
    },
    {
      slug: "resolved",
      title: "Resolved",
      description: "Recently settled story outcomes.",
      feedType: "RESOLVED",
      stories: [businessStory.id]
    },
    {
      slug: "mirror-featured",
      title: "Mirror featured",
      description: "Glanceable featured story for mirror mode.",
      feedType: "MIRROR_FEATURED",
      stories: [openSportsStory.id]
    }
  ] as const;

  for (const feed of curatedFeeds) {
    const createdFeed = await prisma.curatedFeed.upsert({
      where: { slug: feed.slug },
      update: {
        title: feed.title,
        description: feed.description,
        feedType: feed.feedType
      },
      create: {
        slug: feed.slug,
        title: feed.title,
        description: feed.description,
        feedType: feed.feedType
      }
    });

    for (const [index, storyId] of feed.stories.entries()) {
      await prisma.curatedFeedItem.upsert({
        where: {
          feedId_storyId: {
            feedId: createdFeed.id,
            storyId
          }
        },
        update: {
          position: index + 1
        },
        create: {
          feedId: createdFeed.id,
          storyId,
          position: index + 1
        }
      });
    }
  }

  const storyNotifications = await prisma.notification.count();
  if (storyNotifications === 0) {
    await prisma.notification.createMany({
      data: [
        {
          userId: kira.id,
          storyId: openSportsStory.id,
          marketId: openSportsStory.market.id,
          type: "SYSTEM",
          title: "Your feed is ready",
          body: "Start swiping through the latest stories and make your first prediction.",
          href: "/feed"
        },
        {
          userId: admin.id,
          storyId: pendingReviewStory?.id ?? null,
          marketId: pendingReviewStory?.market?.id ?? null,
          type: "SYSTEM",
          title: "Story review queue updated",
          body: "A new story is waiting for staff review before it can enter the public feed.",
          href: "/admin/moderation"
        }
      ]
    });
  }

  for (const user of [admin, kira, devdeep, maya]) {
    await prisma.$transaction(async (tx) => {
      await refreshUserStats(tx, user.id);
    });
  }

  // ── Monthly Leagues: seed all users into BRONZE for current IST month ────────
  await seedMonthlyLeagues();

  // ── Finance: Market Event Clusters (demo data) ──────────────────────────────
  const clusters = [
    {
      slug: "q4-fy25-earnings",
      name: "Q4 FY25 Earnings Week",
      description: "Quarterly results for Nifty 50 companies. Watch for surprises.",
      startsAt: new Date("2026-04-15"),
      endsAt: new Date("2026-05-15"),
      bannerEmoji: "📊",
      category: "FINANCE" as const,
    },
    {
      slug: "may-2026-rbi-policy",
      name: "May 2026 RBI Policy Day",
      description: "Reserve Bank of India MPC rate decision and forward guidance.",
      startsAt: new Date("2026-06-04"),
      endsAt: new Date("2026-06-06"),
      bannerEmoji: "🏦",
      category: "FINANCE" as const,
    },
    {
      slug: "union-budget-2026",
      name: "Union Budget 2026",
      description: "Full-year Union Budget presentation and market reaction.",
      startsAt: new Date("2026-07-01"),
      endsAt: new Date("2026-07-03"),
      bannerEmoji: "📋",
      category: "FINANCE" as const,
    },
  ];

  // Data panels for each cluster (S18-T2)
  const clusterDataPoints: Record<string, Prisma.InputJsonValue> = {
    "q4-fy25-earnings": [
      { label: "Reliance Industries", value: "EPS consensus ₹22.4", date: "2026-05-09" },
      { label: "TCS", value: "EPS consensus ₹118.6", date: "2026-05-12" },
      { label: "HDFC Bank", value: "EPS consensus ₹22.1", date: "2026-05-10" },
      { label: "Infosys", value: "Revenue guidance: flat to +1%", date: "2026-05-14" },
      { label: "Bajaj Finance", value: "AUM growth est. 26% YoY", date: "2026-05-15" },
    ],
    "may-2026-rbi-policy": [
      { label: "Decision date", value: "4 Jun 2026" },
      { label: "Repo rate held since", value: "Aug 2024" },
      { label: "Last move", value: "+0.25% to 6.50%" },
      { label: "Market consensus", value: "Hold (78% probability)" },
    ],
    "union-budget-2026": [
      { label: "Budget date", value: "1 Feb 2026", subtext: "Already presented" },
      { label: "GDP growth target", value: "6.5%" },
      { label: "Fiscal deficit target", value: "4.5% of GDP" },
      { label: "Key sectors", value: "Infra, Defence, Green Energy" },
    ],
  };

  for (const cluster of clusters) {
    await prisma.marketEventCluster.upsert({
      where: { slug: cluster.slug },
      update: { dataPoints: clusterDataPoints[cluster.slug] ?? Prisma.JsonNull },
      create: { ...cluster, dataPoints: clusterDataPoints[cluster.slug] ?? Prisma.JsonNull },
    });
  }
  console.log("Seeded 3 MarketEventCluster rows with dataPoints.");

  // Backfill: assign any existing FINANCE markets to the Q4 FY25 cluster if closeAt falls in window
  // TODO: assign to cluster manually via admin UI for production data
  const q4Cluster = await prisma.marketEventCluster.findUnique({
    where: { slug: "q4-fy25-earnings" },
  });
  if (q4Cluster) {
    await prisma.market.updateMany({
      where: {
        category: "FINANCE",
        eventClusterId: null,
        closeAt: { gte: q4Cluster.startsAt, lte: q4Cluster.endsAt },
      },
      data: { eventClusterId: q4Cluster.id },
    });
  }

  // ── S18-T4: Backfill expert opinions → event cluster tags ─────────────────
  const rbiCluster = await prisma.marketEventCluster.findUnique({
    where: { slug: "may-2026-rbi-policy" },
  });
  const earningsCluster = await prisma.marketEventCluster.findUnique({
    where: { slug: "q4-fy25-earnings" },
  });

  if (rbiCluster) {
    // Tag opinions whose story headline mentions RBI / repo rate / monetary policy
    const rbiOpinions = await prisma.expertOpinion.findMany({
      where: {
        eventClusterId: null,
        story: {
          headline: {
            contains: "RBI",
            mode: "insensitive",
          },
        },
      },
      select: { id: true },
    });
    const rbiOpinions2 = await prisma.expertOpinion.findMany({
      where: {
        eventClusterId: null,
        story: {
          headline: {
            contains: "repo rate",
            mode: "insensitive",
          },
        },
      },
      select: { id: true },
    });
    const rbiOpinions3 = await prisma.expertOpinion.findMany({
      where: {
        eventClusterId: null,
        story: {
          headline: {
            contains: "monetary policy",
            mode: "insensitive",
          },
        },
      },
      select: { id: true },
    });
    const rbiIds = [...new Set([...rbiOpinions, ...rbiOpinions2, ...rbiOpinions3].map((o) => o.id))];
    if (rbiIds.length > 0) {
      await prisma.expertOpinion.updateMany({
        where: { id: { in: rbiIds } },
        data: { eventClusterId: rbiCluster.id },
      });
      console.log(`Tagged ${rbiIds.length} opinion(s) to RBI Policy cluster.`);
    }
  }

  if (earningsCluster) {
    // Tag opinions whose story headline mentions Reliance / Q4 / earnings
    const earningsKeywords = ["Reliance", "Q4", "earnings", "Earnings"];
    const earningsOpinionSets = await Promise.all(
      earningsKeywords.map((keyword) =>
        prisma.expertOpinion.findMany({
          where: {
            eventClusterId: null,
            story: {
              headline: { contains: keyword, mode: "insensitive" },
            },
          },
          select: { id: true },
        })
      )
    );
    const earningsIds = [...new Set(earningsOpinionSets.flat().map((o) => o.id))];
    if (earningsIds.length > 0) {
      await prisma.expertOpinion.updateMany({
        where: { id: { in: earningsIds } },
        data: { eventClusterId: earningsCluster.id },
      });
      console.log(`Tagged ${earningsIds.length} opinion(s) to Q4 Earnings cluster.`);
    }
  }

  // ── S28-T4: Seed resolved ExpertOpinion records for Crowd-vs-Experts card ────
  await seedResolvedExpertOpinions();

  // ── S29-T2: Seed LeaderboardSnapshot rows so QA can verify rank delta badges
  // without waiting a week for the Sunday cron to fire.
  await seedLeaderboardSnapshots();

  // Backfill referral codes for any users that were created before S24-T6.
  await backfillReferralCodes();

  console.log("Seed complete.");
}

/**
 * S28-T4: Seed 10+ resolved ExpertOpinion records (5 HIT, 5 MISS) so the
 * CrowdVsExpertsCard in the Finance tab has data to display in QA/dev.
 * Uses upsert logic based on (sourceUrl, expertId, publishedAt) to remain
 * idempotent across re-runs.
 */
async function seedResolvedExpertOpinions() {
  // Find existing experts to attach opinions to
  const experts = await prisma.expert.findMany({
    take: 5,
    select: { id: true, name: true, organization: true },
  });

  if (experts.length === 0) {
    console.log("Skipping resolved opinion seed — no experts found.");
    return;
  }

  const resolvedOpinionsData: Array<{
    expertId: string;
    quote: string;
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    sourceUrl: string;
    publishedAt: Date;
    resolutionStatus: "RESOLVED_HIT" | "RESOLVED_MISS";
    resolvedAt: Date;
    resolutionNote: string;
    isSourceAttribution: boolean;
  }> = [
    // 5 HIT opinions
    {
      expertId: experts[0 % experts.length].id,
      quote: "Nifty 50 will cross 22,500 by Q1 end driven by FII inflows and strong corporate earnings.",
      direction: "BULLISH",
      sourceUrl: "https://economictimes.indiatimes.com/markets/stocks/news/nifty-forecast-q1",
      publishedAt: new Date("2026-01-10"),
      resolutionStatus: "RESOLVED_HIT",
      resolvedAt: new Date("2026-03-31"),
      resolutionNote: "Nifty crossed 22,500 on March 28.",
      isSourceAttribution: false,
    },
    {
      expertId: experts[1 % experts.length].id,
      quote: "RBI will hold rates in February policy meeting amid sticky core inflation.",
      direction: "NEUTRAL",
      sourceUrl: "https://moneycontrol.com/news/business/economy/rbi-rate-hold-forecast",
      publishedAt: new Date("2026-01-20"),
      resolutionStatus: "RESOLVED_HIT",
      resolvedAt: new Date("2026-02-07"),
      resolutionNote: "RBI MPC held rates at 6.5% in February meeting.",
      isSourceAttribution: false,
    },
    {
      expertId: experts[2 % experts.length].id,
      quote: "HDFC Bank Q3 NII will beat consensus estimates on strong retail loan growth.",
      direction: "BULLISH",
      sourceUrl: "https://livemint.com/market/hdfc-bank-q3-nii-forecast",
      publishedAt: new Date("2026-01-05"),
      resolutionStatus: "RESOLVED_HIT",
      resolvedAt: new Date("2026-01-22"),
      resolutionNote: "HDFC Bank Q3 NII grew 12% YoY, beating consensus by 3%.",
      isSourceAttribution: false,
    },
    {
      expertId: experts[3 % experts.length].id,
      quote: "Reliance Industries will underperform the index in H1 due to telecom margin pressure.",
      direction: "BEARISH",
      sourceUrl: "https://businessstandard.com/article/reliance-h1-outlook",
      publishedAt: new Date("2026-01-15"),
      resolutionStatus: "RESOLVED_HIT",
      resolvedAt: new Date("2026-06-30"),
      resolutionNote: "Reliance underperformed Nifty by 6% in H1 2026.",
      isSourceAttribution: false,
    },
    {
      expertId: experts[4 % experts.length].id,
      quote: "Crude oil prices will stay above $80/barrel through March on OPEC+ supply discipline.",
      direction: "BULLISH",
      sourceUrl: "https://economictimes.indiatimes.com/markets/commodities/crude-oil-march-outlook",
      publishedAt: new Date("2026-01-25"),
      resolutionStatus: "RESOLVED_HIT",
      resolvedAt: new Date("2026-03-31"),
      resolutionNote: "Brent averaged $83.2/barrel through March 2026.",
      isSourceAttribution: false,
    },
    // 5 MISS opinions
    {
      expertId: experts[0 % experts.length].id,
      quote: "IT sector will rally 15%+ in Q1 on strong US deal momentum and AI spending uptick.",
      direction: "BULLISH",
      sourceUrl: "https://livemint.com/market/it-sector-q1-rally-forecast",
      publishedAt: new Date("2026-01-08"),
      resolutionStatus: "RESOLVED_MISS",
      resolvedAt: new Date("2026-03-31"),
      resolutionNote: "IT sector gained only 4% in Q1 due to continued deal softness.",
      isSourceAttribution: false,
    },
    {
      expertId: experts[1 % experts.length].id,
      quote: "USD/INR will breach 87 before the Union Budget due to FII outflows.",
      direction: "BEARISH",
      sourceUrl: "https://moneycontrol.com/news/business/economy/usd-inr-forecast-budget",
      publishedAt: new Date("2026-01-18"),
      resolutionStatus: "RESOLVED_MISS",
      resolvedAt: new Date("2026-02-01"),
      resolutionNote: "USD/INR peaked at 86.4 before Budget day.",
      isSourceAttribution: false,
    },
    {
      expertId: experts[2 % experts.length].id,
      quote: "Gold will underperform equities in Q1 as risk appetite returns globally.",
      direction: "BEARISH",
      sourceUrl: "https://businessstandard.com/article/gold-vs-equities-q1-outlook",
      publishedAt: new Date("2026-01-12"),
      resolutionStatus: "RESOLVED_MISS",
      resolvedAt: new Date("2026-03-31"),
      resolutionNote: "Gold outperformed equities in Q1, rising 8% vs Nifty's 3%.",
      isSourceAttribution: false,
    },
    {
      expertId: experts[3 % experts.length].id,
      quote: "PSU bank stocks will correct 10%+ after the Budget due to profit booking.",
      direction: "BEARISH",
      sourceUrl: "https://economictimes.indiatimes.com/markets/banking/psu-bank-post-budget-outlook",
      publishedAt: new Date("2026-01-30"),
      resolutionStatus: "RESOLVED_MISS",
      resolvedAt: new Date("2026-02-15"),
      resolutionNote: "PSU banks rose 5% in the two weeks post-Budget.",
      isSourceAttribution: false,
    },
    {
      expertId: experts[4 % experts.length].id,
      quote: "Small-cap index will outperform large-caps by 5%+ in Q1 on domestic liquidity.",
      direction: "BULLISH",
      sourceUrl: "https://livemint.com/market/small-cap-vs-large-cap-q1",
      publishedAt: new Date("2026-01-22"),
      resolutionStatus: "RESOLVED_MISS",
      resolvedAt: new Date("2026-03-31"),
      resolutionNote: "Small-caps underperformed large-caps by 3% in Q1.",
      isSourceAttribution: false,
    },
  ];

  let created = 0;
  for (const data of resolvedOpinionsData) {
    // Check if a resolved opinion with this sourceUrl + expertId already exists
    const existing = await prisma.expertOpinion.findFirst({
      where: { expertId: data.expertId, sourceUrl: data.sourceUrl },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.expertOpinion.create({ data });
    created++;
  }

  console.log(`Seeded ${created} resolved expert opinion(s) for Crowd-vs-Experts card.`);
}

/**
 * S29-T2: Insert LeaderboardSnapshot rows dated 8 days ago for the top
 * seeded users so QA can verify rank delta badges without waiting a week.
 * Staggered previous ranks produce visible up/down movements:
 *   user[0] was rank 3 → now rank 1 (+2)
 *   user[1] was rank 1 → now rank 2 (-1)
 *   user[2] was rank 5 → now rank 3 (+2)
 *   etc.
 */
async function seedLeaderboardSnapshots() {
  // Fetch up to 10 users with the highest reputationScore (mirrors the
  // all-categories leaderboard ordering used at query time).
  const topUsers = await prisma.user.findMany({
    select: { id: true },
    orderBy: [{ reputationScore: "desc" }, { accuracyScore: "desc" }],
    take: 10,
  });

  if (topUsers.length === 0) {
    console.log("Skipping leaderboard snapshot seed — no users found.");
    return;
  }

  // Staggered previous ranks to produce visible up/down deltas.
  // Index maps current rank (idx+1) to a previous rank value.
  const prevRankOffsets = [3, 1, 5, 2, 7, 4, 9, 6, 10, 8];

  const snapshotAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

  const timeWindows = ["week", "month", "all"];

  let created = 0;
  for (const timeWindow of timeWindows) {
    for (let i = 0; i < topUsers.length; i++) {
      const userId = topUsers[i].id;
      const rank = prevRankOffsets[i] ?? i + 1;

      // Skip if snapshot already exists for this user/window/category/day
      // to keep seed idempotent.
      const exists = await prisma.leaderboardSnapshot.findFirst({
        where: {
          userId,
          timeWindow,
          category: null,
          snapshotAt: { gte: new Date(snapshotAt.getTime() - 60 * 1000) },
        },
      });
      if (exists) continue;

      await prisma.leaderboardSnapshot.create({
        data: { userId, rank, timeWindow, category: null, snapshotAt },
      });
      created++;
    }
  }

  console.log(`Seeded ${created} LeaderboardSnapshot rows for rank delta QA.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
