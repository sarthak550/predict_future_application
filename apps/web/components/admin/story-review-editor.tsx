"use client";

import { useState, useTransition } from "react";
import { MarketCategory, MarketTemplate, ResolutionSourceType } from "@prisma/client";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { marketCategoryLabels, marketTemplateLabels } from "@/lib/constants";

function defaultTemplate(category: MarketCategory): MarketTemplate {
  if (category === "SPORTS") {
    return "SPORTS_WINNER";
  }
  if (category === "WEATHER") {
    return "WEATHER_RAINFALL";
  }
  if (category === "ENTERTAINMENT") {
    return "BOX_OFFICE_THRESHOLD";
  }

  return "COMPANY_ANNOUNCEMENT";
}

function defaultResolutionSourceType(category: MarketCategory): ResolutionSourceType {
  if (category === "SPORTS") {
    return "SPORTS_API";
  }
  if (category === "WEATHER") {
    return "WEATHER_API";
  }
  if (category === "ENTERTAINMENT") {
    return "BOX_OFFICE_SOURCE";
  }

  return "PRESS_RELEASE";
}

function toDateInputValue(value?: string | Date | null) {
  if (!value) {
    return "";
  }

  return new Date(value).toISOString().slice(0, 16);
}

export function StoryReviewEditor({
  story
}: {
  story: {
    id: string;
    headline: string;
    summary: string;
    category: MarketCategory;
    sourceName: string;
    sourceUrl: string;
    isFeatured: boolean;
    isTrending: boolean;
    market?: {
      title: string;
      description: string;
      template: MarketTemplate;
      closeAt: string | Date;
      resolveAt: string | Date;
      resolutionSourceType: ResolutionSourceType;
      resolutionSourceName: string;
      resolutionSourceUrl: string | null;
      resolutionRuleText: string;
      fallbackRuleText: string | null;
    } | null;
  };
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(story.summary);
  const [category, setCategory] = useState<MarketCategory>(story.category);
  const [isFeatured, setIsFeatured] = useState(story.isFeatured);
  const [isTrending, setIsTrending] = useState(story.isTrending);
  const [predictionTitle, setPredictionTitle] = useState(story.market?.title ?? "");
  const [predictionDescription, setPredictionDescription] = useState(story.market?.description ?? "");
  const [template, setTemplate] = useState<MarketTemplate>(story.market?.template ?? defaultTemplate(story.category));
  const [closeAt, setCloseAt] = useState(toDateInputValue(story.market?.closeAt));
  const [resolveAt, setResolveAt] = useState(toDateInputValue(story.market?.resolveAt));
  const [resolutionSourceType, setResolutionSourceType] = useState<ResolutionSourceType>(
    story.market?.resolutionSourceType ?? defaultResolutionSourceType(story.category)
  );
  const [resolutionSourceName, setResolutionSourceName] = useState(story.market?.resolutionSourceName ?? story.sourceName);
  const [resolutionSourceUrl, setResolutionSourceUrl] = useState(story.market?.resolutionSourceUrl ?? story.sourceUrl);
  const [resolutionRuleText, setResolutionRuleText] = useState(story.market?.resolutionRuleText ?? "");
  const [fallbackRuleText, setFallbackRuleText] = useState(story.market?.fallbackRuleText ?? "");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const hasPredictionDraft =
    predictionTitle.trim().length > 0 &&
    predictionDescription.trim().length > 0 &&
    closeAt &&
    resolveAt &&
    resolutionSourceName.trim().length > 0 &&
    resolutionRuleText.trim().length > 0;

  return (
    <div className="space-y-3">
      <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} className="min-h-[110px]" />
      <div className="grid gap-3 md:grid-cols-3">
        <Select value={category} onChange={(event) => setCategory(event.target.value as MarketCategory)}>
          {Object.entries(marketCategoryLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 text-sm text-ink-700">
          <input type="checkbox" checked={isFeatured} onChange={(event) => setIsFeatured(event.target.checked)} />
          Featured
        </label>
        <label className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 text-sm text-ink-700">
          <input type="checkbox" checked={isTrending} onChange={(event) => setIsTrending(event.target.checked)} />
          Trending
        </label>
      </div>

      <div className="rounded-[24px] border border-ink-100 bg-ink-50/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Attach prediction market</p>
        <div className="mt-3 grid gap-3">
          <Input value={predictionTitle} onChange={(event) => setPredictionTitle(event.target.value)} placeholder="Prediction question" />
          <Textarea
            value={predictionDescription}
            onChange={(event) => setPredictionDescription(event.target.value)}
            className="min-h-[90px]"
            placeholder="What does YES mean for this story?"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <Select value={template} onChange={(event) => setTemplate(event.target.value as MarketTemplate)}>
              {Object.entries(marketTemplateLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select value={resolutionSourceType} onChange={(event) => setResolutionSourceType(event.target.value as ResolutionSourceType)}>
              {Object.values(ResolutionSourceType).map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ").toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input type="datetime-local" value={closeAt} onChange={(event) => setCloseAt(event.target.value)} />
            <Input type="datetime-local" value={resolveAt} onChange={(event) => setResolveAt(event.target.value)} />
          </div>
          <Input value={resolutionSourceName} onChange={(event) => setResolutionSourceName(event.target.value)} placeholder="Resolution source name" />
          <Input value={resolutionSourceUrl} onChange={(event) => setResolutionSourceUrl(event.target.value)} placeholder="Resolution source URL" />
          <Textarea
            value={resolutionRuleText}
            onChange={(event) => setResolutionRuleText(event.target.value)}
            className="min-h-[90px]"
            placeholder="Exact resolution rule"
          />
          <Textarea
            value={fallbackRuleText}
            onChange={(event) => setFallbackRuleText(event.target.value)}
            className="min-h-[80px]"
            placeholder="Fallback rule"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setMessage("");

              const response = await fetch(`/api/admin/stories/${story.id}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  summary,
                  category,
                  isFeatured,
                  isTrending,
                  prediction: hasPredictionDraft
                    ? {
                        title: predictionTitle,
                        description: predictionDescription,
                        template,
                        closeAt: new Date(closeAt).toISOString(),
                        resolveAt: new Date(resolveAt).toISOString(),
                        resolutionSourceType,
                        resolutionSourceName,
                        resolutionSourceUrl,
                        resolutionRuleText,
                        fallbackRuleText
                      }
                    : undefined
                })
              });

              const payload = (await response.json()) as { error?: string };
              setMessage(response.ok ? "Saved." : payload.error ?? "Unable to save.");
              if (response.ok) {
                router.refresh();
              }
            })
          }
        >
          {isPending ? "Saving..." : "Save changes"}
        </Button>
        {message && <span className="text-xs text-ink-500">{message}</span>}
      </div>
    </div>
  );
}
