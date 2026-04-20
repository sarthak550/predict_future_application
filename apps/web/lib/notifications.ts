import { type NotificationType, type Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

export async function createNotification(
  tx: TxClient,
  input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    href?: string;
    storyId?: string;
    marketId?: string;
    metadata?: Prisma.JsonObject;
  }
) {
  await tx.notification.create({
    data: input
  });
}

export async function notifyMany(
  tx: TxClient,
  userIds: string[],
  payload: Omit<Parameters<typeof createNotification>[1], "userId">
) {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) {
    return;
  }

  await tx.notification.createMany({
    data: uniqueUserIds.map((userId) => ({
      userId,
      ...payload
    }))
  });
}
