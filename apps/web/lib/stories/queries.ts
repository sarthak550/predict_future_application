import { type MarketCategory, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { rankFeedStories } from "@/lib/stories/ranking";
import { approvedStoryStatuses } from "@/lib/validations/news";

export type FeedView = "for-you" | "latest" | "trending" | "resolved";

export const feedStoryInclude = (userId?: string | null) =>
  ({
    source: true,
    market: {
      include: {
        creator: {
          select: {
            username: true,
            reputationScore: true
          }
        },
        _count: {
          select: {
            comments: true
          }
        },
        positions: {
          where: {
            userId: userId ?? "__anonymous__"
          },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    }
  }) satisfies Prisma.StoryInclude;

export type FeedStory = Prisma.StoryGetPayload<{
  include: ReturnType<typeof feedStoryInclude>;
}>;

export type StoryDetail = Prisma.StoryGetPayload<{
  include: {
    source: true;
    market: {
      include: {
        creator: true;
        resolution: true;
        comments: {
          include: {
            user: {
              select: {
                username: true;
              };
            };
          };
        };
        positions: {
          include: {
            user: {
              select: {
                username: true;
              };
            };
          };
        };
        _count: {
          select: {
            comments: true;
          };
        };
      };
    };
    notifications: true;
  };
}>;

export async function getFeedStories(input: {
  view: FeedView;
  category?: MarketCategory;
  userId?: string | null;
  limit?: number;
  page?: number;
}) {
  const limit = input.limit ?? 15;
  const page = input.page ?? 1;
  const isResolvedView = input.view === "resolved";
  const offset = (page - 1) * limit;
  const candidateLimit = Math.min(240, Math.max(60, page * limit * 6));

  const stories = await prisma.story.findMany({
    where: {
      status: {
        in: approvedStoryStatuses
      },
      ...(input.category ? { category: input.category } : {}),
      market: isResolvedView
        ? {
            is: {
              status: {
                in: ["RESOLVED", "CANCELLED"]
              }
            }
          }
        : {
            is: {
              status: {
                in: ["OPEN", "CLOSED", "RESOLVING"]
              }
            }
          }
    },
    include: feedStoryInclude(input.userId),
    orderBy: [{ publishedAt: "desc" }],
    take: candidateLimit
  });

  if (stories.length === 0) {
    return [];
  }

  const [categoryStats, curatedItems] = await Promise.all([
    input.userId
      ? prisma.userCategoryStat.findMany({
          where: {
            userId: input.userId,
            totalPredictions: {
              gt: 0
            }
          },
          orderBy: [{ accuracyScore: "desc" }, { totalPredictions: "desc" }]
        })
      : Promise.resolve([]),
    prisma.curatedFeedItem.findMany({
      where: {
        storyId: {
          in: stories.map((story) => story.id)
        },
        feed: {
          feedType:
            input.view === "for-you"
              ? "FOR_YOU"
              : input.view === "latest"
                ? "LATEST"
                : input.view === "trending"
                  ? "TRENDING"
                  : "RESOLVED"
        }
      },
      select: {
        storyId: true,
        position: true
      }
    })
  ]);

  const categoryWeights = categoryStats.reduce<Partial<Record<MarketCategory, number>>>((weights, categoryStat) => {
    weights[categoryStat.category] = Number(
      (categoryStat.accuracyScore * 2 + Math.min(2, categoryStat.totalPredictions / 8)).toFixed(2)
    );
    return weights;
  }, {});

  const curatedPositions = curatedItems.reduce((map, item) => {
    map.set(item.storyId, item.position);
    return map;
  }, new Map<string, number>());

  return rankFeedStories(stories, {
    view: input.view,
    categoryWeights,
    curatedPositions
  }).slice(offset, offset + limit);
}

export async function getStoryBySlug(slug: string, userId?: string | null) {
  return prisma.story.findUnique({
    where: { slug },
    include: {
      source: true,
      market: {
        include: {
          creator: true,
          resolution: true,
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
            take: 8
          },
          _count: {
            select: {
              comments: true
            }
          }
        }
      },
      notifications: userId
        ? {
            where: {
              userId
            },
            take: 5
          }
        : false
    }
  });
}

export async function getFeaturedMirrorStory(userId?: string | null) {
  return prisma.story.findFirst({
    where: {
      status: {
        in: approvedStoryStatuses
      },
      isFeatured: true,
      market: {
        is: {
          status: "OPEN"
        }
      }
    },
    include: feedStoryInclude(userId),
    orderBy: [{ isTrending: "desc" }, { publishedAt: "desc" }]
  });
}
