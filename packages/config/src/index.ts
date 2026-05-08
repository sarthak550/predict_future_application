import type {
  ChallengeStatus,
  CuratedFeedType,
  MarketCategory,
  MarketStatus,
  MarketType,
  MarketTemplate,
  PoolRewardMode,
  MarketVisibility,
  NumericTieBreakerRule,
  ResolutionStatus,
  ResolutionMode,
  StoryStatus
} from "@prisma/client";

export const APP_NAME = "Predict Future";
export const APP_TAGLINE = "Swipe through the news. Predict what happens next.";
export const STARTING_BALANCE = 10_000;

export const marketCategoryLabels: Record<MarketCategory, string> = {
  GENERAL: "General",
  SPORTS: "Sports",
  BUSINESS: "Business",
  TECH: "Tech",
  WEATHER: "Weather",
  ENTERTAINMENT: "Entertainment",
  PRODUCT: "Product Launches",
  COMPANY: "Company News",
  FINANCE: "Finance"
};

export const marketTemplateLabels: Record<MarketTemplate, string> = {
  SPORTS_WINNER: "Sports Winner",
  WEATHER_RAINFALL: "Rainfall Threshold",
  BOX_OFFICE_THRESHOLD: "Box Office Threshold",
  PRODUCT_LAUNCH: "Product Launch Deadline",
  COMPANY_ANNOUNCEMENT: "Company Announcement",
  CUSTOM: "Open Question"
};

export const marketTypeLabels: Record<MarketType, string> = {
  BINARY: "Yes / No",
  NUMERIC: "Guess a number",
  MULTIPLE_CHOICE: "Multiple choice"
};

export const marketVisibilityLabels: Record<MarketVisibility, string> = {
  PUBLIC: "Public",
  PRIVATE: "Private"
};

export const resolutionModeLabels: Record<ResolutionMode, string> = {
  VERIFIED: "Verified (legacy)",
  TRUSTED_HOST: "Trusted host",
  HOST: "Host",
  GROUP_VOTE: "Community consensus",
  SOURCE_BASED: "Source-based (legacy)",
  HOST_RESOLVED: "Host-resolved"
};

export const resolutionStatusLabels: Record<ResolutionStatus, string> = {
  OPEN: "Open",
  CLOSED: "Closed",
  AWAITING_RESOLUTION: "Waiting for host",
  RESOLVED_PENDING_CHALLENGE: "Challenge open",
  DISPUTED: "Under review",
  FINALIZED: "Finalized",
  OVERTURNED: "Overturned",
  CANCELLED: "Cancelled",
  HOST_TIMEOUT: "Host missed deadline"
};

export const challengeStatusLabels: Record<ChallengeStatus, string> = {
  OPEN: "Open",
  REVIEWED: "Reviewed",
  UPHELD: "Upheld",
  REJECTED: "Rejected"
};

export const marketStatusLabels: Record<MarketStatus, string> = {
  DRAFT: "Pending Review",
  PENDING_REVIEW: "Pending Review",
  OPEN: "Open",
  CLOSED: "Closed",
  AWAITING_RESOLUTION: "Waiting for host",
  RESOLVING: "Resolving",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  HOST_TIMEOUT: "Host missed deadline"
};

export const poolRewardModeLabels: Record<PoolRewardMode, string> = {
  COMMISSION_BASED: "Commission-based",
  BOND_BASED: "Bond-based"
};

export const marketStatusOptions: MarketStatus[] = [
  "OPEN",
  "CLOSED",
  "AWAITING_RESOLUTION",
  "RESOLVING",
  "RESOLVED",
  "HOST_TIMEOUT",
  "CANCELLED",
  "PENDING_REVIEW",
  "DRAFT",
  "REJECTED"
];

export const numericTieBreakerLabels: Record<NumericTieBreakerRule, string> = {
  SPLIT: "Split tied slots",
  EARLIEST: "Earliest submission wins the tie"
};

export const storyStatusLabels: Record<StoryStatus, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending Review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  REJECTED: "Rejected",
  ARCHIVED: "Archived"
};

export const primaryNewsCategories: MarketCategory[] = [
  "GENERAL",
  "SPORTS",
  "BUSINESS",
  "TECH",
  "ENTERTAINMENT",
  "WEATHER"
];

export const feedTypeLabels: Record<CuratedFeedType, string> = {
  FOR_YOU: "For You",
  LATEST: "Latest",
  TRENDING: "Trending",
  RESOLVED: "Resolved",
  MORNING_DIGEST: "Morning Digest",
  MIRROR_FEATURED: "Mirror Featured",
  MIRROR_DIGEST: "Mirror Digest"
};

export const mainFeedViews = [
  { key: "for-you", label: "For You" },
  { key: "latest", label: "Latest" },
  { key: "trending", label: "Trending" },
  { key: "resolved", label: "Resolved" }
] as const;

export const weatherCityOptions = [
  { key: "mumbai", label: "Mumbai", latitude: 19.076, longitude: 72.8777, timezone: "Asia/Kolkata" },
  { key: "delhi", label: "Delhi", latitude: 28.6139, longitude: 77.209, timezone: "Asia/Kolkata" },
  { key: "bengaluru", label: "Bengaluru", latitude: 12.9716, longitude: 77.5946, timezone: "Asia/Kolkata" },
  { key: "chennai", label: "Chennai", latitude: 13.0827, longitude: 80.2707, timezone: "Asia/Kolkata" },
  { key: "kolkata", label: "Kolkata", latitude: 22.5726, longitude: 88.3639, timezone: "Asia/Kolkata" }
] as const;

export const reportReasons = [
  "Ambiguous wording",
  "Missing or weak source",
  "Duplicate market",
  "Harmful or disallowed topic",
  "Resolution dispute"
] as const;

export function calculateLevel(reputationScore: number, totalPredictions: number) {
  const reputationTier = Math.max(0, Math.floor((reputationScore - 50) / 10));
  const participationTier = Math.floor(totalPredictions / 5);
  return Math.max(1, 1 + reputationTier + participationTier);
}

export const categoryTemplates = [
  {
    template: "WEATHER_RAINFALL",
    category: "WEATHER",
    description: "Objective daily rainfall threshold with automatic weather-source resolution."
  },
  {
    template: "SPORTS_WINNER",
    category: "SPORTS",
    description: "Winner-based sports market resolved from the named official results source."
  },
  {
    template: "BOX_OFFICE_THRESHOLD",
    category: "ENTERTAINMENT",
    description: "Domestic box office threshold by a deadline."
  },
  {
    template: "PRODUCT_LAUNCH",
    category: "PRODUCT",
    description: "Whether a company launches a product by a fixed deadline."
  },
  {
    template: "COMPANY_ANNOUNCEMENT",
    category: "COMPANY",
    description: "Whether a company makes a specific public announcement by a date."
  },
  {
    template: "CUSTOM",
    category: "GENERAL",
    description: "Open question with your own rules, timing, and objective resolution."
  }
] as const;
