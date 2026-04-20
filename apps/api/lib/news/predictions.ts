import type { MarketCategory, MarketTemplate, ResolutionSourceType } from "@prisma/client";

import { weatherCityOptions } from "@/lib/constants";

type PredictionSuggestion = {
  title: string;
  description: string;
  template: MarketTemplate;
  closeAt: string;
  resolveAt: string;
  resolutionSourceType: ResolutionSourceType;
  resolutionSourceName: string;
  resolutionSourceUrl?: string;
  resolutionRuleText: string;
  fallbackRuleText?: string;
  structuredData?: Record<string, unknown>;
};

type StoryLike = {
  headline: string;
  summary: string;
  category: MarketCategory;
  publishedAt: Date | string;
  sourceName: string;
  sourceUrl: string;
};

const monthMap: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

function toIsoWithOffset(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function endOfWeek(base: Date) {
  const date = new Date(base);
  const day = date.getUTCDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + daysUntilSunday));
}

function endOfMonth(base: Date) {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
}

function formatDeadlineLabel(date: Date) {
  return date.toISOString().slice(0, 10);
}

function cleanLabel(input: string, fallback: string) {
  const cleaned = input
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:report|reports|preview|analysis|update|live|exclusive)$/i, "")
    .trim();

  return cleaned.length >= 2 ? cleaned : fallback;
}

function buildPredictionWindow(publishedAt: Date, deadline: Date, maxOpenHoursAfterPublish = 72) {
  const minimumCloseAt = new Date(publishedAt.getTime() + 2 * 60 * 60 * 1000);
  const preferredCloseAt = new Date(deadline.getTime() - 6 * 60 * 60 * 1000);
  const capCloseAt = new Date(publishedAt.getTime() + maxOpenHoursAfterPublish * 60 * 60 * 1000);
  const closeAt = new Date(Math.max(minimumCloseAt.getTime(), Math.min(preferredCloseAt.getTime(), capCloseAt.getTime())));
  const resolveAt = new Date(Math.max(deadline.getTime() + 6 * 60 * 60 * 1000, closeAt.getTime() + 2 * 60 * 60 * 1000));

  return {
    closeAt: closeAt.toISOString(),
    resolveAt: resolveAt.toISOString()
  };
}

function findWeatherCity(input: string) {
  const normalized = input.toLowerCase();
  return weatherCityOptions.find((city) => normalized.includes(city.label.toLowerCase()));
}

function extractSportsTeams(input: string) {
  const patterns = [
    /([A-Z][A-Za-z.&\s]{2,30})\s+vs\.?\s+([A-Z][A-Za-z.&\s]{2,30})/i,
    /([A-Z][A-Za-z.&\s]{2,30})\s+against\s+([A-Z][A-Za-z.&\s]{2,30})/i,
    /([A-Z][A-Za-z.&\s]{2,30})\s+to face\s+([A-Z][A-Za-z.&\s]{2,30})/i,
    /([A-Z][A-Za-z.&\s]{2,30})\s+face\s+([A-Z][A-Za-z.&\s]{2,30})/i,
    /([A-Z][A-Za-z.&\s]{2,30})\s+hosts?\s+([A-Z][A-Za-z.&\s]{2,30})/i,
    /([A-Z][A-Za-z.&\s]{2,30})\s+take on\s+([A-Z][A-Za-z.&\s]{2,30})/i
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (!match) {
      continue;
    }

    return [
      cleanLabel(match[1], "Team A"),
      cleanLabel(match[2], "Team B")
    ];
  }

  return null;
}

function extractLeadEntity(headline: string) {
  const quoted = headline.match(/[“"]([^”"]{2,80})[”"]/);
  if (quoted) {
    return cleanLabel(quoted[1], "");
  }

  const leading = headline
    .split(/[:,-]/)[0]
    .replace(/\b(?:plans to|set to|expected to|aims to|prepares to|gears up to|to)\b.*$/i, "")
    .trim();

  return cleanLabel(leading, "");
}

function parseRelativeDate(input: string, base: Date) {
  const normalized = input.toLowerCase();

  if (normalized.includes("tomorrow")) {
    return addDays(base, 1);
  }

  if (normalized.includes("today") || normalized.includes("tonight")) {
    return base;
  }

  if (normalized.includes("this week")) {
    return endOfWeek(base);
  }

  if (normalized.includes("this month")) {
    return endOfMonth(base);
  }

  return null;
}

function parseMonthDate(input: string, referenceDate: Date) {
  const formats = [
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?/i,
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?/i
  ];

  for (const pattern of formats) {
    const match = input.match(pattern);
    if (!match) {
      continue;
    }

    const isMonthFirst = Number.isNaN(Number(match[1]));
    const monthKey = (isMonthFirst ? match[1] : match[2]).toLowerCase();
    const day = Number(isMonthFirst ? match[2] : match[1]);
    const year = Number(match[3] ?? referenceDate.getUTCFullYear());
    const month = monthMap[monthKey];

    if (month === undefined || Number.isNaN(day)) {
      continue;
    }

    return new Date(Date.UTC(year, month, day));
  }

  return null;
}

function extractDeadlineDate(input: string, publishedAt: Date, fallbackDays: number) {
  return parseMonthDate(input, publishedAt) ?? parseRelativeDate(input, publishedAt) ?? addDays(publishedAt, fallbackDays);
}

function extractLaunchDetails(input: string, headline: string) {
  const detailedMatch = input.match(
    /([A-Z][A-Za-z0-9&.+\-\s]{2,50}?)\s+(?:plans to|set to|expected to|aims to|prepares to|gears up to|to)\s+(?:launch|release|roll out|ship|debut|introduce)\s+([^,.]{3,80})/i
  );

  if (detailedMatch) {
    return {
      company: cleanLabel(detailedMatch[1], "the company in this story"),
      target: cleanLabel(detailedMatch[2], "the product mentioned in this story")
    };
  }

  const hasFutureLaunchSignal =
    /(?:plans to|set to|expected to|aims to|prepares to|gears up to|to)\s+(?:launch|release|roll out|ship|debut|introduce)/i.test(
      input
    ) || /\b(?:launch|release|roll out|ship|debut)\b.+\b(?:by|before|on|tomorrow|this month|this week)\b/i.test(input);

  if (!hasFutureLaunchSignal) {
    return null;
  }

  const company = extractLeadEntity(headline);
  if (!company) {
    return null;
  }

  return {
    company,
    target: "the product mentioned in this story"
  };
}

function extractAnnouncementDetails(input: string, headline: string) {
  const hasAnnouncementSignal =
    /(?:plans to|set to|expected to|aims to|prepares to|gears up to|to)\s+(?:announce|confirm|reveal|unveil|report|file)/i.test(
      input
    ) || /\b(?:announcement|decision|approval|filing)\b.+\b(?:by|before|on|tomorrow|this month|this week)\b/i.test(input);

  if (!hasAnnouncementSignal) {
    return null;
  }

  const company = extractLeadEntity(headline);
  if (!company) {
    return null;
  }

  return { company };
}

function extractBoxOfficeTarget(input: string) {
  const match = input.match(
    /\b(?:cross|touch|top|hit|reach)\s+(?:rs\.?\s*|inr\s*|₹|\$)?(\d+(?:\.\d+)?)\s*(crore|cr|million|billion)?/i
  );

  if (!match) {
    return null;
  }

  const value = match[1];
  const unit = match[2]?.toLowerCase();

  const label = unit ? `${value} ${unit === "cr" ? "crore" : unit}` : value;
  return {
    label,
    numericValue: Number(value),
    unit: unit ?? null
  };
}

function extractEntertainmentTitle(headline: string) {
  const quoted = headline.match(/[“"]([^”"]{2,80})[”"]/);
  if (quoted) {
    return cleanLabel(quoted[1], "the film in this story");
  }

  const base = headline.split(/\b(?:box office|release|opening|advance bookings|trailer)\b/i)[0];
  return cleanLabel(base, "the film in this story");
}

export function generatePredictionFromStory(story: StoryLike): PredictionSuggestion | null {
  const publishedAt = new Date(story.publishedAt);
  const combinedText = `${story.headline} ${story.summary}`;

  if (story.category === "WEATHER") {
    const city = findWeatherCity(combinedText);
    if (!city) {
      return null;
    }

    const date = publishedAt.toISOString().slice(0, 10);

    return {
      title: `Will ${city.label} record at least 2.5 mm rainfall on ${date}?`,
      description: `Resolve YES if daily rainfall reported for ${city.label} between 00:00 and 23:59 local time on ${date} is at least 2.5 mm.`,
      template: "WEATHER_RAINFALL",
      closeAt: toIsoWithOffset(publishedAt, 12),
      resolveAt: toIsoWithOffset(publishedAt, 24),
      resolutionSourceType: "WEATHER_API",
      resolutionSourceName: "Open-Meteo",
      resolutionSourceUrl: story.sourceUrl,
      resolutionRuleText: `Resolve YES if the weather source reports daily precipitation of at least 2.5 mm in ${city.label} on ${date}.`,
      fallbackRuleText:
        "If the API fails, staff should verify the published daily precipitation total from the named source and apply the same threshold.",
      structuredData: {
        cityKey: city.key,
        date,
        thresholdMm: 2.5
      }
    };
  }

  if (story.category === "SPORTS") {
    const teams = extractSportsTeams(combinedText);
    if (!teams) {
      return null;
    }

    return {
      title: `Will ${teams[0]} win the match mentioned in this story?`,
      description: `Resolve YES if ${teams[0]} is declared the winner in the official result for the match referenced by this story.`,
      template: "SPORTS_WINNER",
      closeAt: toIsoWithOffset(publishedAt, 18),
      resolveAt: toIsoWithOffset(publishedAt, 36),
      resolutionSourceType: "SPORTS_API",
      resolutionSourceName: story.sourceName,
      resolutionSourceUrl: story.sourceUrl,
      resolutionRuleText: `Resolve YES if ${teams[0]} is the official winner in the result source tied to this story.`,
      fallbackRuleText: "If the primary result source is unavailable, staff should use the event organizer's official result page."
    };
  }

  if (story.category === "ENTERTAINMENT" && /\bbox office|opening weekend|advance booking/i.test(combinedText)) {
    const threshold = extractBoxOfficeTarget(combinedText);
    if (!threshold) {
      return null;
    }

    const filmTitle = extractEntertainmentTitle(story.headline);
    const deadline = extractDeadlineDate(combinedText, publishedAt, 14);
    const { closeAt, resolveAt } = buildPredictionWindow(publishedAt, deadline, 96);
    const deadlineLabel = formatDeadlineLabel(deadline);

    return {
      title: `Will ${filmTitle} cross ${threshold.label} in box office by ${deadlineLabel}?`,
      description: `Resolve YES if the official box office source shows ${filmTitle} at or above ${threshold.label} by the end of ${deadlineLabel}.`,
      template: "BOX_OFFICE_THRESHOLD",
      closeAt,
      resolveAt,
      resolutionSourceType: "BOX_OFFICE_SOURCE",
      resolutionSourceName: story.sourceName,
      resolutionSourceUrl: story.sourceUrl,
      resolutionRuleText: `Resolve YES if the named box office source reports ${filmTitle} at or above ${threshold.label} on or before ${deadlineLabel}.`,
      fallbackRuleText: "If the primary trade source is unavailable, staff should use a reputable box office tracking source that applies the same threshold.",
      structuredData: {
        thresholdValue: threshold.numericValue,
        thresholdUnit: threshold.unit,
        deadline: deadlineLabel
      }
    };
  }

  if (story.category === "TECH" || story.category === "PRODUCT") {
    const launchDetails = extractLaunchDetails(combinedText, story.headline);
    if (launchDetails) {
      const deadline = extractDeadlineDate(combinedText, publishedAt, 30);
      const { closeAt, resolveAt } = buildPredictionWindow(publishedAt, deadline);
      const deadlineLabel = formatDeadlineLabel(deadline);

      return {
        title: `Will ${launchDetails.company} launch ${launchDetails.target} by ${deadlineLabel}?`,
        description: `Resolve YES if ${launchDetails.company} publicly launches or ships ${launchDetails.target} on or before ${deadlineLabel}.`,
        template: "PRODUCT_LAUNCH",
        closeAt,
        resolveAt,
        resolutionSourceType: "PRESS_RELEASE",
        resolutionSourceName: story.sourceName,
        resolutionSourceUrl: story.sourceUrl,
        resolutionRuleText: `Resolve YES if the official announcement or product availability source confirms that ${launchDetails.company} launched ${launchDetails.target} on or before ${deadlineLabel}.`,
        fallbackRuleText: "If the primary source is unavailable, staff should use the company's official newsroom or product page and apply the same deadline.",
        structuredData: {
          company: launchDetails.company,
          target: launchDetails.target,
          deadline: deadlineLabel
        }
      };
    }
  }

  if (story.category === "BUSINESS" || story.category === "COMPANY" || story.category === "TECH") {
    const announcementDetails = extractAnnouncementDetails(combinedText, story.headline);
    if (announcementDetails) {
      const deadline = extractDeadlineDate(combinedText, publishedAt, 21);
      const { closeAt, resolveAt } = buildPredictionWindow(publishedAt, deadline);
      const deadlineLabel = formatDeadlineLabel(deadline);

      return {
        title: `Will ${announcementDetails.company} make the announcement referenced in this story by ${deadlineLabel}?`,
        description: `Resolve YES if ${announcementDetails.company} publicly makes the announcement, filing, or confirmation referenced in this story on or before ${deadlineLabel}.`,
        template: "COMPANY_ANNOUNCEMENT",
        closeAt,
        resolveAt,
        resolutionSourceType: "PRESS_RELEASE",
        resolutionSourceName: story.sourceName,
        resolutionSourceUrl: story.sourceUrl,
        resolutionRuleText: `Resolve YES if the relevant public company disclosure or official announcement confirms the event described in this story on or before ${deadlineLabel}.`,
        fallbackRuleText: "If the named source is unavailable, staff should use the company's official newsroom or regulatory filing page and apply the same deadline.",
        structuredData: {
          company: announcementDetails.company,
          deadline: deadlineLabel
        }
      };
    }
  }

  return null;
}
