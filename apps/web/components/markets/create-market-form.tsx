"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MarketCategory,
  MarketTemplate,
  MarketType,
  MarketVisibility,
  NumericTieBreakerRule,
  PoolRewardMode,
  ResolutionMode,
  ResolutionSourceType
} from "@prisma/client";

import { CreateGroupForm } from "@/components/groups/create-group-form";
import { JoinGroupForm } from "@/components/groups/join-group-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  marketCategoryLabels,
  marketTypeLabels,
  marketVisibilityLabels,
  numericTieBreakerLabels,
  poolRewardModeLabels,
  resolutionModeLabels
} from "@/lib/constants";
import type { GroupSummary } from "@/lib/groups/types";

function isoLocal(value: string) {
  return value ? new Date(value).toISOString() : "";
}

function dedupeGroups(groups: GroupSummary[]) {
  const seen = new Set<string>();
  return groups.filter((group) => {
    if (seen.has(group.id)) {
      return false;
    }

    seen.add(group.id);
    return true;
  });
}

function parseDistributionInput(input: string) {
  return input
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => Number(chunk))
    .filter((value) => Number.isFinite(value));
}

type TrustedHostProgressMetric = {
  current: number;
  target: number;
};

type TrustedHostEligibility = {
  eligible: boolean;
  reasons: string[];
  hostTrustScore: number;
  validFinalizedHostedMarketsCount: number;
  accountAgeDays: number;
  hostingLimit: number;
  challengeWindowHours: number;
  fixedCommissionBps: number;
  defaultBondCap: number;
  privateCommissionPresets: number[];
  privateChallengeWindowOptions: number[];
  maxGracePeriodHours: number;
  progress: {
    accountAgeDays: TrustedHostProgressMetric;
    validFinalizedHostedMarkets: TrustedHostProgressMetric;
    hostTrustScore: TrustedHostProgressMetric;
    recentHostTimeoutCount: TrustedHostProgressMetric;
    overturnedHostedMarketsCount: TrustedHostProgressMetric;
  };
};

type CreateMarketFormProps = {
  initialGroups: GroupSummary[];
  initialVisibility?: MarketVisibility;
  initialGroupId?: string;
  trustedHostEligibility: TrustedHostEligibility;
};

export function CreateMarketForm({
  initialGroups,
  initialVisibility = MarketVisibility.PUBLIC,
  initialGroupId = "",
  trustedHostEligibility
}: CreateMarketFormProps) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [visibility, setVisibility] = useState<MarketVisibility>(initialVisibility);
  const [groupId, setGroupId] = useState(initialGroupId || initialGroups[0]?.id || "");
  const template = MarketTemplate.CUSTOM;
  const [marketType, setMarketType] = useState<MarketType>(MarketType.BINARY);
  const [category, setCategory] = useState<MarketCategory>(MarketCategory.GENERAL);
  const [closeAt, setCloseAt] = useState("");
  const [resolveAt, setResolveAt] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  const [customTitle, setCustomTitle] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customSourceName, setCustomSourceName] = useState("");
  const [customResolutionRule, setCustomResolutionRule] = useState("");
  const [customFallbackRule, setCustomFallbackRule] = useState("");
  const [publicResolutionMode, setPublicResolutionMode] = useState<ResolutionMode>(ResolutionMode.VERIFIED);
  const [privateResolutionMode, setPrivateResolutionMode] = useState<ResolutionMode>(ResolutionMode.HOST);

  const [unit, setUnit] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [precision, setPrecision] = useState("0");
  const [winnersCount, setWinnersCount] = useState("3");
  const [payoutDistributionInput, setPayoutDistributionInput] = useState("50,30,20");
  const [tieBreakerRule, setTieBreakerRule] = useState<NumericTieBreakerRule>(NumericTieBreakerRule.SPLIT);

  const defaultPrivateCommissionBps =
    trustedHostEligibility.privateCommissionPresets.find((value) => value === 200) ??
    trustedHostEligibility.privateCommissionPresets[0] ??
    0;
  const defaultPrivateChallengeWindowHours =
    trustedHostEligibility.privateChallengeWindowOptions[0] ?? trustedHostEligibility.challengeWindowHours;
  const [privateHostCommissionBps, setPrivateHostCommissionBps] = useState(String(defaultPrivateCommissionBps));
  const [bondCap, setBondCap] = useState(String(trustedHostEligibility.defaultBondCap));
  const [privateChallengeWindowHours, setPrivateChallengeWindowHours] = useState(
    String(defaultPrivateChallengeWindowHours)
  );
  const [hostPoolRewardMode, setHostPoolRewardMode] = useState<PoolRewardMode>(PoolRewardMode.COMMISSION_BASED);

  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const isCustomTemplate = true;
  const selectedGroup = groups.find((group) => group.id === groupId) ?? null;
  const numericSelectable = visibility === MarketVisibility.PRIVATE && isCustomTemplate;
  const effectiveMarketType =
    numericSelectable && marketType === MarketType.NUMERIC ? MarketType.NUMERIC : MarketType.BINARY;
  const trustedHostSelectable =
    visibility === MarketVisibility.PUBLIC &&
    isCustomTemplate &&
    effectiveMarketType === MarketType.BINARY &&
    trustedHostEligibility.eligible;

  const effectiveResolutionMode = useMemo(() => {
    if (!isCustomTemplate) {
      return ResolutionMode.VERIFIED;
    }

    if (effectiveMarketType === MarketType.NUMERIC) {
      return ResolutionMode.HOST;
    }

    if (visibility === MarketVisibility.PUBLIC) {
      if (publicResolutionMode === ResolutionMode.TRUSTED_HOST && trustedHostSelectable) {
        return ResolutionMode.TRUSTED_HOST;
      }

      return ResolutionMode.VERIFIED;
    }

    return privateResolutionMode;
  }, [effectiveMarketType, isCustomTemplate, privateResolutionMode, publicResolutionMode, trustedHostSelectable, visibility]);

  const parsedPayoutDistribution = useMemo(
    () => parseDistributionInput(payoutDistributionInput),
    [payoutDistributionInput]
  );
  const showVerifiedSourceInputs = isCustomTemplate && effectiveResolutionMode === ResolutionMode.VERIFIED;
  const showHostSettings =
    isCustomTemplate &&
    (effectiveResolutionMode === ResolutionMode.TRUSTED_HOST || effectiveResolutionMode === ResolutionMode.HOST);
  const showPrivateModePicker =
    visibility === MarketVisibility.PRIVATE &&
    isCustomTemplate &&
    effectiveMarketType === MarketType.BINARY;
  const showNumericSettings = isCustomTemplate && effectiveMarketType === MarketType.NUMERIC;
  const effectivePoolRewardMode = showHostSettings ? hostPoolRewardMode : PoolRewardMode.COMMISSION_BASED;
  const commissionBasedHosting = effectivePoolRewardMode === PoolRewardMode.COMMISSION_BASED;
  const bondBasedHosting = effectivePoolRewardMode === PoolRewardMode.BOND_BASED;
  const effectiveHostCommissionBps =
    commissionBasedHosting && effectiveResolutionMode === ResolutionMode.TRUSTED_HOST
      ? trustedHostEligibility.fixedCommissionBps
      : commissionBasedHosting && showHostSettings
        ? Number(privateHostCommissionBps || 0)
        : 0;
  const effectiveChallengeWindowHours =
    effectiveResolutionMode === ResolutionMode.TRUSTED_HOST
      ? trustedHostEligibility.challengeWindowHours
      : showHostSettings
        ? Number(privateChallengeWindowHours || defaultPrivateChallengeWindowHours)
        : trustedHostEligibility.challengeWindowHours;
  const effectiveBondCap = showHostSettings ? Number(bondCap || 0) : 0;
  const challengeWindowLabel = `${effectiveChallengeWindowHours} hour${
    effectiveChallengeWindowHours === 1 ? "" : "s"
  }`;
  const commissionPercent = (effectiveHostCommissionBps / 100).toFixed(2);
  const maxPoolAllowedPreview =
    !showHostSettings || effectiveBondCap <= 0
      ? null
      : commissionBasedHosting
        ? effectiveHostCommissionBps > 0
          ? Math.floor((effectiveBondCap * 10_000) / effectiveHostCommissionBps)
          : null
        : null;

  const preview = useMemo(() => {
    const sourceName =
      effectiveResolutionMode === ResolutionMode.TRUSTED_HOST
        ? "Trusted host resolution"
        : effectiveResolutionMode === ResolutionMode.HOST
          ? "Host resolution"
          : effectiveResolutionMode === ResolutionMode.GROUP_VOTE
            ? "Group vote"
            : customSourceName || "[named source]";

    if (effectiveMarketType === MarketType.NUMERIC) {
      return {
        title: customTitle || "[numeric question]",
        description:
          customDescription ||
          "Ask for a concrete number with a fixed unit, value range, and payout band for the closest guesses.",
        category,
        resolutionSourceType: ResolutionSourceType.MANUAL,
        resolutionSourceName: sourceName,
        resolutionRuleText:
          customResolutionRule ||
          "Host submits the actual resolved value. The system ranks guesses by absolute difference and distributes payouts automatically.",
        fallbackRuleText:
          customFallbackRule ||
          "If the host cannot provide the actual value before the deadline, the market times out, refunds participants, and may forfeit host rewards or bond.",
        structuredData:
          visibility === MarketVisibility.PRIVATE && groupId
            ? {
                groupId
              }
            : undefined
      };
    }

    return {
      title: customTitle || "[objective yes/no question]",
      description:
        customDescription ||
        "Explain what counts as YES, what timeframe matters, and any context forecasters need.",
      category,
      resolutionSourceType: ResolutionSourceType.MANUAL,
      resolutionSourceName: sourceName,
      resolutionRuleText:
        customResolutionRule ||
        (effectiveResolutionMode === ResolutionMode.TRUSTED_HOST
          ? "Resolve using the host's pre-written rule, evidence links, and challenge safeguards."
          : effectiveResolutionMode === ResolutionMode.HOST
            ? "Resolve using the pre-written host rule once the outcome is known."
            : effectiveResolutionMode === ResolutionMode.GROUP_VOTE
              ? "Resolve based on the written group-vote rule after the event window ends."
              : "Resolve YES or NO using the named public source and the exact rule written below."),
      fallbackRuleText:
        customFallbackRule ||
        (effectiveResolutionMode === ResolutionMode.VERIFIED
        ? "If the primary source fails, use the closest official or equally authoritative source and apply the same wording."
          : "If the chosen resolution process fails, cancel the market and refund all committed points."),
      structuredData:
        visibility === MarketVisibility.PRIVATE && groupId
          ? {
              groupId
            }
          : undefined
    };
  }, [
    category,
    customDescription,
    customFallbackRule,
    customResolutionRule,
    customSourceName,
    customTitle,
    effectiveMarketType,
    effectiveResolutionMode,
    groupId,
    visibility
  ]);

  function upsertGroup(nextGroup: GroupSummary) {
    setGroups((current) => dedupeGroups([nextGroup, ...current]));
    setGroupId(nextGroup.id);
    setVisibility(MarketVisibility.PRIVATE);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <Card>
        <CardHeader>
          <CardTitle>Create a prediction</CardTitle>
          <CardDescription>
            Start with the audience, then choose binary or numeric rules. Public markets stay stricter; private groups can run closer host-led challenges.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-medium text-ink-700">Audience</label>
            <div className="grid gap-3 sm:grid-cols-2">
              {([MarketVisibility.PUBLIC, MarketVisibility.PRIVATE] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setVisibility(option)}
                  className={`rounded-[24px] border px-4 py-4 text-left transition ${
                    visibility === option
                      ? "border-ink-900 bg-ink-900 text-white"
                      : "border-ink-100 bg-white text-ink-700 hover:border-ink-300"
                  }`}
                >
                  <p className="font-medium">{marketVisibilityLabels[option]}</p>
                  <p className={`mt-2 text-sm ${visibility === option ? "text-white/70" : "text-ink-500"}`}>
                    {option === MarketVisibility.PUBLIC
                      ? "Visible to everyone after moderation. Public markets use verified or trusted-host resolution."
                      : "Visible only inside a group. Private markets can use verified, host, or group-vote resolution, including numeric guesses."}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {visibility === MarketVisibility.PRIVATE && (
            <div className="space-y-4 rounded-[28px] border border-ink-100 p-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink-700">Private group</label>
                <Select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                  <option value="">Select a group</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} · {group.memberCount} members
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-ink-500">
                  {selectedGroup
                    ? `Invite code: ${selectedGroup.inviteCode}. Only members of ${selectedGroup.name} can see this market.`
                    : "Create or join a group first to unlock private predictions."}
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <CreateGroupForm onCreated={upsertGroup} />
                <JoinGroupForm onJoined={upsertGroup} />
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[24px] border border-ink-100 bg-ink-50 p-4">
              <p className="text-sm font-medium text-ink-900">Question format</p>
              <p className="mt-2 text-sm text-ink-600">
                Open question. Write your own objective market with custom rules, timing, and resolution method.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-700">Market type</label>
              <Select
                value={effectiveMarketType}
                onChange={(event) => setMarketType(event.target.value as MarketType)}
                disabled={visibility === MarketVisibility.PUBLIC}
              >
                <option value={MarketType.BINARY}>{marketTypeLabels.BINARY}</option>
                <option value={MarketType.NUMERIC} disabled={!numericSelectable}>
                  {marketTypeLabels.NUMERIC}
                </option>
              </Select>
              <p className="text-xs text-ink-500">
                {numericSelectable
                  ? "Numeric markets are private-only and use host-submitted actual values with automatic closest-guess payouts."
                  : visibility === MarketVisibility.PUBLIC
                    ? "Public markets are binary only for now."
                    : "Switch to a private group to unlock numeric guess markets."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-700">Category</label>
              <Select value={category} onChange={(event) => setCategory(event.target.value as MarketCategory)}>
                {Object.values(MarketCategory).map((option) => (
                  <option key={option} value={option}>
                    {marketCategoryLabels[option]}
                  </option>
                ))}
              </Select>
            </div>
            {showPrivateModePicker && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink-700">Resolution mode</label>
                <Select
                  value={privateResolutionMode}
                  onChange={(event) => setPrivateResolutionMode(event.target.value as ResolutionMode)}
                >
                  <option value={ResolutionMode.VERIFIED}>{resolutionModeLabels.VERIFIED}</option>
                  <option value={ResolutionMode.HOST}>{resolutionModeLabels.HOST}</option>
                  <option value={ResolutionMode.GROUP_VOTE}>{resolutionModeLabels.GROUP_VOTE}</option>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-[28px] border border-ink-100 p-5">
              <Input
                value={customTitle}
                onChange={(event) => setCustomTitle(event.target.value)}
                placeholder={
                  effectiveMarketType === MarketType.NUMERIC
                    ? "How many runs will India score in the first innings?"
                    : "Will Team A finish above Team B in the league table by May 31, 2026?"
                }
              />
              <Textarea
                value={customDescription}
                onChange={(event) => setCustomDescription(event.target.value)}
                placeholder={
                  effectiveMarketType === MarketType.NUMERIC
                    ? "Add context, the exact numeric value being estimated, and what evidence the host will use."
                    : "Add context, what counts as YES, and why this is an objective question."
                }
              />

              <div className="grid gap-4 sm:grid-cols-2">
                {visibility === MarketVisibility.PUBLIC ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-ink-700">Resolution mode</label>
                    <Select
                      value={effectiveResolutionMode}
                      onChange={(event) => setPublicResolutionMode(event.target.value as ResolutionMode)}
                    >
                      <option value={ResolutionMode.VERIFIED}>{resolutionModeLabels.VERIFIED}</option>
                      <option value={ResolutionMode.TRUSTED_HOST} disabled={!trustedHostEligibility.eligible}>
                        {resolutionModeLabels.TRUSTED_HOST}
                      </option>
                    </Select>
                  </div>
                ) : showVerifiedSourceInputs ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-ink-700">Source name</label>
                    <Input
                      value={customSourceName}
                      onChange={(event) => setCustomSourceName(event.target.value)}
                      placeholder="Official league table"
                    />
                  </div>
                ) : (
                  <div className="rounded-[20px] bg-ink-50 p-4 text-sm text-ink-600 sm:col-span-2">
                    {effectiveMarketType === MarketType.NUMERIC
                      ? "Numeric private markets always use host resolution. The host submits the actual value, but the system ranks guesses and allocates payouts automatically."
                      : "Private host and group-vote markets stay inside the selected group and still need clear written rules."}
                  </div>
                )}

                {visibility === MarketVisibility.PUBLIC && showVerifiedSourceInputs && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-ink-700">Source name</label>
                    <Input
                      value={customSourceName}
                      onChange={(event) => setCustomSourceName(event.target.value)}
                      placeholder="Official source"
                    />
                  </div>
                )}
              </div>

              {visibility === MarketVisibility.PUBLIC && (
                <div
                  className={`rounded-[24px] p-4 text-sm ${
                    trustedHostEligibility.eligible
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-amber-50 text-amber-800"
                  }`}
                >
                  <p className="font-medium text-ink-900">
                    {trustedHostEligibility.eligible
                      ? "Trusted-host public markets are unlocked for this account."
                      : "Trusted-host public markets are still locked for this account."}
                  </p>
                  <p className="mt-2">
                    Private markets count toward trust progress if they finalize fairly, have enough real participation, and avoid timeout or overturn outcomes.
                  </p>
                  {!trustedHostEligibility.eligible && trustedHostEligibility.reasons.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5">
                      {trustedHostEligibility.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {showNumericSettings && (
                <div className="space-y-4 rounded-[24px] border border-ink-100 bg-ink-50/70 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>Closest guess wins</Badge>
                    <Badge variant="accent">Private only</Badge>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-ink-700">Unit</label>
                      <Input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="runs, mm, crore, points" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-ink-700">Precision</label>
                      <Input
                        type="number"
                        min={0}
                        max={6}
                        value={precision}
                        onChange={(event) => setPrecision(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-ink-700">Minimum value</label>
                      <Input type="number" min={0} value={minValue} onChange={(event) => setMinValue(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-ink-700">Maximum value</label>
                      <Input type="number" min={0} value={maxValue} onChange={(event) => setMaxValue(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-ink-700">Winner count</label>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={winnersCount}
                        onChange={(event) => setWinnersCount(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-ink-700">Tie-breaker</label>
                      <Select
                        value={tieBreakerRule}
                        onChange={(event) => setTieBreakerRule(event.target.value as NumericTieBreakerRule)}
                      >
                        {Object.entries(numericTieBreakerLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-ink-700">Payout distribution (%)</label>
                    <Input
                      value={payoutDistributionInput}
                      onChange={(event) => setPayoutDistributionInput(event.target.value)}
                      placeholder="50,30,20"
                    />
                    <p className="text-xs text-ink-500">
                      Enter one percentage per winner slot, in order. Example: `50,30,20` for top 3 closest guesses.
                    </p>
                  </div>
                </div>
              )}

              {showVerifiedSourceInputs && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-ink-700">Source link</label>
                  <Input
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    placeholder="https://..."
                  />
                </div>
              )}

              {showHostSettings && (
                <div className="space-y-4 rounded-[24px] border border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">
                      {effectiveResolutionMode === ResolutionMode.TRUSTED_HOST ? "Trusted host safeguards" : "Host safeguards"}
                    </Badge>
                    <Badge>{poolRewardModeLabels[effectivePoolRewardMode]}</Badge>
                    <Badge>{challengeWindowLabel} challenge window</Badge>
                  </div>
                  <p className="text-sm text-amber-900">
                    The host cannot participate, must submit a resolution note, and faces timeout or bond forfeiture if the market is left unresolved or overturned. Rules lock once the market starts.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-ink-700">Hosting model</label>
                      <div className="flex flex-wrap gap-2">
                        {([PoolRewardMode.COMMISSION_BASED, PoolRewardMode.BOND_BASED] as const).map((mode) => {
                          const active = hostPoolRewardMode === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setHostPoolRewardMode(mode)}
                              className={`rounded-full border px-4 py-2 text-sm transition ${
                                active
                                  ? "border-ink-900 bg-ink-900 text-white"
                                  : "border-ink-200 bg-white text-ink-700 hover:border-ink-400"
                              }`}
                            >
                              {poolRewardModeLabels[mode]}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-ink-500">
                        Commission-based hosting pays from the final pool. Bond-based hosting pays the host from the locked bond only after clean finalization.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-ink-700">
                        {bondBasedHosting ? "Host bond / host stake" : "Bond cap"}
                      </label>
                      <Input
                        type="number"
                        min={0}
                        step={100}
                        value={bondCap}
                        onChange={(event) => setBondCap(event.target.value)}
                      />
                      <p className="text-xs text-ink-500">
                        Locked upfront from the host wallet. It returns only after clean finalization and can be forfeited on timeout or misconduct.
                      </p>
                    </div>
                    {commissionBasedHosting && (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-ink-700">Commission</label>
                          {effectiveResolutionMode === ResolutionMode.TRUSTED_HOST ? (
                            <div className="rounded-[20px] border border-ink-200 bg-white px-4 py-3 text-sm text-ink-700">
                              Fixed at {commissionPercent}% for public trusted-host markets.
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {trustedHostEligibility.privateCommissionPresets.map((presetBps) => {
                                const active = Number(privateHostCommissionBps) === presetBps;
                                return (
                                  <button
                                    key={presetBps}
                                    type="button"
                                    onClick={() => setPrivateHostCommissionBps(String(presetBps))}
                                    className={`rounded-full border px-4 py-2 text-sm transition ${
                                      active
                                        ? "border-ink-900 bg-ink-900 text-white"
                                        : "border-ink-200 bg-white text-ink-700 hover:border-ink-400"
                                    }`}
                                  >
                                    {(presetBps / 100).toFixed(presetBps % 100 === 0 ? 0 : 2)}%
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <p className="text-xs text-ink-500">
                            Commission is locked at creation, never varies by outcome, and pays only after clean finalization.
                          </p>
                        </div>
                        <div className="rounded-[20px] border border-dashed border-amber-300 bg-white px-4 py-3 text-sm text-amber-900">
                          {maxPoolAllowedPreview === null
                            ? "0% commission removes the commission-based pool cap. Bond still stays locked for accountability."
                            : `Max pool allowed with the current bond cap: ${maxPoolAllowedPreview.toLocaleString()} points.`}
                        </div>
                      </>
                    )}
                    {bondBasedHosting && (
                      <div className="rounded-[20px] border border-dashed border-amber-300 bg-white px-4 py-3 text-sm text-amber-900 sm:col-span-2">
                        <p>
                          Host reward if finalized cleanly:{" "}
                          <span className="font-semibold">{effectiveBondCap.toLocaleString()} points</span>.
                        </p>
                        <p className="mt-1">
                          No pool cap applies in bond-based mode. Participant entries stay open until close time.
                        </p>
                        <p className="mt-1">Timeout or misconduct forfeits the bond.</p>
                      </div>
                    )}
                    {effectiveResolutionMode === ResolutionMode.HOST && (
                      <>
                        <div className="space-y-2 sm:col-span-2">
                          <label className="text-sm font-medium text-ink-700">Challenge window</label>
                          <div className="flex flex-wrap gap-2">
                            {trustedHostEligibility.privateChallengeWindowOptions.map((hours) => {
                              const active = Number(privateChallengeWindowHours) === hours;
                              return (
                                <button
                                  key={hours}
                                  type="button"
                                  onClick={() => setPrivateChallengeWindowHours(String(hours))}
                                  className={`rounded-full border px-4 py-2 text-sm transition ${
                                    active
                                      ? "border-ink-900 bg-ink-900 text-white"
                                      : "border-ink-200 bg-white text-ink-700 hover:border-ink-400"
                                  }`}
                                >
                                  {hours}h
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                    {effectiveResolutionMode === ResolutionMode.TRUSTED_HOST && (
                      <div className="space-y-2 sm:col-span-2">
                          <label className="text-sm font-medium text-ink-700">Challenge window</label>
                          <div className="rounded-[20px] border border-ink-200 bg-white px-4 py-3 text-sm text-ink-700">
                            Platform fixed at {challengeWindowLabel} for public trusted-host markets.
                          </div>
                        </div>
                    )}
                    <div className="space-y-2 sm:col-span-2">
                      <label className="text-sm font-medium text-ink-700">Host deadlines</label>
                      <div className="rounded-[20px] border border-ink-200 bg-white px-4 py-3 text-sm text-ink-700">
                        Close time stops new entries. Resolve time is when the outcome should be known. The host gets up to {trustedHostEligibility.maxGracePeriodHours} hours of grace after that to submit the result.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <Textarea
                value={customResolutionRule}
                onChange={(event) => setCustomResolutionRule(event.target.value)}
                placeholder={
                  effectiveMarketType === MarketType.NUMERIC
                    ? "Describe the exact actual value the host must submit, the evidence source, and any unit conventions."
                    : effectiveResolutionMode === ResolutionMode.TRUSTED_HOST
                      ? "Write the exact rule the trusted host must apply, including the evidence standard."
                      : effectiveResolutionMode === ResolutionMode.HOST
                        ? "Describe exactly how the host resolves YES or NO using pre-written rules."
                        : effectiveResolutionMode === ResolutionMode.GROUP_VOTE
                          ? "Describe how the group vote decides YES or NO after resolve time."
                          : "Write the exact objective rule tied to the named source."
                }
              />
              <Textarea
                value={customFallbackRule}
                onChange={(event) => setCustomFallbackRule(event.target.value)}
                placeholder="Optional fallback rule"
              />
            </div>
          

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-700">Close at</label>
              <Input type="datetime-local" value={closeAt} onChange={(event) => setCloseAt(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-700">Resolve at</label>
              <Input type="datetime-local" value={resolveAt} onChange={(event) => setResolveAt(event.target.value)} />
            </div>
          </div>

          {message && <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-600">{message}</p>}

          <Button
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setMessage("");
                const response = await fetch("/api/markets/create", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    visibility,
                    groupId: visibility === MarketVisibility.PRIVATE ? groupId : "",
                    marketType: effectiveMarketType,
                    title: preview.title,
                    description: preview.description,
                    category: preview.category,
                    template,
                    closeAt: isoLocal(closeAt),
                    resolveAt: isoLocal(resolveAt),
                    resolutionMode: effectiveResolutionMode,
                    resolutionSourceType: preview.resolutionSourceType,
                    resolutionSourceName: preview.resolutionSourceName,
                    resolutionSourceUrl: sourceUrl,
                    resolutionRuleText: preview.resolutionRuleText,
                    fallbackRuleText: preview.fallbackRuleText,
                    structuredData: preview.structuredData,
                    unit: showNumericSettings ? unit : undefined,
                    minValue: showNumericSettings && minValue !== "" ? Number(minValue) : undefined,
                    maxValue: showNumericSettings && maxValue !== "" ? Number(maxValue) : undefined,
                    precision: showNumericSettings ? Number(precision || 0) : undefined,
                    winnersCount: showNumericSettings ? Number(winnersCount || 1) : undefined,
                    payoutDistribution: showNumericSettings ? parsedPayoutDistribution : undefined,
                    tieBreakerRule: showNumericSettings ? tieBreakerRule : undefined,
                    poolRewardMode: showHostSettings ? effectivePoolRewardMode : undefined,
                    hostCommissionBps: showHostSettings ? effectiveHostCommissionBps : undefined,
                    bondCap: showHostSettings ? effectiveBondCap : undefined,
                    challengeWindowHours: showHostSettings ? effectiveChallengeWindowHours : undefined,
                    gracePeriodHours: showHostSettings ? trustedHostEligibility.maxGracePeriodHours : undefined
                  })
                });
                const payload = (await response.json()) as { error?: string; market?: { id: string } };
                if (!response.ok || !payload.market) {
                  setMessage(payload.error ?? "Unable to create market.");
                  return;
                }
                router.push(`/markets/${payload.market.id}`);
                router.refresh();
              })
            }
          >
            {isPending ? "Submitting..." : "Create prediction"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>
              Public predictions go through moderation. Private group predictions open immediately for members.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[24px] bg-ink-50 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
                <span>{marketVisibilityLabels[visibility]}</span>
                <span>{marketCategoryLabels[preview.category]}</span>
                <span>{marketTypeLabels[effectiveMarketType]}</span>
                <span>{resolutionModeLabels[effectiveResolutionMode]}</span>
                {selectedGroup && visibility === MarketVisibility.PRIVATE && <span>{selectedGroup.name}</span>}
              </div>
              <h3 className="mt-3 text-xl font-semibold text-ink-900">{preview.title}</h3>
              <p className="mt-3 text-sm leading-7 text-ink-600">{preview.description}</p>
            </div>
            <div className="space-y-3 rounded-[24px] border border-ink-100 p-4 text-sm text-ink-600">
              <div>
                <p className="font-medium text-ink-800">Resolution source</p>
                <p>{preview.resolutionSourceName}</p>
              </div>
              <div>
                <p className="font-medium text-ink-800">Rule</p>
                <p>{preview.resolutionRuleText}</p>
              </div>
              <div>
                <p className="font-medium text-ink-800">Fallback</p>
                <p>{preview.fallbackRuleText}</p>
              </div>
              <div>
                <p className="font-medium text-ink-800">Timing</p>
                <p>
                  Closes {closeAt || "[select close time]"} · resolves {resolveAt || "[select resolve time]"}
                </p>
              </div>
              {showNumericSettings && (
                <div className="rounded-[20px] bg-ink-50 p-3">
                  <p className="font-medium text-ink-900">Numeric rules</p>
                  <p className="mt-1">
                    Closest {winnersCount || 1} guess{Number(winnersCount || 1) === 1 ? "" : "es"} win. Distribution:{" "}
                    {parsedPayoutDistribution.length > 0 ? parsedPayoutDistribution.join("% / ") : "[set payouts]"}%
                    {unit ? ` · unit: ${unit}` : ""}.
                  </p>
                </div>
              )}
              {showHostSettings && (
                <div className="rounded-[20px] bg-amber-50 p-3 text-amber-900">
                  <p className="font-medium">
                    {effectiveResolutionMode === ResolutionMode.TRUSTED_HOST ? "Trusted-host finalization" : "Host resolution safety"}
                  </p>
                  <p className="mt-1">
                    {commissionBasedHosting
                      ? `Commission-based hosting. Commission: ${commissionPercent}%${
                          maxPoolAllowedPreview !== null ? ` · max pool ${maxPoolAllowedPreview.toLocaleString()} pts` : ""
                        }.`
                      : `Bond-based hosting. Host reward if finalized cleanly: ${effectiveBondCap.toLocaleString()} pts.`}{" "}
                    Bond locked: {effectiveBondCap.toLocaleString()} pts. Challenge window: {challengeWindowLabel}. Grace period:{" "}
                    {trustedHostEligibility.maxGracePeriodHours} hours. Host cannot participate, missed resolution triggers timeout with refunds, and bond can be forfeited.
                  </p>
                  {bondBasedHosting && (
                    <p className="mt-2 text-xs text-amber-800">
                      No pool-size cap applies in bond-based mode. The host reward stays fixed at the locked bond amount.
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Trusted host progress</CardTitle>
            <CardDescription>Private markets count if they finalize fairly and meet the participation thresholds.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] bg-ink-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-ink-400">Account age</p>
                <p className="mt-2 text-lg font-semibold text-ink-900">
                  {trustedHostEligibility.progress.accountAgeDays.current} / {trustedHostEligibility.progress.accountAgeDays.target} days
                </p>
              </div>
              <div className="rounded-[20px] bg-ink-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-ink-400">Valid hosted markets</p>
                <p className="mt-2 text-lg font-semibold text-ink-900">
                  {trustedHostEligibility.progress.validFinalizedHostedMarkets.current} /{" "}
                  {trustedHostEligibility.progress.validFinalizedHostedMarkets.target}
                </p>
              </div>
              <div className="rounded-[20px] bg-ink-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-ink-400">Trust score</p>
                <p className="mt-2 text-lg font-semibold text-ink-900">
                  {trustedHostEligibility.progress.hostTrustScore.current} /{" "}
                  {trustedHostEligibility.progress.hostTrustScore.target}
                </p>
              </div>
              <div className="rounded-[20px] bg-ink-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-ink-400">Timeouts / Overturns</p>
                <p className="mt-2 text-lg font-semibold text-ink-900">
                  {trustedHostEligibility.progress.recentHostTimeoutCount.current} /{" "}
                  {trustedHostEligibility.progress.recentHostTimeoutCount.target} ·{" "}
                  {trustedHostEligibility.progress.overturnedHostedMarketsCount.current} /{" "}
                  {trustedHostEligibility.progress.overturnedHostedMarketsCount.target}
                </p>
              </div>
            </div>
            <div
              className={`rounded-[20px] p-4 text-sm ${
                trustedHostEligibility.eligible ? "bg-emerald-50 text-emerald-800" : "bg-ink-50 text-ink-700"
              }`}
            >
              <p className="font-medium text-ink-900">
                {trustedHostEligibility.eligible
                  ? "This account can create public trusted-host markets."
                  : "Build trust with clean private host markets to unlock public trusted-host markets."}
              </p>
              <p className="mt-2">
                Current trust score: {trustedHostEligibility.hostTrustScore}. Active hosting limit: {trustedHostEligibility.hostingLimit}.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
