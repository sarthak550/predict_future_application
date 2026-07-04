import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import type { ApiGroupSummary, ApiHostEligibility, AppMarketCategory, AppMarketStatus } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";
import { LinkifiedText } from "@/components/linkified-text";

const DRAFT_KEY = "draft_market_form";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES: Array<{ label: string; value: AppMarketCategory }> = [
  { label: "General", value: "GENERAL" },
  { label: "Finance", value: "FINANCE" },
  { label: "Sports", value: "SPORTS" },
  { label: "Business", value: "BUSINESS" },
  { label: "Tech", value: "TECH" },
  { label: "Weather", value: "WEATHER" },
  { label: "Entertainment", value: "ENTERTAINMENT" },
];

const CLOSE_PRESETS = [
  { label: "1 hour", hours: 1 },
  { label: "6 hours", hours: 6 },
  { label: "12 hours", hours: 12 },
  { label: "1 day", hours: 24 },
  { label: "2 days", hours: 48 },
  { label: "3 days", hours: 72 },
  { label: "1 week", hours: 168 },
  { label: "2 weeks", hours: 336 },
  { label: "1 month", hours: 720 },
];

const RESOLVE_PRESETS = [
  { label: "At close", hours: 0 },
  { label: "+ 1 hour", hours: 1 },
  { label: "+ 6 hours", hours: 6 },
  { label: "+ 12 hours", hours: 12 },
  { label: "+ 1 day", hours: 24 },
  { label: "+ 2 days", hours: 48 },
  { label: "+ 3 days", hours: 72 },
  { label: "+ 1 week", hours: 168 },
];

const COMMISSION_PRESETS = [
  { label: "0% (Free)", bps: 0 },
  { label: "2%", bps: 200 },
  { label: "5%", bps: 500 },
];

const CHALLENGE_WINDOW_OPTIONS = [
  { label: "6 hours", hours: 6 },
  { label: "12 hours", hours: 12 },
  { label: "24 hours", hours: 24 },
];

const GRACE_PERIOD_OPTIONS = [
  { label: "12 hours", hours: 12 },
  { label: "24 hours", hours: 24 },
  { label: "48 hours", hours: 48 },
];

type Visibility = "PUBLIC" | "PRIVATE";
type MarketType = "BINARY" | "NUMERIC" | "MULTIPLE_CHOICE";
type PoolRewardMode = "COMMISSION_BASED" | "BOND_BASED";

// Steps: Audience, Type, Question, Timing, [Host Settings — Advanced only], Review
type StepId =
  | "audience"
  | "type"
  | "question"
  | "timing"
  | "host_settings"
  | "review";

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CreateScreen() {
  const { session, status: sessionStatus } = useSession();
  const userId = session?.userId;
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Prefill params passed from Sports tab or other deep links
  const params = useLocalSearchParams<{
    initialTitle?: string;
    initialCategory?: string;
    initialDescription?: string;
    preselectCategory?: string;
  }>();
  const initialTitle = typeof params.initialTitle === "string" ? params.initialTitle : undefined;
  const initialDescription = typeof params.initialDescription === "string" ? params.initialDescription : undefined;
  const initialCategory =
    typeof params.initialCategory === "string"
      ? (params.initialCategory as AppMarketCategory)
      : typeof params.preselectCategory === "string"
        ? (params.preselectCategory as AppMarketCategory)
        : undefined;

  const eligibilityFetcher = useCallback(
    () => mobileApi.getHostEligibility(),
    [] // no deps — auth token is read from SecureStore at request time
  );

  const { data: eligibilityData, status: eligibilityStatus } = useApiQuery<{
    eligibility: ApiHostEligibility;
  }>(eligibilityFetcher, ["host-eligibility"], {
    enabled: sessionStatus === "authenticated",
  });

  if (sessionStatus !== "authenticated" || !userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.heroTitle}>Create a Prediction</Text>
        <Text style={styles.heroSub}>
          Sign in to create prediction markets and challenge the crowd.
        </Text>
      </View>
    );
  }

  const eligibility = eligibilityData?.eligibility ?? null;

  // `/(tabs)/create` is a persistent tab — once mounted it is NOT remounted when a
  // deep-link arrives with new params, so the wizard's mount-time `useState(initial…)`
  // seeds would go stale and ignore the prefill. Keying the wizard on the prefill
  // params forces a fresh, re-seeded wizard whenever a deep-link prefill arrives,
  // while plain navigation (no params) keeps a stable key and preserves in-progress work.
  const prefillKey =
    initialTitle != null || initialDescription != null || initialCategory != null
      ? `prefill:${initialTitle ?? ""}|${initialCategory ?? ""}|${initialDescription ?? ""}`
      : "wizard";

  return (
    <View style={styles.screen}>
      <CreateWizard
        key={prefillKey}
        userId={userId}
        initialTitle={initialTitle}
        initialCategory={initialCategory}
        initialDescription={initialDescription}
        isAdmin={eligibility?.isAdmin ?? false}
        eligibility={eligibility}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Share helper (mirrors market detail screen helper)
// ---------------------------------------------------------------------------

async function shareOpenMarket(title: string, marketId: string) {
  try {
    await Share.share({
      message: `"${title}" — what do you think? Predict on Predict Future: https://predictfuture.app/markets/${marketId}`,
      url: `https://predictfuture.app/markets/${marketId}`,
    });
  } catch {
    // user dismissed share sheet — no-op
  }
}

// ---------------------------------------------------------------------------
// Success state type
// ---------------------------------------------------------------------------

type SuccessState = {
  marketId: string;
  marketTitle: string;
  marketStatus: AppMarketStatus;
};

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

function CreateWizard({
  userId,
  initialTitle,
  initialCategory,
  initialDescription,
  isAdmin,
  eligibility,
}: {
  userId: string;
  initialTitle?: string;
  initialCategory?: AppMarketCategory;
  initialDescription?: string;
  isAdmin: boolean;
  eligibility: ApiHostEligibility | null;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);

  // "Draft saved" indicator — shown for 2s after each step advance
  const [showSaved, setShowSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Advanced mode — when false, host_settings step is hidden and defaults are used
  const [advancedMode, setAdvancedMode] = useState(false);

  // --- Form state ---
  // First-release: default every user to "Everyone" (PUBLIC) so audience selection
  // is never a blocker. (Was: default PRIVATE when ineligible to host public markets.)
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [marketType, setMarketType] = useState<MarketType>("BINARY");
  const [category, setCategory] = useState<AppMarketCategory>(initialCategory ?? "GENERAL");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [description, setDescription] = useState(initialDescription ?? "");

  // Timing — store actual dates
  const [closeAt, setCloseAt] = useState<Date>(() => new Date(Date.now() + 24 * 3600000));
  const [resolveAt, setResolveAt] = useState<Date>(() => new Date(Date.now() + 48 * 3600000));

  // Numeric
  const [unit, setUnit] = useState("");
  const [minValue, setMinValue] = useState("0");
  const [maxValue, setMaxValue] = useState("100");

  // Multiple choice options
  const [mcOptions, setMcOptions] = useState<string[]>(["", ""]);

  // Host settings
  const [poolRewardMode, setPoolRewardMode] = useState<PoolRewardMode>("COMMISSION_BASED");
  const [bondCap, setBondCap] = useState("500");
  const [commissionBps, setCommissionBps] = useState(200);
  const [challengeWindowHours, setChallengeWindowHours] = useState(12);
  const [gracePeriodHours, setGracePeriodHours] = useState(48);

  // Flagship event — admin-only toggle for FINANCE markets
  const [isFlagshipEvent, setIsFlagshipEvent] = useState<boolean>(false);
  const [flagshipEventAt, setFlagshipEventAt] = useState<Date | null>(null);
  const [flagshipEventType, setFlagshipEventType] = useState<string>("RBI");

  // Draft banner state
  const [draftBanner, setDraftBanner] = useState<"hidden" | "visible">("hidden");

  // Groups
  const groupsFetcher = useCallback(
    () => mobileApi.getMyGroups({ userId }),
    [userId]
  );
  const { data: groupsData, refetch: refetchGroups } = useApiQuery<{
    groups: Array<ApiGroupSummary & { memberCount?: number }>;
  }>(groupsFetcher, [userId]);
  const groups = groupsData?.groups ?? [];

  // Build the step list dynamically
  // Simple mode (default): audience → type → question → timing → review (4 meaningful steps)
  // Advanced mode: audience → type → question → timing → host_settings → review
  const steps: StepId[] = useMemo(() => {
    const base: StepId[] = ["audience", "type", "question", "timing"];
    if (advancedMode) base.push("host_settings");
    base.push("review");
    return base;
  }, [advancedMode]);

  const currentStep = steps[stepIdx] ?? "audience";
  const totalSteps = steps.length;

  // Reset dependent state when visibility changes
  useEffect(() => {
    if (visibility === "PUBLIC") {
      setGroupId(null);
    }
  }, [visibility]);

  // Draft — load on mount
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY).then((raw) => {
      if (!raw) return;
      try {
        const draft = JSON.parse(raw) as Record<string, unknown>;
        if (typeof draft.title === "string" && draft.title.length > 0) {
          setDraftBanner("visible");
        }
      } catch {
        // ignore malformed draft
      }
    });
  }, []);

  // Draft — save on every step advance
  async function saveDraft() {
    const state = {
      version: 1,
      visibility,
      groupId,
      marketType,
      category,
      title,
      description,
      closeAt: closeAt.toISOString(),
      resolveAt: resolveAt.toISOString(),
      unit,
      minValue,
      maxValue,
      mcOptions,
      isFlagshipEvent,
      flagshipEventAt: flagshipEventAt ? flagshipEventAt.toISOString() : null,
      flagshipEventType,
      poolRewardMode,
      bondCap,
      commissionBps,
      challengeWindowHours,
      gracePeriodHours,
      advancedMode,
    };
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  }

  function restoreDraft(draft: Record<string, unknown>) {
    // Ignore drafts from a future schema version; allow missing version (pre-v1 legacy) or v1
    if (draft.version !== undefined && draft.version !== 1) return;

    if (typeof draft.visibility === "string") setVisibility(draft.visibility as Visibility);
    if (typeof draft.groupId === "string" || draft.groupId === null) setGroupId(draft.groupId as string | null);
    if (typeof draft.marketType === "string") setMarketType(draft.marketType as MarketType);
    if (typeof draft.category === "string") setCategory(draft.category as AppMarketCategory);
    if (typeof draft.title === "string") setTitle(draft.title);
    if (typeof draft.description === "string") setDescription(draft.description);
    if (typeof draft.closeAt === "string") { const d = new Date(draft.closeAt); if (!isNaN(d.getTime())) setCloseAt(d); }
    if (typeof draft.resolveAt === "string") { const d = new Date(draft.resolveAt); if (!isNaN(d.getTime())) setResolveAt(d); }
    if (typeof draft.unit === "string") setUnit(draft.unit);
    if (typeof draft.minValue === "string") setMinValue(draft.minValue);
    if (typeof draft.maxValue === "string") setMaxValue(draft.maxValue);
    if (Array.isArray(draft.mcOptions) && draft.mcOptions.every((o) => typeof o === "string")) {
      setMcOptions(draft.mcOptions as string[]);
    }
    if (typeof draft.isFlagshipEvent === "boolean") setIsFlagshipEvent(draft.isFlagshipEvent);
    if (typeof draft.flagshipEventAt === "string") {
      const d = new Date(draft.flagshipEventAt);
      if (!isNaN(d.getTime())) setFlagshipEventAt(d);
    }
    if (typeof draft.flagshipEventType === "string") setFlagshipEventType(draft.flagshipEventType);
    if (typeof draft.poolRewardMode === "string") setPoolRewardMode(draft.poolRewardMode as PoolRewardMode);
    if (typeof draft.bondCap === "string") setBondCap(draft.bondCap);
    if (typeof draft.commissionBps === "number") setCommissionBps(draft.commissionBps);
    if (typeof draft.challengeWindowHours === "number") setChallengeWindowHours(draft.challengeWindowHours);
    if (typeof draft.gracePeriodHours === "number") setGracePeriodHours(draft.gracePeriodHours);
    if (typeof draft.advancedMode === "boolean") setAdvancedMode(draft.advancedMode);
  }

  // Navigation
  function next() {
    void saveDraft();
    // Show "Draft saved" indicator for 2 seconds
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setShowSaved(true);
    savedTimerRef.current = setTimeout(() => setShowSaved(false), 2000);
    if (stepIdx < totalSteps - 1) setStepIdx(stepIdx + 1);
  }
  function back() {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }

  // Cleanup saved indicator timer on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // Validation per step
  function canAdvance(): boolean {
    switch (currentStep) {
      case "audience":
        return visibility === "PUBLIC" || Boolean(groupId);
      case "type":
        return true;
      case "question":
        if (marketType === "MULTIPLE_CHOICE") {
          const trimmed = mcOptions.map((o) => o.trim());
          const validOptions = trimmed.filter((o) => o.length > 0);
          const unique = new Set(validOptions);
          return title.length >= 12 && description.length >= 24 && validOptions.length >= 2 && unique.size === validOptions.length;
        }
        return title.length >= 12 && description.length >= 24;
      case "host_settings":
        return Number(bondCap) >= 100;
      case "timing":
        return closeAt > new Date() && resolveAt > closeAt;
      default:
        return true;
    }
  }

  // Submit
  async function handleSubmit() {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        visibility,
        marketType,
        title,
        description,
        category,
        template: "CUSTOM",
        closeAt: closeAt.toISOString(),
        resolveAt: resolveAt.toISOString(),
        resolutionMode: "HOST",
        resolutionRuleText: description,
        resolutionSourceType: "MANUAL",
        resolutionSourceName: "Host resolution",
        ...(visibility === "PRIVATE" && groupId
          ? { groupId, structuredData: { groupId } }
          : {}),
        ...(isAdmin && isFlagshipEvent && flagshipEventAt
          ? {
              flagshipEventAt: flagshipEventAt.toISOString(),
              flagshipEventType,
            }
          : {}),
        ...(marketType === "NUMERIC"
          ? {
              unit: unit || "units",
              minValue: Number(minValue) || 0,
              maxValue: Number(maxValue) || 100,
              precision: 0,
              winnersCount: 1,
              payoutDistribution: [100],
              tieBreakerRule: "SPLIT",
            }
          : {}),
        ...(marketType === "MULTIPLE_CHOICE"
          ? {
              options: mcOptions
                .map((label) => label.trim())
                .filter((label) => label.length > 0)
                .map((label) => ({ label })),
            }
          : {}),
        poolRewardMode,
        hostCommissionBps: poolRewardMode === "BOND_BASED" ? 0 : commissionBps,
        bondCap: Number(bondCap) || 500,
        challengeWindowHours,
        gracePeriodHours,
      };

      const result = await mobileApi.createMarket(body, { userId });
      await AsyncStorage.removeItem(DRAFT_KEY);
      const createdMarketId = result?.market?.id;
      const createdMarketStatus = result?.market?.status ?? "PENDING_REVIEW";
      if (createdMarketId) {
        setSuccessState({
          marketId: createdMarketId,
          marketTitle: title,
          marketStatus: createdMarketStatus,
        });
      } else {
        Alert.alert("Market Created!", "Your prediction market is live.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create market.";
      Alert.alert("Error", message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleCreateAnother() {
    setSuccessState(null);
    setStepIdx(0);
    setTitle(initialTitle ?? "");
    setDescription("");
    setUnit("");
    setVisibility("PUBLIC");
    setGroupId(null);
    setMarketType("BINARY");
    setCategory(initialCategory ?? "GENERAL");
    setCloseAt(new Date(Date.now() + 24 * 3600000));
    setResolveAt(new Date(Date.now() + 48 * 3600000));
    setMcOptions(["", ""]);
    setIsFlagshipEvent(false);
    setFlagshipEventAt(null);
    setFlagshipEventType("RBI");
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (successState) {
    const isLive = successState.marketStatus === "OPEN";

    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, styles.successContainer]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Checkmark icon */}
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark-circle" size={72} color={colors.success} />
          </View>

          <Text style={styles.successHeadline}>Market Created!</Text>
          <Text style={styles.successTitle} numberOfLines={3}>
            {successState.marketTitle}
          </Text>

          {isLive ? (
            <View style={styles.successStatusBadge}>
              <Text style={styles.successStatusLive}>Your market is live!</Text>
            </View>
          ) : (
            <View style={[styles.successStatusBadge, styles.successStatusPendingBadge]}>
              <Text style={styles.successStatusPending}>
                Pending review — we'll notify you when it's approved.
              </Text>
            </View>
          )}

          {/* Share button — only for live markets */}
          {isLive && (
            <Pressable
              style={styles.successShareBtn}
              onPress={() => void shareOpenMarket(successState.marketTitle, successState.marketId)}
            >
              <Ionicons name="share-outline" size={18} color="#FFFFFF" />
              <Text style={styles.successShareBtnText}>Share it</Text>
            </Pressable>
          )}

          {/* Primary CTA */}
          <Pressable
            style={styles.successViewBtn}
            onPress={() => router.push(`/market/${successState.marketId}`)}
          >
            <Text style={styles.successViewBtnText}>View Market</Text>
          </Pressable>

          {/* Secondary CTA */}
          <Pressable
            style={styles.successAnotherBtn}
            onPress={handleCreateAnother}
          >
            <Text style={styles.successAnotherBtnText}>Create Another</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Wizard ─────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Progress */}
        <View style={styles.progressRow}>
          {steps.map((_, i) => (
            <View
              key={i}
              style={[styles.progressDot, i <= stepIdx && styles.progressDotActive]}
            />
          ))}
        </View>
        <Text style={styles.stepLabel}>
          Step {stepIdx + 1} of {totalSteps}
        </Text>

        {/* Draft banner — shown on step 1 only */}
        {currentStep === "audience" && draftBanner === "visible" && (
          <View style={styles.draftBanner}>
            <Text style={styles.draftBannerText}>You have a saved draft.</Text>
            <View style={styles.draftBannerButtons}>
              <Pressable
                style={styles.draftBannerBtn}
                onPress={() => {
                  AsyncStorage.getItem(DRAFT_KEY).then((raw) => {
                    if (!raw) return;
                    try {
                      const draft = JSON.parse(raw) as Record<string, unknown>;
                      restoreDraft(draft);
                    } catch {
                      // ignore
                    }
                  });
                  setDraftBanner("hidden");
                }}
              >
                <Text style={styles.draftBannerBtnText}>Restore Draft</Text>
              </Pressable>
              <Pressable
                style={[styles.draftBannerBtn, styles.draftBannerBtnOutline]}
                onPress={() => {
                  void AsyncStorage.removeItem(DRAFT_KEY);
                  setDraftBanner("hidden");
                }}
              >
                <Text style={[styles.draftBannerBtnText, styles.draftBannerBtnOutlineText]}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Steps */}
        {currentStep === "audience" && (
          <StepAudience
            visibility={visibility}
            setVisibility={setVisibility}
            groupId={groupId}
            setGroupId={setGroupId}
            groups={groups}
            userId={userId}
            refetchGroups={refetchGroups}
            // First-release: everyone can host public markets (eligibility gate off),
            // so the "Everyone" option is always selectable — no blocker for new users.
            eligible={true}
            eligibilityReasons={eligibility?.reasons ?? []}
          />
        )}
        {currentStep === "type" && (
          <StepType
            marketType={marketType}
            setMarketType={setMarketType}
            category={category}
            setCategory={setCategory}
          />
        )}
        {currentStep === "question" && (
          <StepQuestion
            marketType={marketType}
            title={title}
            setTitle={setTitle}
            description={description}
            setDescription={setDescription}
            unit={unit}
            setUnit={setUnit}
            minValue={minValue}
            setMinValue={setMinValue}
            maxValue={maxValue}
            setMaxValue={setMaxValue}
            mcOptions={mcOptions}
            setMcOptions={setMcOptions}
          />
        )}
        {currentStep === "host_settings" && (
          <StepHostSettings
            poolRewardMode={poolRewardMode}
            setPoolRewardMode={setPoolRewardMode}
            bondCap={bondCap}
            setBondCap={setBondCap}
            commissionBps={commissionBps}
            setCommissionBps={setCommissionBps}
            challengeWindowHours={challengeWindowHours}
            setChallengeWindowHours={setChallengeWindowHours}
            gracePeriodHours={gracePeriodHours}
            setGracePeriodHours={setGracePeriodHours}
          />
        )}
        {currentStep === "timing" && (
          <>
            <StepTiming
              closeAt={closeAt}
              setCloseAt={setCloseAt}
              resolveAt={resolveAt}
              setResolveAt={setResolveAt}
              gracePeriodHours={gracePeriodHours}
            />
            {/* Flagship event toggle — admin-only, FINANCE category only */}
            {isAdmin && category === "FINANCE" && (
              <FlagshipEventSection
                isFlagshipEvent={isFlagshipEvent}
                setIsFlagshipEvent={(val) => {
                  setIsFlagshipEvent(val);
                  if (val && !flagshipEventAt) {
                    const defaultDate = new Date(Date.now() + 7 * 24 * 3600000);
                    setFlagshipEventAt(defaultDate);
                    setCloseAt(defaultDate);
                  }
                  if (!val) {
                    setCloseAt(new Date(Date.now() + 24 * 3600000));
                  }
                }}
                flagshipEventAt={flagshipEventAt}
                setFlagshipEventAt={(date) => {
                  setFlagshipEventAt(date);
                  if (date) setCloseAt(date);
                }}
                flagshipEventType={flagshipEventType}
                setFlagshipEventType={setFlagshipEventType}
              />
            )}
            {/* Advanced settings disclosure — only shown on timing step */}
            <Pressable
              style={({ pressed }) => [styles.advancedToggleRow, pressed && { opacity: 0.7 }]}
              onPress={() => setAdvancedMode((prev) => !prev)}
            >
              <Ionicons
                name={advancedMode ? "settings" : "settings-outline"}
                size={16}
                color={advancedMode ? colors.accent : colors.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.advancedToggleLabel, advancedMode && styles.advancedToggleLabelActive]}>
                  Advanced settings
                </Text>
                <Text style={styles.advancedToggleSub}>
                  Set commission, challenge window, and bond cap
                </Text>
              </View>
              <Ionicons
                name={advancedMode ? "chevron-down" : "chevron-forward"}
                size={14}
                color={advancedMode ? colors.accent : colors.textMuted}
              />
            </Pressable>
          </>
        )}
        {currentStep === "review" && (
          <StepReview
            visibility={visibility}
            marketType={marketType}
            category={category}
            title={title}
            description={description}
            closeAt={closeAt}
            resolveAt={resolveAt}
            groupName={groups.find((g) => g.id === groupId)?.name}
            poolRewardMode={poolRewardMode}
            bondCap={bondCap}
            commissionBps={commissionBps}
            challengeWindowHours={challengeWindowHours}
            gracePeriodHours={gracePeriodHours}
          />
        )}

        {/* "Draft saved" indicator */}
        {showSaved && (
          <Text style={styles.draftSavedLabel}>Draft saved</Text>
        )}

        {/* Navigation */}
        <View style={styles.navRow}>
          {stepIdx > 0 && (
            <Pressable style={styles.backBtn} onPress={back}>
              <Text style={styles.backLabel}>Back</Text>
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          {currentStep !== "review" ? (
            <Pressable
              style={[styles.nextBtn, !canAdvance() && styles.btnDisabled]}
              onPress={next}
              disabled={!canAdvance()}
            >
              <Text style={styles.nextLabel}>Next</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.submitBtn, submitting && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.nextLabel}>Create Market</Text>
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Step — Audience
// ---------------------------------------------------------------------------

function StepAudience({
  visibility,
  setVisibility,
  groupId,
  setGroupId,
  groups,
  userId,
  refetchGroups,
  eligible,
  eligibilityReasons,
}: {
  visibility: Visibility;
  setVisibility: (v: Visibility) => void;
  groupId: string | null;
  setGroupId: (id: string | null) => void;
  groups: Array<ApiGroupSummary & { memberCount?: number }>;
  userId: string;
  refetchGroups: () => Promise<void>;
  eligible: boolean;
  eligibilityReasons: string[];
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [actionSheet, setActionSheet] = useState<"create" | "join" | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  // S56: three-tier visibility. New groups default to OPEN (appears in discover feed).
  const [newGroupVisibility, setNewGroupVisibility] = useState<"OPEN" | "REQUEST_TO_JOIN" | "INVITE_ONLY">("OPEN");
  const [newGroupCategory, setNewGroupCategory] = useState<AppMarketCategory | null>(null);

  const selectedGroup = groups.find((g) => g.id === groupId);

  async function handleCreateGroup() {
    if (newGroupName.length < 3) {
      Alert.alert("Error", "Group name must be at least 3 characters.");
      return;
    }
    setLoading(true);
    try {
      const result = await mobileApi.createGroup(
        {
          name: newGroupName,
          description: newGroupDesc || undefined,
          visibility: newGroupVisibility,
          category: newGroupCategory ?? undefined
        },
        { userId }
      );
      setGroupId(result.group.id);
      setActionSheet(null);
      setNewGroupName("");
      setNewGroupDesc("");
      setNewGroupVisibility("OPEN");
      setNewGroupCategory(null);
      void refetchGroups();
      if (newGroupVisibility === "INVITE_ONLY") {
        Alert.alert("Group Created!", `Share invite code: ${result.group.inviteCode}`);
      } else if (newGroupVisibility === "REQUEST_TO_JOIN") {
        Alert.alert("Group Created!", "Your group is discoverable — you approve every member before they join.");
      } else {
        Alert.alert("Group Created!", "Your group is now discoverable by anyone.");
      }
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinGroup() {
    if (inviteCode.length < 4) {
      Alert.alert("Error", "Enter a valid invite code.");
      return;
    }
    setLoading(true);
    try {
      const result = await mobileApi.joinGroup({ inviteCode }, { userId });
      setGroupId(result.group.id);
      setActionSheet(null);
      setInviteCode("");
      void refetchGroups();
      Alert.alert("Joined!", `You joined ${result.group.name}`);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View>
      <Text style={styles.stepTitle}>Who can see this?</Text>
      <Text style={styles.stepDesc}>Choose who can participate in your prediction.</Text>

      {eligible ? (
        <Pressable
          style={[styles.optionCard, visibility === "PUBLIC" && styles.optionCardActive]}
          onPress={() => setVisibility("PUBLIC")}
        >
          <View style={styles.optionRow}>
            <Ionicons
              name="globe-outline"
              size={22}
              color={visibility === "PUBLIC" ? colors.accent : colors.textMuted}
            />
            <View style={styles.optionContent}>
              <Text style={[styles.optionTitle, visibility === "PUBLIC" && styles.optionTitleActive]}>
                Everyone
              </Text>
              <Text style={[styles.optionDesc, visibility === "PUBLIC" && styles.optionDescActive]}>
                Anyone can see and predict. Goes through moderation.
              </Text>
            </View>
          </View>
        </Pressable>
      ) : (
        <View style={[styles.optionCard, styles.optionCardLocked]}>
          <View style={styles.optionRow}>
            <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
            <View style={styles.optionContent}>
              <Text style={[styles.optionTitle, styles.optionTitleMuted]}>Everyone</Text>
              <Text style={[styles.optionDesc]}>
                Anyone can see and predict. Goes through moderation.
              </Text>
              {eligibilityReasons.length > 0 ? (
                eligibilityReasons.map((r) => (
                  <Text key={r} style={styles.eligibilityReasonItem}>• {r}</Text>
                ))
              ) : (
                <Text style={styles.eligibilityReasonItem}>
                  Complete host requirements to create public markets.
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      <Pressable
        style={[styles.optionCard, visibility === "PRIVATE" && styles.optionCardActive]}
        onPress={() => setVisibility("PRIVATE")}
      >
        <View style={styles.optionRow}>
          <Ionicons
            name="people-outline"
            size={22}
            color={visibility === "PRIVATE" ? colors.accent : colors.textMuted}
          />
          <View style={styles.optionContent}>
            <Text style={[styles.optionTitle, visibility === "PRIVATE" && styles.optionTitleActive]}>
              Private Group
            </Text>
            <Text style={[styles.optionDesc, visibility === "PRIVATE" && styles.optionDescActive]}>
              Only your group members can see and predict.
            </Text>
          </View>
        </View>
      </Pressable>

      {visibility === "PRIVATE" && (
        <View style={styles.groupSection}>
          {/* Dropdown */}
          {groups.length > 0 ? (
            <View style={styles.grpDropdownWrapper}>
              <Text style={styles.label}>Select a group</Text>
              <Pressable
                style={styles.grpDropdownTrigger}
                onPress={() => setDropdownOpen((prev) => !prev)}
              >
                <Ionicons name="people-circle-outline" size={20} color={colors.accent} />
                <Text style={styles.grpDropdownText} numberOfLines={1}>
                  {selectedGroup?.name ?? "Choose a group..."}
                </Text>
                <Ionicons
                  name={dropdownOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.textMuted}
                />
              </Pressable>

              {dropdownOpen && (
                <View style={styles.grpDropdownMenu}>
                  {groups.map((g) => (
                    <Pressable
                      key={g.id}
                      style={[styles.grpDropdownItem, groupId === g.id && styles.grpDropdownItemActive]}
                      onPress={() => { setGroupId(g.id); setDropdownOpen(false); }}
                    >
                      <View style={styles.grpDropdownItemLeft}>
                        <Text
                          style={[styles.grpDropdownItemName, groupId === g.id && styles.grpDropdownItemNameActive]}
                          numberOfLines={1}
                        >
                          {g.name}
                        </Text>
                        {g.memberCount != null && (
                          <Text style={styles.grpDropdownItemMeta}>
                            {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                          </Text>
                        )}
                      </View>
                      {groupId === g.id && (
                        <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ) : (
            <View style={styles.grpEmptyCard}>
              <Ionicons name="people-outline" size={32} color={colors.textMuted} />
              <Text style={styles.grpEmptyTitle}>No groups yet</Text>
              <Text style={styles.grpEmptyDesc}>
                Create a new group or join one with an invite code.
              </Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={styles.grpActionRow}>
            <Pressable
              style={[styles.grpActionBtn, actionSheet === "create" && styles.grpActionBtnActive]}
              onPress={() => setActionSheet(actionSheet === "create" ? null : "create")}
            >
              <Ionicons
                name="add-circle-outline"
                size={18}
                color={actionSheet === "create" ? "#FFFFFF" : colors.accent}
              />
              <Text
                style={[styles.grpActionBtnText, actionSheet === "create" && styles.grpActionBtnTextActive]}
              >
                New Group
              </Text>
            </Pressable>
            <Pressable
              style={[styles.grpActionBtn, actionSheet === "join" && styles.grpActionBtnActive]}
              onPress={() => setActionSheet(actionSheet === "join" ? null : "join")}
            >
              <Ionicons
                name="enter-outline"
                size={18}
                color={actionSheet === "join" ? "#FFFFFF" : colors.accent}
              />
              <Text
                style={[styles.grpActionBtnText, actionSheet === "join" && styles.grpActionBtnTextActive]}
              >
                Join Group
              </Text>
            </Pressable>
          </View>

          {/* Create sheet */}
          {actionSheet === "create" && (
            <View style={styles.grpSheet}>
              <Text style={styles.grpSheetTitle}>Create a new group</Text>
              <TextInput
                style={styles.input}
                placeholder="Group name"
                placeholderTextColor={colors.textMuted}
                value={newGroupName}
                onChangeText={setNewGroupName}
                maxLength={80}
              />
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                placeholder="Description (optional)"
                placeholderTextColor={colors.textMuted}
                value={newGroupDesc}
                onChangeText={setNewGroupDesc}
                maxLength={200}
              />

              {/* S56: Visibility picker — three-tier (Open | Request to join | Invite only) */}
              <Text style={styles.grpFieldLabel}>Visibility</Text>
              <View style={styles.grpToggleRow}>
                <Pressable
                  style={[
                    styles.grpToggleBtn,
                    newGroupVisibility === "OPEN" && styles.grpToggleBtnActive
                  ]}
                  onPress={() => setNewGroupVisibility("OPEN")}
                >
                  <Ionicons
                    name="globe-outline"
                    size={14}
                    color={newGroupVisibility === "OPEN" ? "#FFFFFF" : colors.accent}
                  />
                  <Text
                    style={[
                      styles.grpToggleBtnText,
                      newGroupVisibility === "OPEN" && styles.grpToggleBtnTextActive
                    ]}
                  >
                    Open
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.grpToggleBtn,
                    newGroupVisibility === "REQUEST_TO_JOIN" && styles.grpToggleBtnActive
                  ]}
                  onPress={() => setNewGroupVisibility("REQUEST_TO_JOIN")}
                >
                  <Ionicons
                    name="person-add-outline"
                    size={14}
                    color={newGroupVisibility === "REQUEST_TO_JOIN" ? "#FFFFFF" : colors.accent}
                  />
                  <Text
                    style={[
                      styles.grpToggleBtnText,
                      newGroupVisibility === "REQUEST_TO_JOIN" && styles.grpToggleBtnTextActive
                    ]}
                  >
                    Request
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.grpToggleBtn,
                    newGroupVisibility === "INVITE_ONLY" && styles.grpToggleBtnActive
                  ]}
                  onPress={() => setNewGroupVisibility("INVITE_ONLY")}
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={14}
                    color={newGroupVisibility === "INVITE_ONLY" ? "#FFFFFF" : colors.accent}
                  />
                  <Text
                    style={[
                      styles.grpToggleBtnText,
                      newGroupVisibility === "INVITE_ONLY" && styles.grpToggleBtnTextActive
                    ]}
                  >
                    Invite only
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.grpFieldHint}>
                {newGroupVisibility === "OPEN"
                  ? "Open groups appear in discovery and anyone can join instantly."
                  : newGroupVisibility === "REQUEST_TO_JOIN"
                  ? "You approve every member before they join."
                  : "Invite-only groups are hidden — share the code with people you want in."}
              </Text>

              {/* S54: Category picker */}
              <Text style={styles.grpFieldLabel}>Category (optional)</Text>
              <View style={styles.grpCategoryRow}>
                {(
                  [
                    null,
                    "FINANCE",
                    "SPORTS",
                    "BUSINESS",
                    "TECH",
                    "ENTERTAINMENT",
                    "GENERAL"
                  ] as (AppMarketCategory | null)[]
                ).map((cat) => (
                  <Pressable
                    key={cat ?? "NONE"}
                    style={[
                      styles.grpCategoryChip,
                      newGroupCategory === cat && styles.grpCategoryChipActive
                    ]}
                    onPress={() => setNewGroupCategory(cat)}
                  >
                    <Text
                      style={[
                        styles.grpCategoryChipText,
                        newGroupCategory === cat && styles.grpCategoryChipTextActive
                      ]}
                    >
                      {cat === null
                        ? "None"
                        : cat.charAt(0) + cat.slice(1).toLowerCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                style={[styles.grpSheetBtn, loading && styles.btnDisabled]}
                onPress={handleCreateGroup}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.grpSheetBtnText}>Create Group</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* Join sheet */}
          {actionSheet === "join" && (
            <View style={styles.grpSheet}>
              <Text style={styles.grpSheetTitle}>Join with invite code</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter invite code"
                placeholderTextColor={colors.textMuted}
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="characters"
                maxLength={32}
              />
              <Pressable
                style={[styles.grpSheetBtn, loading && styles.btnDisabled]}
                onPress={handleJoinGroup}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.grpSheetBtnText}>Join Group</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step — Type + Category
// ---------------------------------------------------------------------------

function StepType({
  marketType,
  setMarketType,
  category,
  setCategory,
}: {
  marketType: MarketType;
  setMarketType: (t: MarketType) => void;
  category: AppMarketCategory;
  setCategory: (c: AppMarketCategory) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      <Text style={styles.stepTitle}>What kind of question?</Text>

      <Pressable
        style={[styles.optionCard, marketType === "BINARY" && styles.optionCardActive]}
        onPress={() => setMarketType("BINARY")}
      >
        <Text style={[styles.optionTitle, marketType === "BINARY" && styles.optionTitleActive]}>
          Yes or No
        </Text>
        <Text style={[styles.optionDesc, marketType === "BINARY" && styles.optionDescActive]}>
          "Will India win?" — people pick Yes or No.
        </Text>
      </Pressable>

      <Pressable
        style={[styles.optionCard, marketType === "NUMERIC" && styles.optionCardActive]}
        onPress={() => setMarketType("NUMERIC")}
      >
        <Text style={[styles.optionTitle, marketType === "NUMERIC" && styles.optionTitleActive]}>
          Guess the Number
        </Text>
        <Text style={[styles.optionDesc, marketType === "NUMERIC" && styles.optionDescActive]}>
          "How many runs will India score?" — closest guess wins.
        </Text>
      </Pressable>

      <Pressable
        style={[styles.optionCard, marketType === "MULTIPLE_CHOICE" && styles.optionCardActive]}
        onPress={() => setMarketType("MULTIPLE_CHOICE")}
      >
        <Text style={[styles.optionTitle, marketType === "MULTIPLE_CHOICE" && styles.optionTitleActive]}>
          Multiple Choice
        </Text>
        <Text style={[styles.optionDesc, marketType === "MULTIPLE_CHOICE" && styles.optionDescActive]}>
          "Which team will win?" — users pick from your defined options.
        </Text>
      </Pressable>

      <Text style={[styles.label, { marginTop: spacing.xl }]}>Category</Text>
      <View style={styles.pillRow}>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c.value}
            style={[styles.pill, category === c.value && styles.pillActive]}
            onPress={() => setCategory(c.value)}
          >
            <Text style={[styles.pillText, category === c.value && styles.pillTextActive]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step — Question
// ---------------------------------------------------------------------------

function StepQuestion({
  marketType,
  title,
  setTitle,
  description,
  setDescription,
  unit,
  setUnit,
  minValue,
  setMinValue,
  maxValue,
  setMaxValue,
  mcOptions,
  setMcOptions,
}: {
  marketType: MarketType;
  title: string;
  setTitle: (t: string) => void;
  description: string;
  setDescription: (d: string) => void;
  unit: string;
  setUnit: (u: string) => void;
  minValue: string;
  setMinValue: (v: string) => void;
  maxValue: string;
  setMaxValue: (v: string) => void;
  mcOptions: string[];
  setMcOptions: (opts: string[]) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      <Text style={styles.stepTitle}>Write your question</Text>

      <Text style={styles.label}>Question</Text>
      <TextInput
        style={styles.input}
        placeholder={
          marketType === "BINARY"
            ? "Will India win the World Cup 2026?"
            : marketType === "MULTIPLE_CHOICE"
            ? "Which team will win the tournament?"
            : "How many runs will India score in the 1st innings?"
        }
        placeholderTextColor={colors.textMuted}
        value={title}
        onChangeText={setTitle}
        maxLength={160}
        multiline
      />
      <View style={styles.charCountRow}>
        <Text style={styles.charCount}>{title.length}/160</Text>
        {title.length < 12 ? (
          <Text style={styles.charHintNeeded}>Need {12 - title.length} more characters.</Text>
        ) : (
          <Text style={styles.charHintDone}>✓</Text>
        )}
      </View>

      <Text style={styles.label}>Add some context</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder={
          marketType === "BINARY"
            ? "Explain what YES and NO mean, and how the outcome will be determined. E.g. Resolves YES if the team wins by May 31, NO otherwise."
            : marketType === "MULTIPLE_CHOICE"
            ? "Describe how you will determine the winning option and when."
            : "Describe what number people are guessing and how you'll determine the final value. E.g. The official scorecard from ESPN will be used."
        }
        placeholderTextColor={colors.textMuted}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
      />
      <View style={styles.charCountRow}>
        <Text style={styles.charCount}>{description.length}/2000</Text>
        {description.length < 24 ? (
          <Text style={styles.charHintNeeded}>Need {24 - description.length} more characters.</Text>
        ) : (
          <Text style={styles.charHintDone}>✓</Text>
        )}
      </View>

      {marketType === "NUMERIC" && (
        <>
          <Text style={[styles.label, { marginTop: spacing.lg }]}>Number settings</Text>
          <TextInput
            style={styles.input}
            placeholder="Unit (e.g. runs, goals, mm)"
            placeholderTextColor={colors.textMuted}
            value={unit}
            onChangeText={setUnit}
            maxLength={24}
          />
          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.smallLabel}>Min</Text>
              <TextInput
                style={styles.input}
                value={minValue}
                onChangeText={setMinValue}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.smallLabel}>Max</Text>
              <TextInput
                style={styles.input}
                value={maxValue}
                onChangeText={setMaxValue}
                keyboardType="numeric"
                placeholder="100"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>
        </>
      )}

      {marketType === "MULTIPLE_CHOICE" && (
        <>
          <Text style={[styles.label, { marginTop: spacing.lg }]}>
            Options (2–10)
          </Text>
          {mcOptions.map((opt, idx) => (
            <View key={idx} style={styles.mcOptionRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder={`Option ${idx + 1}`}
                placeholderTextColor={colors.textMuted}
                value={opt}
                onChangeText={(text) => {
                  const next = [...mcOptions];
                  next[idx] = text;
                  setMcOptions(next);
                }}
                maxLength={100}
              />
              {mcOptions.length > 2 ? (
                <Pressable
                  style={styles.mcRemoveBtn}
                  onPress={() => {
                    const next = mcOptions.filter((_, i) => i !== idx);
                    setMcOptions(next);
                  }}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {mcOptions.length < 10 ? (
            <Pressable
              style={styles.mcAddBtn}
              onPress={() => setMcOptions([...mcOptions, ""])}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              <Text style={styles.mcAddBtnText}>Add option</Text>
            </Pressable>
          ) : null}
          {(() => {
            const trimmed = mcOptions.map((o) => o.trim()).filter((o) => o.length > 0);
            const hasDuplicates = new Set(trimmed).size !== trimmed.length;
            return hasDuplicates ? (
              <Text style={styles.errorHint}>Options must be unique.</Text>
            ) : null;
          })()}
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step — Host Settings (only for HOST-resolved markets)
// ---------------------------------------------------------------------------

function StepHostSettings({
  poolRewardMode,
  setPoolRewardMode,
  bondCap,
  setBondCap,
  commissionBps,
  setCommissionBps,
  challengeWindowHours,
  setChallengeWindowHours,
  gracePeriodHours,
  setGracePeriodHours,
}: {
  poolRewardMode: PoolRewardMode;
  setPoolRewardMode: (m: PoolRewardMode) => void;
  bondCap: string;
  setBondCap: (v: string) => void;
  commissionBps: number;
  setCommissionBps: (v: number) => void;
  challengeWindowHours: number;
  setChallengeWindowHours: (v: number) => void;
  gracePeriodHours: number;
  setGracePeriodHours: (v: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const bondAmount = Number(bondCap) || 0;
  const maxPool =
    poolRewardMode === "COMMISSION_BASED" && commissionBps > 0
      ? Math.floor((bondAmount * 10000) / commissionBps)
      : null;

  return (
    <View>
      <Text style={styles.stepTitle}>Host settings</Text>
      <Text style={styles.stepDesc}>
        As the host, you stake a bond to guarantee fair resolution. Configure how you earn and how participants can challenge.
      </Text>

      {/* Hosting Model */}
      <Text style={styles.label}>Hosting model</Text>
      <Pressable
        style={[styles.optionCard, poolRewardMode === "COMMISSION_BASED" && styles.optionCardActive]}
        onPress={() => setPoolRewardMode("COMMISSION_BASED")}
      >
        <Text style={[styles.optionTitle, poolRewardMode === "COMMISSION_BASED" && styles.optionTitleActive]}>
          Commission
        </Text>
        <Text style={[styles.optionDesc, poolRewardMode === "COMMISSION_BASED" && styles.optionDescActive]}>
          You earn a % of the pool. Your bond guarantees fair play.
        </Text>
      </Pressable>
      <Pressable
        style={[styles.optionCard, poolRewardMode === "BOND_BASED" && styles.optionCardActive]}
        onPress={() => setPoolRewardMode("BOND_BASED")}
      >
        <Text style={[styles.optionTitle, poolRewardMode === "BOND_BASED" && styles.optionTitleActive]}>
          Bond-based
        </Text>
        <Text style={[styles.optionDesc, poolRewardMode === "BOND_BASED" && styles.optionDescActive]}>
          You earn up to 10% of the pool (capped at your bond). No pool size limit.
        </Text>
      </Pressable>

      {/* Bond / Stake */}
      <Text style={styles.label}>
        {poolRewardMode === "BOND_BASED" ? "Your stake (bond)" : "Bond amount"}
      </Text>
      <Text style={styles.hint}>
        {poolRewardMode === "BOND_BASED"
          ? "Locked upfront. Sets your max earnings (up to 10% of the pool). Returned after clean resolution. Forfeited on timeout or misconduct. Minimum 100 pts."
          : "Locked from your wallet upfront. Returned after clean resolution. Forfeited on timeout or misconduct. Minimum 100 pts."}
      </Text>
      <TextInput
        style={styles.input}
        value={bondCap}
        onChangeText={setBondCap}
        keyboardType="numeric"
        placeholder="500"
        placeholderTextColor={colors.textMuted}
      />
      {bondAmount > 0 && bondAmount < 100 && (
        <Text style={styles.errorHint}>Minimum bond is 100 points.</Text>
      )}

      {/* Commission (only for commission-based) */}
      {poolRewardMode === "COMMISSION_BASED" && (
        <>
          <Text style={styles.label}>Your commission</Text>
          <Text style={styles.hint}>
            The percentage you earn from the final pool.
          </Text>
          <View style={styles.pillRow}>
            {COMMISSION_PRESETS.map((p) => (
              <Pressable
                key={p.bps}
                style={[styles.pill, commissionBps === p.bps && styles.pillActive]}
                onPress={() => setCommissionBps(p.bps)}
              >
                <Text style={[styles.pillText, commissionBps === p.bps && styles.pillTextActive]}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {maxPool != null && (
            <Text style={styles.computedText}>
              Max pool allowed: {maxPool.toLocaleString()} pts
            </Text>
          )}
        </>
      )}

      {/* Challenge Window */}
      <Text style={styles.label}>Challenge window</Text>
      <Text style={styles.hint}>
        After you submit the result, participants have this long to challenge if they disagree.
      </Text>
      <View style={styles.pillRow}>
        {CHALLENGE_WINDOW_OPTIONS.map((opt) => (
          <Pressable
            key={opt.hours}
            style={[styles.pill, challengeWindowHours === opt.hours && styles.pillActive]}
            onPress={() => setChallengeWindowHours(opt.hours)}
          >
            <Text style={[styles.pillText, challengeWindowHours === opt.hours && styles.pillTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Grace Period */}
      <Text style={styles.label}>Grace period</Text>
      <Text style={styles.hint}>
        How long after the resolve time you have to submit the result. If you miss this deadline, the market times out and your bond is forfeited.
      </Text>
      <View style={styles.pillRow}>
        {GRACE_PERIOD_OPTIONS.map((opt) => (
          <Pressable
            key={opt.hours}
            style={[styles.pill, gracePeriodHours === opt.hours && styles.pillActive]}
            onPress={() => setGracePeriodHours(opt.hours)}
          >
            <Text style={[styles.pillText, gracePeriodHours === opt.hours && styles.pillTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step — Timing
// ---------------------------------------------------------------------------

function StepTiming({
  closeAt,
  setCloseAt,
  resolveAt,
  setResolveAt,
  gracePeriodHours,
}: {
  closeAt: Date;
  setCloseAt: (d: Date) => void;
  resolveAt: Date;
  setResolveAt: (d: Date) => void;
  gracePeriodHours: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const [closeMode, setCloseMode] = useState<"quick" | "exact">("quick");
  const [resolveMode, setResolveMode] = useState<"quick" | "exact">("quick");

  const deadlineAt = new Date(resolveAt.getTime() + gracePeriodHours * 3600000);

  function fmtDate(d: Date) {
    return (
      d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }) +
      " at " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }

  // Check which quick preset is closest to the current closeAt
  const closeHoursFromNow = Math.round((closeAt.getTime() - Date.now()) / 3600000);
  const activeClosePreset = CLOSE_PRESETS.find((p) => p.hours === closeHoursFromNow);

  const resolveHoursAfterClose = Math.round((resolveAt.getTime() - closeAt.getTime()) / 3600000);
  const activeResolvePreset = RESOLVE_PRESETS.find((p) => p.hours === resolveHoursAfterClose);

  return (
    <View>
      <Text style={styles.stepTitle}>Timing</Text>

      {/* ---- Close time ---- */}
      <Text style={styles.label}>When does voting close?</Text>
      <Text style={styles.hint}>No new predictions can be made after this.</Text>

      <View style={styles.modeToggleRow}>
        <Pressable
          style={[styles.modeToggle, closeMode === "quick" && styles.modeToggleActive]}
          onPress={() => setCloseMode("quick")}
        >
          <Text style={[styles.modeToggleText, closeMode === "quick" && styles.modeToggleTextActive]}>
            Quick pick
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeToggle, closeMode === "exact" && styles.modeToggleActive]}
          onPress={() => setCloseMode("exact")}
        >
          <Text style={[styles.modeToggleText, closeMode === "exact" && styles.modeToggleTextActive]}>
            Exact date & time
          </Text>
        </Pressable>
      </View>

      {closeMode === "quick" ? (
        <View style={styles.pillRow}>
          {CLOSE_PRESETS.map((opt) => (
            <Pressable
              key={opt.hours}
              style={[styles.timingPill, activeClosePreset?.hours === opt.hours && styles.timingPillActive]}
              onPress={() => {
                setCloseAt(new Date(Date.now() + opt.hours * 3600000));
                // Keep resolve at least at close time
                const newClose = Date.now() + opt.hours * 3600000;
                if (resolveAt.getTime() < newClose) {
                  setResolveAt(new Date(newClose));
                }
              }}
            >
              <Text
                style={[styles.timingPillText, activeClosePreset?.hours === opt.hours && styles.timingPillTextActive]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <DateTimeInput
          value={closeAt}
          onChange={(d) => {
            setCloseAt(d);
            if (resolveAt < d) setResolveAt(d);
          }}
          minDate={new Date()}
        />
      )}

      <View style={styles.selectedDateCard}>
        <Text style={styles.selectedDateLabel}>Closes</Text>
        <Text style={styles.selectedDateValue}>{fmtDate(closeAt)}</Text>
      </View>

      {/* ---- Resolve time ---- */}
      <Text style={[styles.label, { marginTop: spacing.xl }]}>
        When should the outcome be known?
      </Text>
      <Text style={styles.hint}>
        The result should be available by this time. Must be at or after the close time.
      </Text>

      <View style={styles.modeToggleRow}>
        <Pressable
          style={[styles.modeToggle, resolveMode === "quick" && styles.modeToggleActive]}
          onPress={() => setResolveMode("quick")}
        >
          <Text style={[styles.modeToggleText, resolveMode === "quick" && styles.modeToggleTextActive]}>
            Quick pick
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeToggle, resolveMode === "exact" && styles.modeToggleActive]}
          onPress={() => setResolveMode("exact")}
        >
          <Text style={[styles.modeToggleText, resolveMode === "exact" && styles.modeToggleTextActive]}>
            Exact date & time
          </Text>
        </Pressable>
      </View>

      {resolveMode === "quick" ? (
        <View style={styles.pillRow}>
          {RESOLVE_PRESETS.map((opt) => (
            <Pressable
              key={opt.hours}
              style={[styles.timingPill, activeResolvePreset?.hours === opt.hours && styles.timingPillActive]}
              onPress={() => setResolveAt(new Date(closeAt.getTime() + opt.hours * 3600000))}
            >
              <Text
                style={[styles.timingPillText, activeResolvePreset?.hours === opt.hours && styles.timingPillTextActive]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <DateTimeInput
          value={resolveAt}
          onChange={setResolveAt}
          minDate={closeAt}
        />
      )}

      <View style={styles.selectedDateCard}>
        <Text style={styles.selectedDateLabel}>Resolves</Text>
        <Text style={styles.selectedDateValue}>{fmtDate(resolveAt)}</Text>
      </View>

      {resolveAt <= closeAt && (
        <Text style={styles.errorHint}>Resolve time must be after close time.</Text>
      )}

      {/* ---- Timeline summary ---- */}
      <View style={styles.timelineSummary}>
        <Text style={styles.timelineTitle}>Timeline</Text>
        <TimelineRow emoji="🔒" label="Voting closes" date={fmtDate(closeAt)} />
        <TimelineRow emoji="📋" label="Outcome expected" date={fmtDate(resolveAt)} />
        <TimelineRow
          emoji="⏳"
          label="Host deadline"
          date={fmtDate(deadlineAt)}
          sub={`${gracePeriodHours}h grace period to submit result`}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// DateTimeInput — inline date & time picker using text fields
// ---------------------------------------------------------------------------

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function DateTimeInput({
  value,
  onChange,
  minDate,
}: {
  value: Date;
  onChange: (d: Date) => void;
  minDate?: Date;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Break the date into editable parts
  const [dateStr, setDateStr] = useState(
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  );
  const [timeStr, setTimeStr] = useState(
    `${pad(value.getHours())}:${pad(value.getMinutes())}`
  );
  const [error, setError] = useState<string | null>(null);

  // Sync display when value changes from outside (preset tap)
  useEffect(() => {
    setDateStr(`${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`);
    setTimeStr(`${pad(value.getHours())}:${pad(value.getMinutes())}`);
    setError(null);
  }, [value]);

  function tryApply(nextDate: string, nextTime: string) {
    const parsed = new Date(`${nextDate}T${nextTime}:00`);
    if (Number.isNaN(parsed.getTime())) {
      setError("Invalid date or time");
      return;
    }
    if (minDate && parsed < minDate) {
      setError("Must be in the future");
      return;
    }
    setError(null);
    onChange(parsed);
  }

  return (
    <View style={styles.dateTimeContainer}>
      <View style={styles.dateTimeRow}>
        <View style={styles.dateTimeField}>
          <Text style={styles.dateTimeFieldLabel}>Date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.dateTimeInput}
            value={dateStr}
            onChangeText={(t) => {
              setDateStr(t);
              if (t.match(/^\d{4}-\d{2}-\d{2}$/)) tryApply(t, timeStr);
            }}
            placeholder="2026-05-01"
            placeholderTextColor={colors.textMuted}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
        </View>
        <View style={styles.dateTimeField}>
          <Text style={styles.dateTimeFieldLabel}>Time (HH:MM)</Text>
          <TextInput
            style={styles.dateTimeInput}
            value={timeStr}
            onChangeText={(t) => {
              setTimeStr(t);
              if (t.match(/^\d{2}:\d{2}$/)) tryApply(dateStr, t);
            }}
            placeholder="14:30"
            placeholderTextColor={colors.textMuted}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>
      </View>
      {/* Quick date shortcuts */}
      <View style={[styles.pillRow, { marginTop: spacing.sm }]}>
        {["Today", "Tomorrow", "+3 days", "+1 week"].map((label) => (
          <Pressable
            key={label}
            style={styles.timingPill}
            onPress={() => {
              const d = new Date();
              if (label === "Tomorrow") d.setDate(d.getDate() + 1);
              else if (label === "+3 days") d.setDate(d.getDate() + 3);
              else if (label === "+1 week") d.setDate(d.getDate() + 7);
              const newDateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
              setDateStr(newDateStr);
              tryApply(newDateStr, timeStr);
            }}
          >
            <Text style={styles.timingPillText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text style={styles.errorHint}>{error}</Text>}
    </View>
  );
}

function TimelineRow({ emoji, label, date, sub }: { emoji?: string; label: string; date: string; sub?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.timelineRow}>
      {emoji ? (
        <Text style={styles.timelineEmoji}>{emoji}</Text>
      ) : (
        <View style={styles.timelineDot} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.timelineLabel}>{label}</Text>
        <Text style={styles.timelineDate}>{date}</Text>
        {sub && <Text style={styles.timelineSub}>{sub}</Text>}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Flagship Event Section — admin-only, FINANCE category
// ---------------------------------------------------------------------------

const FLAGSHIP_EVENT_TYPES = [
  { label: "RBI MPC Decision", value: "RBI" },
  { label: "Union Budget", value: "BUDGET" },
  { label: "GST Council Meeting", value: "GST" },
  { label: "Global Market Event", value: "GLOBAL" },
  { label: "US Federal Reserve", value: "FED" },
  { label: "Other Policy Event", value: "OTHER" },
];

function FlagshipEventSection({
  isFlagshipEvent,
  setIsFlagshipEvent,
  flagshipEventAt,
  setFlagshipEventAt,
  flagshipEventType,
  setFlagshipEventType,
}: {
  isFlagshipEvent: boolean;
  setIsFlagshipEvent: (val: boolean) => void;
  flagshipEventAt: Date | null;
  setFlagshipEventAt: (date: Date | null) => void;
  flagshipEventType: string;
  setFlagshipEventType: (type: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const minDate = new Date(Date.now() + 2 * 24 * 3600000);
  const maxDate = new Date(Date.now() + 90 * 24 * 3600000);

  function handleEventAtChange(dateStr: string) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      const clamped = parsed < minDate ? minDate : parsed > maxDate ? maxDate : parsed;
      setFlagshipEventAt(clamped);
    }
  }

  return (
    <View style={styles.flagshipSection}>
      <View style={styles.flagshipToggleRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.flagshipToggleLabel}>Flagship event poll</Text>
            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "#fef3c7" }}>
              <Text style={{ fontSize: 9, fontWeight: "800", color: "#b45309", letterSpacing: 0.4 }}>ADMIN</Text>
            </View>
          </View>
          <Text style={styles.flagshipToggleSub}>
            Curated high-impact event. Appears in the Policy &amp; Big Events carousel on the Finance tab.
          </Text>
        </View>
        <Pressable
          style={[styles.toggleSwitch, isFlagshipEvent && styles.toggleSwitchOn]}
          onPress={() => setIsFlagshipEvent(!isFlagshipEvent)}
        >
          <View style={[styles.toggleKnob, isFlagshipEvent && styles.toggleKnobOn]} />
        </Pressable>
      </View>

      {isFlagshipEvent && (
        <View style={styles.flagshipFields}>
          <Text style={styles.label}>Event date</Text>
          <Text style={styles.hint}>
            When the event happens (must be 2+ days from now, up to 90 days). Voting closes at this time.
          </Text>
          <TextInput
            style={styles.input}
            value={flagshipEventAt
              ? flagshipEventAt.toISOString().slice(0, 16).replace("T", " ")
              : ""}
            onChangeText={handleEventAtChange}
            placeholder="YYYY-MM-DD HH:MM"
            placeholderTextColor="#9CA3AF"
          />

          <Text style={[styles.label, { marginTop: 12 }]}>Event type</Text>
          <View style={styles.pillRow}>
            {FLAGSHIP_EVENT_TYPES.map((et) => (
              <Pressable
                key={et.value}
                style={[styles.pill, flagshipEventType === et.value && styles.pillActive]}
                onPress={() => setFlagshipEventType(et.value)}
              >
                <Text style={[styles.pillText, flagshipEventType === et.value && styles.pillTextActive]}>
                  {et.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {flagshipEventAt && (
            <View style={styles.selectedDateCard}>
              <Text style={styles.selectedDateLabel}>Event date</Text>
              <Text style={styles.selectedDateValue}>
                {flagshipEventAt.toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step — Review
// ---------------------------------------------------------------------------

function StepReview({
  visibility,
  marketType,
  category,
  title,
  description,
  closeAt,
  resolveAt,
  groupName,
  poolRewardMode,
  bondCap,
  commissionBps,
  challengeWindowHours,
  gracePeriodHours,
}: {
  visibility: Visibility;
  marketType: MarketType;
  category: AppMarketCategory;
  title: string;
  description: string;
  closeAt: Date;
  resolveAt: Date;
  groupName?: string;
  poolRewardMode: PoolRewardMode;
  bondCap: string;
  commissionBps: number;
  challengeWindowHours: number;
  gracePeriodHours: number;
}) {
  const styles = useThemedStyles(makeStyles);
  function fmtDate(d: Date) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " at " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const deadlineAt = new Date(resolveAt.getTime() + gracePeriodHours * 3600000);

  return (
    <View>
      <Text style={styles.stepTitle}>Review your market</Text>
      <Text style={styles.stepDesc}>Make sure everything looks good before publishing.</Text>

      <View style={styles.reviewCard}>
        {/* Tags */}
        <View style={styles.tagRow}>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{visibility === "PUBLIC" ? "Public" : "Private"}</Text>
          </View>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{marketType === "BINARY" ? "Yes / No" : "Numeric"}</Text>
          </View>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{category}</Text>
          </View>
        </View>

        {groupName && <Text style={styles.reviewMeta}>Group: {groupName}</Text>}

        <Text style={styles.reviewTitle}>{title}</Text>
        <LinkifiedText text={description} style={styles.reviewDesc} linkStyle={styles.reviewLink} />

        <View style={styles.reviewDivider} />

        <Text style={styles.reviewMeta}>Resolution: Host Decides</Text>
        <Text style={styles.reviewMeta}>Closes: {fmtDate(closeAt)}</Text>
        <Text style={styles.reviewMeta}>Resolves: {fmtDate(resolveAt)}</Text>

        <View style={styles.reviewDivider} />
        <Text style={styles.reviewSectionTitle}>Host settings</Text>
        <Text style={styles.reviewMeta}>
          Bond: {Number(bondCap).toLocaleString()} pts
        </Text>
        <Text style={styles.reviewMeta}>
          Model: {poolRewardMode === "COMMISSION_BASED" ? `Commission (${(commissionBps / 100).toFixed(1)}%)` : "Bond-based"}
        </Text>
        <Text style={styles.reviewMeta}>
          Challenge window: {challengeWindowHours}h
        </Text>
        <Text style={styles.reviewMeta}>
          Host deadline: {fmtDate(deadlineAt)} ({gracePeriodHours}h grace)
        </Text>
      </View>

      {visibility === "PUBLIC" && (
        <View style={styles.moderationNotice}>
          <Text style={styles.moderationNoticeText}>
            Public markets go through moderation before going live. You'll receive a notification once it's approved.
          </Text>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.colors.background },
  scrollContent: { padding: spacing.xl, paddingBottom: 120 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  heroTitle: { fontSize: 28, fontWeight: "700", color: t.colors.text },
  heroSub: {
    marginTop: spacing.md, fontSize: 15, color: t.colors.textMuted,
    textAlign: "center", lineHeight: 22,
  },
  code: { fontFamily: "Courier" },

  // Progress
  progressRow: { flexDirection: "row", gap: 6, marginBottom: spacing.xs },
  progressDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: t.colors.border },
  progressDotActive: { backgroundColor: t.colors.accent },
  stepLabel: { fontSize: 12, color: t.colors.textMuted, marginBottom: spacing.lg },

  // Step content
  stepTitle: { fontSize: 24, fontWeight: "700", color: t.colors.text, marginBottom: spacing.xs },
  stepDesc: { fontSize: 14, color: t.colors.textMuted, marginBottom: spacing.lg, lineHeight: 20 },

  // Option cards
  optionCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 2,
    borderColor: t.colors.border,
    marginBottom: spacing.md,
  },
  optionCardActive: { borderColor: t.colors.accent, backgroundColor: t.colors.accent + "0D" },
  optionCardLocked: { opacity: 0.5 },
  optionTitle: { fontSize: 17, fontWeight: "700", color: t.colors.text },
  optionTitleActive: { color: t.colors.accent },
  optionTitleMuted: { color: t.colors.textMuted },
  optionDesc: { fontSize: 13, color: t.colors.textMuted, marginTop: 4, lineHeight: 18 },
  optionDescActive: { color: t.colors.text },
  eligibilityReasonItem: { fontSize: 12, color: t.colors.textMuted, marginTop: 3, lineHeight: 17 },

  // Compact option cards (timing)
  optionCardCompact: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 2,
    borderColor: t.colors.border,
    marginBottom: spacing.sm,
  },
  optionCardCompactActive: { borderColor: t.colors.accent, backgroundColor: t.colors.accent + "0D" },
  optionCompactTitle: { fontSize: 15, fontWeight: "600", color: t.colors.text },
  optionCompactSub: { fontSize: 12, color: t.colors.textMuted },

  // Labels & inputs
  label: { fontSize: 14, fontWeight: "600", color: t.colors.text, marginTop: spacing.lg, marginBottom: spacing.xs },
  smallLabel: { fontSize: 12, fontWeight: "600", color: t.colors.textMuted, marginBottom: 4 },
  hint: { fontSize: 13, color: t.colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  charCount: { fontSize: 11, color: t.colors.textMuted, textAlign: "right", marginTop: 2 },
  charCountRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 },
  charHintNeeded: { fontSize: 11, color: t.colors.textMuted },
  charHintDone: { fontSize: 11, color: t.colors.success },
  errorHint: { fontSize: 12, color: t.colors.danger, marginTop: 4 },
  computedText: {
    fontSize: 13, color: t.colors.accent, fontWeight: "600",
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: t.colors.text,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  halfField: { flex: 1 },

  // Pills
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  pillActive: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
  pillText: { fontSize: 13, fontWeight: "600", color: t.colors.textMuted },
  pillTextActive: { color: "#FFFFFF" },

  // Info box
  infoBox: {
    padding: spacing.md,
    backgroundColor: t.colors.accent + "0D",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.accent + "33",
    marginTop: spacing.sm,
  },
  infoText: { fontSize: 13, color: t.colors.text, lineHeight: 18 },

  // Groups
  groupSection: { marginTop: spacing.lg },
  optionRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  optionContent: { flex: 1 },

  // Dropdown
  grpDropdownWrapper: { zIndex: 10 },
  grpDropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
  grpDropdownText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: t.colors.text,
  },
  grpDropdownMenu: {
    marginTop: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
    ...t.shadows.card,
    overflow: "hidden",
  },
  grpDropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
  },
  grpDropdownItemActive: { backgroundColor: t.colors.accent + "0D" },
  grpDropdownItemLeft: { flex: 1 },
  grpDropdownItemName: { fontSize: 15, fontWeight: "600", color: t.colors.text },
  grpDropdownItemNameActive: { color: t.colors.accent },
  grpDropdownItemMeta: { fontSize: 12, color: t.colors.textMuted, marginTop: 2 },

  // Empty state
  grpEmptyCard: {
    alignItems: "center",
    padding: spacing.xl,
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderStyle: "dashed",
  },
  grpEmptyTitle: { fontSize: 16, fontWeight: "700", color: t.colors.text, marginTop: spacing.md },
  grpEmptyDesc: {
    fontSize: 13,
    color: t.colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xs,
    lineHeight: 18,
  },

  // Action buttons
  grpActionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  grpActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1.5,
    borderColor: t.colors.accent,
  },
  grpActionBtnActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  grpActionBtnText: { fontSize: 14, fontWeight: "700", color: t.colors.accent },
  grpActionBtnTextActive: { color: "#FFFFFF" },

  // Inline sheet
  grpSheet: {
    marginTop: spacing.md,
    padding: spacing.lg,
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  grpSheetTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: t.colors.text,
    marginBottom: spacing.md,
  },
  grpSheetBtn: {
    marginTop: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: t.colors.accent,
    alignItems: "center",
  },
  grpSheetBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },

  // S54 group create — visibility + category pickers
  grpFieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.xs
  },
  grpFieldHint: {
    fontSize: 12,
    color: t.colors.textMuted,
    lineHeight: 17,
    marginTop: spacing.xs,
    marginBottom: spacing.sm
  },
  grpToggleRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  grpToggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: t.colors.accent,
    backgroundColor: t.colors.surface
  },
  grpToggleBtnActive: {
    backgroundColor: t.colors.accent
  },
  grpToggleBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: t.colors.accent
  },
  grpToggleBtnTextActive: {
    color: "#FFFFFF"
  },
  grpCategoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs
  },
  grpCategoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface
  },
  grpCategoryChipActive: {
    borderColor: t.colors.accent,
    backgroundColor: t.colors.accent + "15"
  },
  grpCategoryChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: t.colors.textMuted
  },
  grpCategoryChipTextActive: {
    color: t.colors.accent
  },

  // Timeline summary
  timelineSummary: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
  },
  timelineTitle: { fontSize: 16, fontWeight: "700", color: t.colors.text, marginBottom: spacing.md },
  timelineRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.md },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.colors.accent,
    marginTop: 4,
    marginRight: spacing.md,
  },
  timelineEmoji: { fontSize: 16, marginTop: 1, marginRight: spacing.md },
  timelineLabel: { fontSize: 13, fontWeight: "600", color: t.colors.text },
  timelineDate: { fontSize: 12, color: t.colors.textMuted },
  timelineSub: { fontSize: 11, color: t.colors.accent, marginTop: 1 },

  // Mode toggle (quick pick vs exact)
  modeToggleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modeToggle: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: "center",
  },
  modeToggleActive: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
  modeToggleText: { fontSize: 13, fontWeight: "600", color: t.colors.textMuted },
  modeToggleTextActive: { color: "#FFFFFF" },

  // Selected date display
  selectedDateCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: t.colors.accent + "0D",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.accent + "33",
  },
  selectedDateLabel: { fontSize: 13, fontWeight: "600", color: t.colors.accent },
  selectedDateValue: { fontSize: 13, fontWeight: "700", color: t.colors.text },

  // Date time input
  dateTimeContainer: { marginTop: spacing.sm },
  dateTimeRow: { flexDirection: "row", gap: spacing.md },
  dateTimeField: { flex: 1 },
  dateTimeFieldLabel: { fontSize: 11, fontWeight: "600", color: t.colors.textMuted, marginBottom: 4 },
  dateTimeInput: {
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: t.colors.text,
    fontVariant: ["tabular-nums"],
  },

  // Timing pills (wrap-style preset chips)
  timingPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  timingPillActive: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
  timingPillText: { fontSize: 13, fontWeight: "600", color: t.colors.textMuted },
  timingPillTextActive: { color: "#FFFFFF" },

  // Review card
  reviewCard: {
    padding: spacing.xl,
    backgroundColor: t.colors.surface,
    borderRadius: radius.lg,
  },
  tagRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md, flexWrap: "wrap" },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: t.colors.text,
  },
  tagText: { color: t.colors.background, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  reviewTitle: { fontSize: 20, fontWeight: "700", color: t.colors.text, marginTop: spacing.sm },
  reviewDesc: { fontSize: 14, color: t.colors.textMuted, marginTop: spacing.sm, lineHeight: 20 },
  reviewLink: { color: t.colors.accent, textDecorationLine: "underline" },
  reviewDivider: { height: 1, backgroundColor: t.colors.border, marginVertical: spacing.lg },
  reviewSectionTitle: { fontSize: 15, fontWeight: "700", color: t.colors.text, marginBottom: spacing.sm },
  reviewMeta: { fontSize: 13, color: t.colors.textMuted, marginTop: spacing.xs },

  // Advanced settings disclosure toggle
  advancedToggleRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: t.colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  advancedToggleLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: t.colors.textMuted,
  },
  advancedToggleLabelActive: {
    color: t.colors.accent,
  },
  advancedToggleSub: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginTop: 2,
  },

  // Navigation
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  backBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  backLabel: { fontSize: 15, fontWeight: "600", color: t.colors.text },
  nextBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
  },
  submitBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: t.colors.success,
  },
  nextLabel: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  btnDisabled: { opacity: 0.4 },

  // Draft banner — amber warning, intentional semantic color, kept as-is
  draftBanner: {
    backgroundColor: "#FFFBEB",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#FDE68A",
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  draftBannerText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#92400E",
    marginBottom: spacing.sm,
  },
  draftBannerButtons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  draftBannerBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#D97706",
    alignItems: "center",
  },
  draftBannerBtnOutline: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#D97706",
  },
  draftBannerBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  draftBannerBtnOutlineText: {
    color: "#D97706",
  },

  // Moderation notice (review step) — amber warning, intentional semantic color, kept as-is
  moderationNotice: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: "#FFFBEB",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  moderationNoticeText: {
    fontSize: 12,
    color: "#92400E",
    lineHeight: 18,
  },

  // Draft saved indicator
  draftSavedLabel: {
    fontSize: 12,
    color: t.colors.textMuted,
    textAlign: "right",
    marginTop: spacing.md,
    marginBottom: -spacing.sm,
  },

  // Success screen
  successContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl * 2,
  },
  successIconWrap: {
    marginBottom: spacing.lg,
  },
  successHeadline: {
    fontSize: 28,
    fontWeight: "700",
    color: t.colors.text,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  successTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: t.colors.textMuted,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  // Success status badges — semantic green/amber, intentional, kept as-is
  successStatusBadge: {
    backgroundColor: "#DCFCE7",
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xl,
  },
  successStatusPendingBadge: {
    backgroundColor: "#FFFBEB",
  },
  successStatusLive: {
    fontSize: 14,
    fontWeight: "700",
    color: "#16A34A",
    textAlign: "center",
  },
  successStatusPending: {
    fontSize: 13,
    fontWeight: "600",
    color: "#92400E",
    textAlign: "center",
    lineHeight: 18,
  },
  successShareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: t.colors.accent,
    marginBottom: spacing.md,
    minWidth: 200,
    justifyContent: "center",
  },
  successShareBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  successViewBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: t.colors.success,
    marginBottom: spacing.md,
    minWidth: 200,
    alignItems: "center",
  },
  successViewBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  successAnotherBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: t.colors.border,
    minWidth: 200,
    alignItems: "center",
  },
  successAnotherBtnText: {
    color: t.colors.text,
    fontWeight: "600",
    fontSize: 15,
  },

  // ── Multiple choice option builder ──
  mcOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  mcRemoveBtn: {
    padding: 4,
  },
  mcAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  mcAddBtnText: {
    color: t.colors.accent,
    fontWeight: "600",
    fontSize: 14,
  },
  // Flagship event section — amber admin UI, intentional semantic color, kept as-is
  flagshipSection: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#FDE68A",
    backgroundColor: "#FFFBEB",
    overflow: "hidden",
  },
  flagshipToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  flagshipToggleLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#92400E",
    marginBottom: 3,
  },
  flagshipToggleSub: {
    fontSize: 11,
    color: "#78350F",
    lineHeight: 15,
  },
  flagshipFields: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "#FDE68A",
  },
  toggleSwitch: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: t.colors.border,
    padding: 2,
    justifyContent: "center",
  },
  toggleSwitchOn: {
    backgroundColor: "#D97706",
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: t.colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleKnobOn: {
    alignSelf: "flex-end",
  },
});
