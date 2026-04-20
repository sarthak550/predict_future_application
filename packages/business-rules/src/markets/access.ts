import { type GroupRole, type MarketStatus, type MarketVisibility, type ResolutionMode, type Role } from "@prisma/client";

type Viewer = {
  id: string;
  role: Role;
} | null;

type MarketAccessShape = {
  creatorId: string;
  status: MarketStatus;
  visibility: MarketVisibility;
  resolutionMode?: ResolutionMode;
  group?: {
    ownerId?: string;
    memberships?: Array<{
      userId: string;
      role?: GroupRole;
    }>;
  } | null;
};

export function isStaffViewer(viewer: Viewer) {
  return Boolean(viewer && (viewer.role === "ADMIN" || viewer.role === "MODERATOR"));
}

export function isGroupMemberForMarket(market: MarketAccessShape, viewer: Viewer) {
  if (!viewer || !market.group) {
    return false;
  }

  if (market.group.ownerId === viewer.id) {
    return true;
  }

  return Boolean(market.group.memberships?.some((membership) => membership.userId === viewer.id));
}

export function canViewMarket(market: MarketAccessShape, viewer: Viewer) {
  const staff = isStaffViewer(viewer);
  const creator = Boolean(viewer && market.creatorId === viewer.id);
  const groupMember = isGroupMemberForMarket(market, viewer);
  const canSeeInternal = staff || creator || groupMember;

  if (market.visibility === "PRIVATE" && !canSeeInternal) {
    return false;
  }

  if ((market.status === "DRAFT" || market.status === "PENDING_REVIEW" || market.status === "REJECTED") && !canSeeInternal) {
    return false;
  }

  return true;
}

export function canManageMarket(market: MarketAccessShape, viewer: Viewer) {
  return Boolean(viewer && (viewer.id === market.creatorId || isStaffViewer(viewer)));
}
