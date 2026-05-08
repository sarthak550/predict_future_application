"use client";

import { useState } from "react";

type PendingOpinion = {
  id: string;
  expertName: string;
  expertOrganization: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  quote: string;
  storyHeadline: string | null;
  publishedAt: string;
};

type UnverifiedExpert = {
  id: string;
  name: string;
  organization: string;
  bio: string | null;
  avatarUrl: string | null;
};

type Props = {
  initialOpinions: PendingOpinion[];
  initialExperts: UnverifiedExpert[];
};

const DIRECTION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  BULLISH: { bg: "bg-green-100", text: "text-green-700", label: "Bullish" },
  BEARISH: { bg: "bg-red-100", text: "text-red-700", label: "Bearish" },
  NEUTRAL: { bg: "bg-gray-100", text: "text-gray-600", label: "Neutral" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ExpertOpinionsAdminClient({ initialOpinions, initialExperts }: Props) {
  const [opinions, setOpinions] = useState<PendingOpinion[]>(initialOpinions);
  const [experts, setExperts] = useState<UnverifiedExpert[]>(initialExperts);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [verifiedIds, setVerifiedIds] = useState<Set<string>>(new Set());
  const [avatarInputs, setAvatarInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleOpinionAction(
    opinionId: string,
    action: "hit" | "miss" | "suppress"
  ) {
    if (loadingId) return;
    setLoadingId(opinionId);
    setErrors((prev) => ({ ...prev, [opinionId]: "" }));

    try {
      let url: string;
      let body: Record<string, string> = {};

      if (action === "suppress") {
        url = `/api/admin/expert-opinions/${opinionId}/suppress`;
      } else {
        url = `/api/admin/expert-opinions/${opinionId}/resolve`;
        body = {
          resolutionStatus: action === "hit" ? "RESOLVED_HIT" : "RESOLVED_MISS",
        };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Action failed.");
      }

      // Optimistically remove from table
      setOpinions((prev) => prev.filter((o) => o.id !== opinionId));
    } catch (err: unknown) {
      setErrors((prev) => ({
        ...prev,
        [opinionId]: err instanceof Error ? err.message : "Action failed.",
      }));
    } finally {
      setLoadingId(null);
    }
  }

  async function handleVerifyExpert(expertId: string) {
    if (loadingId) return;
    setLoadingId(expertId);
    setErrors((prev) => ({ ...prev, [expertId]: "" }));

    try {
      const avatarUrl = avatarInputs[expertId]?.trim() || undefined;
      const res = await fetch(`/api/admin/experts/${expertId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Verification failed.");
      }

      setVerifiedIds((prev) => new Set([...prev, expertId]));
      // Keep row but mark as verified — remove after a short delay
      setTimeout(() => {
        setExperts((prev) => prev.filter((e) => e.id !== expertId));
        setVerifiedIds((prev) => {
          const next = new Set(prev);
          next.delete(expertId);
          return next;
        });
      }, 1500);
    } catch (err: unknown) {
      setErrors((prev) => ({
        ...prev,
        [expertId]: err instanceof Error ? err.message : "Verification failed.",
      }));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-12">
      {/* ── Section A: Pending Expert Opinions ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-ink-900">
            Pending Expert Opinions
            <span className="ml-2 text-sm font-normal text-ink-500">
              ({opinions.length} remaining)
            </span>
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            Mark each AI-extracted opinion as HIT, MISS, or suppress it from public feeds.
          </p>
        </div>

        {opinions.length === 0 ? (
          <div className="rounded-xl border border-ink-100 bg-ink-50 px-6 py-8 text-center text-sm text-ink-500">
            No pending opinions. All caught up!
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ink-100">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Expert</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3 max-w-[280px]">Quote</th>
                  <th className="px-4 py-3 max-w-[200px]">Story</th>
                  <th className="px-4 py-3">Published</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {opinions.map((opinion) => {
                  const dirStyle = DIRECTION_STYLES[opinion.direction] ?? DIRECTION_STYLES.NEUTRAL;
                  const isLoading = loadingId === opinion.id;
                  return (
                    <tr key={opinion.id} className="bg-white hover:bg-ink-50/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink-900">{opinion.expertName}</div>
                        <div className="text-xs text-ink-500">{opinion.expertOrganization}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${dirStyle.bg} ${dirStyle.text}`}
                        >
                          {dirStyle.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[280px]">
                        <p className="line-clamp-2 text-ink-700">{opinion.quote}</p>
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <p className="line-clamp-2 text-ink-500">
                          {opinion.storyHeadline ?? "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-ink-500">
                        {formatDate(opinion.publishedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void handleOpinionAction(opinion.id, "hit")}
                            disabled={isLoading || !!loadingId}
                            className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            HIT
                          </button>
                          <button
                            onClick={() => void handleOpinionAction(opinion.id, "miss")}
                            disabled={isLoading || !!loadingId}
                            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            MISS
                          </button>
                          <button
                            onClick={() => void handleOpinionAction(opinion.id, "suppress")}
                            disabled={isLoading || !!loadingId}
                            className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                          >
                            Suppress
                          </button>
                        </div>
                        {errors[opinion.id] && (
                          <p className="mt-1 text-xs text-red-600">{errors[opinion.id]}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Section B: Unverified Experts ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-ink-900">
            Unverified Experts
            <span className="ml-2 text-sm font-normal text-ink-500">
              ({experts.filter((e) => !verifiedIds.has(e.id)).length} remaining)
            </span>
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            Optionally paste an avatar URL before clicking Verify. The verified badge will appear
            next to the expert&apos;s name across all Finance surfaces.
          </p>
        </div>

        {experts.length === 0 ? (
          <div className="rounded-xl border border-ink-100 bg-ink-50 px-6 py-8 text-center text-sm text-ink-500">
            No unverified experts.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ink-100">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3 max-w-[220px]">Bio</th>
                  <th className="px-4 py-3 w-64">Avatar URL</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {experts.map((expert) => {
                  const isLoading = loadingId === expert.id;
                  const isVerified = verifiedIds.has(expert.id);
                  return (
                    <tr
                      key={expert.id}
                      className={`bg-white hover:bg-ink-50/50 ${isVerified ? "opacity-60" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-ink-900">{expert.name}</td>
                      <td className="px-4 py-3 text-ink-500">{expert.organization}</td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <p className="line-clamp-2 text-ink-500">{expert.bio ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3 w-64">
                        <input
                          type="url"
                          placeholder={expert.avatarUrl ?? "https://…"}
                          value={avatarInputs[expert.id] ?? ""}
                          onChange={(e) =>
                            setAvatarInputs((prev) => ({
                              ...prev,
                              [expert.id]: e.target.value,
                            }))
                          }
                          disabled={isVerified}
                          className="w-full rounded-md border border-ink-200 px-2 py-1.5 text-xs text-ink-700 focus:border-sky-400 focus:outline-none disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-3">
                        {isVerified ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">
                            ✓ Verified
                          </span>
                        ) : (
                          <button
                            onClick={() => void handleVerifyExpert(expert.id)}
                            disabled={isLoading || !!loadingId}
                            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                          >
                            {isLoading ? "Verifying…" : "Verify Expert"}
                          </button>
                        )}
                        {errors[expert.id] && (
                          <p className="mt-1 text-xs text-red-600">{errors[expert.id]}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
