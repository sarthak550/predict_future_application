import type { GroupRole } from "@prisma/client";

export type GroupSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  inviteCode: string;
  role: GroupRole;
  memberCount: number;
  marketCount: number;
};
