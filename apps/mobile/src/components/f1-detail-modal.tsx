/**
 * F1DetailModal — full leaderboard for an F1 session.
 *
 * Replaces the generic two-team MatchDetailModal for all F1 cards.
 * Data is fetched from GET /api/sports/f1/session/{sessionKey} on mount.
 *
 * Session-type gating:
 *   Race / Sprint : gap to leader, last lap, best lap, tire chip, FL badge
 *   Qualifying    : best lap as "Q Time" only (no gap, no tire, no last lap)
 *   Practice      : last lap, best lap, tire chip, FL badge (no gap)
 */

import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ApiF1Driver, ApiF1SessionDetail, ApiLiveScore } from "@predict-future/types";
import { radius, spacing } from "@predict-future/ui-tokens";

import { mobileApi } from "@/lib/api";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

// ─── Tire compound colour palette (official F1 colours) ───────────────────────

const TIRE_COLOURS: Record<string, { bg: string; fg: string; label: string }> = {
  SOFT:         { bg: "#E8002D", fg: "#FFFFFF", label: "S" },
  MEDIUM:       { bg: "#FFF200", fg: "#1A1A1A", label: "M" },
  HARD:         { bg: "#FFFFFF", fg: "#1A1A1A", label: "H" },
  INTERMEDIATE: { bg: "#43B02A", fg: "#FFFFFF", label: "I" },
  WET:          { bg: "#0067FF", fg: "#FFFFFF", label: "W" },
};

const FL_COLOUR = "#9B59B6";

// ─── Position badge colours ────────────────────────────────────────────────────

const POS_BADGE_COLOURS: Record<number, string> = {
  1: "#FFD700", // gold
  2: "#C0C0C0", // silver
  3: "#CD7F32", // bronze
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a lap duration in seconds as M:SS.mmm (or SS.mmm if < 60s).
 * e.g. 83.456 → "1:23.456", 59.123 → "59.123"
 */
function formatLapTime(seconds: number): string {
  // Defensive: duration may arrive undefined/null or as a numeric string from the
  // feed. Coerce and bail to a placeholder rather than crashing on .toFixed.
  const s = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(s)) return "—";
  if (s < 60) {
    return s.toFixed(3);
  }
  const minutes = Math.floor(s / 60);
  const remainder = s - minutes * 60;
  const secs = Math.floor(remainder);
  const ms = Math.round((remainder - secs) * 1000);
  return `${minutes}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function formatGap(seconds: number, position: number): string {
  if (position === 1) return "LEADER";
  const s = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(s)) return "—";
  return `+${s.toFixed(3)}s`;
}

// ─── Session type helpers ─────────────────────────────────────────────────────

function isRaceType(type: string): boolean {
  return type === "Race" || type === "Sprint";
}

function isQualifyingType(type: string): boolean {
  return type === "Qualifying";
}

// ─── Style factories ──────────────────────────────────────────────────────────

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  dismiss: {
    flex: 1,
  },
  content: {
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "90%",
    minHeight: 300,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.colors.border,
    alignSelf: "center",
    marginBottom: spacing.sm,
  },
  closeBtn: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    zIndex: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  sessionName: {
    color: t.colors.text,
    fontWeight: "700",
    fontSize: 15,
  },
  sessionType: {
    color: t.colors.textMuted,
    fontSize: 12,
    marginLeft: 2,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  circuit: {
    color: t.colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  colLabels: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
    marginBottom: 4,
  },
  colLabel: {
    color: t.colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textAlign: "right",
    minWidth: 60,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.colors.border,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  loadingText: {
    color: t.colors.textMuted,
    fontSize: 13,
    marginTop: spacing.md,
  },
  errorText: {
    color: t.colors.textMuted,
    fontSize: 14,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: t.colors.accent,
    borderRadius: radius.md,
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  emptyText: {
    color: t.colors.textMuted,
    fontSize: 13,
    textAlign: "center",
  },
  timingMissingBanner: {
    textAlign: "center",
    color: t.colors.textMuted,
    fontSize: 13,
    marginVertical: 12,
    paddingHorizontal: 16,
  },
});

const makeDriverStyles = (t: ThemeContextValue) => StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingRight: 4,
    gap: 8,
  },
  stripe: {
    width: 3,
    height: 44,
    borderRadius: 2,
  },
  posBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  posText: {
    color: t.colors.text,
    fontWeight: "700",
    fontSize: 12,
  },
  headshotContainer: {
    width: 36,
    height: 36,
  },
  headshot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.colors.surface,
  },
  headshotFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headshotFallbackText: {
    color: t.colors.textMuted,
    fontWeight: "700",
    fontSize: 15,
  },
  driverInfo: {
    flex: 1,
    minWidth: 0,
  },
  abbreviation: {
    color: t.colors.text,
    fontWeight: "700",
    fontSize: 13,
  },
  fullName: {
    color: t.colors.textMuted,
    fontSize: 11,
  },
  teamName: {
    color: t.colors.textMuted,
    fontSize: 10,
  },
  stats: {
    alignItems: "flex-end",
    gap: 2,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statLabel: {
    color: t.colors.textMuted,
    fontSize: 10,
    minWidth: 26,
    textAlign: "right",
  },
  stat: {
    color: t.colors.text,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 68,
    textAlign: "right",
  },
  statGap: {
    color: t.colors.textMuted,
    fontSize: 11,
    marginBottom: 2,
  },
  statFastest: {
    color: FL_COLOUR,
  },
  badges: {
    alignItems: "flex-end",
    gap: 4,
    minWidth: 32,
  },
  flBadge: {
    backgroundColor: FL_COLOUR,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  flText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  tireBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  tireBadgeHardBorder: {
    borderWidth: 1,
    borderColor: "#cccccc",
  },
  tireText: {
    fontSize: 11,
    fontWeight: "700",
  },
});

// ─── Sub-components ───────────────────────────────────────────────────────────

function DriverRow({
  driver,
  sessionType,
}: {
  driver: ApiF1Driver;
  sessionType: string;
}) {
  const dr = useThemedStyles(makeDriverStyles);
  const isRace = isRaceType(sessionType);
  const isQualifying = isQualifyingType(sessionType);
  const badgeColour = POS_BADGE_COLOURS[driver.position] ?? "#e2e8f0";
  const tire = driver.tireCompound ? TIRE_COLOURS[driver.tireCompound] : null;

  const showGap = isRace;
  const showLastLap = !isQualifying;
  const showBestLap = true; // always shown (label differs for qualifying)
  const showTire = !isQualifying;
  const bestLapLabel = isQualifying ? "Q Time" : "Best";

  // Avoid showing best lap redundantly when it's the same lap as lastLap.
  const bestSameAsLast =
    !isQualifying &&
    driver.fastestLap &&
    driver.lastLap &&
    driver.fastestLap.lapNumber === driver.lastLap.lapNumber;

  return (
    <View style={dr.row}>
      {/* Team colour stripe */}
      <View style={[dr.stripe, { backgroundColor: driver.teamColour }]} />

      {/* Position badge */}
      <View style={[dr.posBadge, { backgroundColor: badgeColour }]}>
        <Text style={dr.posText}>{driver.position}</Text>
      </View>

      {/* Headshot or initial fallback */}
      <View style={dr.headshotContainer}>
        {driver.headshot ? (
          <Image
            source={{ uri: driver.headshot }}
            style={dr.headshot}
            resizeMode="cover"
          />
        ) : (
          <View style={dr.headshotFallback}>
            <Text style={dr.headshotFallbackText}>
              {driver.abbreviation.charAt(0)}
            </Text>
          </View>
        )}
      </View>

      {/* Driver info */}
      <View style={dr.driverInfo}>
        <Text style={dr.abbreviation} numberOfLines={1}>
          {driver.abbreviation}
        </Text>
        <Text style={dr.fullName} numberOfLines={1}>
          {driver.name}
        </Text>
        <Text style={dr.teamName} numberOfLines={1}>
          {driver.team}
        </Text>
      </View>

      {/* Right-side stats */}
      <View style={dr.stats}>
        {/* Gap to leader — race/sprint only */}
        {showGap && driver.gapToLeader != null && (
          <Text style={[dr.stat, dr.statGap]}>
            {formatGap(driver.gapToLeader, driver.position)}
          </Text>
        )}

        {/* Last lap */}
        {showLastLap && driver.lastLap && (
          <View style={dr.statRow}>
            <Text style={dr.statLabel}>Last</Text>
            <Text style={dr.stat}>
              {formatLapTime(driver.lastLap.duration)}
            </Text>
          </View>
        )}

        {/* Best lap / Q Time */}
        {!isQualifying && showBestLap && driver.fastestLap && !bestSameAsLast && (
          <View style={dr.statRow}>
            <Text style={dr.statLabel}>{bestLapLabel}</Text>
            <Text style={[dr.stat, driver.fastestLapOverall && dr.statFastest]}>
              {formatLapTime(driver.fastestLap.duration)}
            </Text>
          </View>
        )}
        {/* When best == last, still show it for qualifying (no last lap shown) */}
        {isQualifying && driver.fastestLap && (
          <View style={dr.statRow}>
            <Text style={dr.statLabel}>{bestLapLabel}</Text>
            <Text style={[dr.stat, driver.fastestLapOverall && dr.statFastest]}>
              {formatLapTime(driver.fastestLap.duration)}
            </Text>
          </View>
        )}
      </View>

      {/* Badges column: FL + tire chip */}
      <View style={dr.badges}>
        {driver.fastestLapOverall && (
          <View style={dr.flBadge}>
            <Text style={dr.flText}>FL</Text>
          </View>
        )}
        {showTire && tire && (
          <View
            style={[
              dr.tireBadge,
              { backgroundColor: tire.bg },
              tire.label === "H" && dr.tireBadgeHardBorder,
            ]}
          >
            <Text style={[dr.tireText, { color: tire.fg }]}>{tire.label}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  match: ApiLiveScore;
  onClose: () => void;
};

export function F1DetailModal({ match, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // STATUS_CONFIG references theme colours — built inside the component so it
  // always reflects the active palette.
  const STATUS_CONFIG: Record<string, { label: string; colour: string }> = {
    live:     { label: "LIVE",     colour: "#ef4444" },
    finished: { label: "FINISHED", colour: colors.textMuted },
    upcoming: { label: "UPCOMING", colour: colors.accent },
  };

  const [detail, setDetail] = useState<ApiF1SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const cancelledRef = useRef(false);

  const sessionKey = parseInt(match.id.replace("f1-", ""), 10);

  /**
   * loadDetail — fetches session detail with:
   *   - 8-second AbortController timeout per attempt
   *   - one automatic retry on timeout (AbortError); other errors surface immediately
   *   - clearTimeout in all code paths (no memory leak)
   */
  const loadDetail = useCallback(async () => {
    cancelledRef.current = false;
    setLoading(true);
    setError(false);

    let attempt = 0;
    while (attempt < 2) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const data = await mobileApi.getF1SessionDetail(sessionKey, { signal: controller.signal });
        clearTimeout(timer);
        if (!cancelledRef.current) {
          setDetail(data);
          setLoading(false);
        }
        return;
      } catch (err) {
        clearTimeout(timer);
        if (cancelledRef.current) return;
        const isAbort = (err as Error)?.name === "AbortError";
        if (attempt < 2 && isAbort) {
          // Timed out on first attempt — wait 1s then retry once.
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        // Second timeout or non-timeout error — surface to the user.
        setError(true);
        setLoading(false);
        return;
      }
    }
  }, [sessionKey]);

  useEffect(() => {
    loadDetail();
    return () => {
      cancelledRef.current = true;
    };
  }, [loadDetail]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setDetail(null);
    try {
      await loadDetail();
    } finally {
      setIsRefreshing(false);
    }
  };

  const statusConfig = detail
    ? STATUS_CONFIG[detail.session.status] ?? STATUS_CONFIG.finished
    : null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.dismiss} onPress={onClose} />
        <View style={styles.content}>
          <View style={styles.handle} />

          {/* Close button */}
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <Feather name="x" size={20} color={colors.textMuted} />
          </Pressable>

          {/* Loading state */}
          {loading && (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.loadingText}>Loading timing data...</Text>
            </View>
          )}

          {/* Error state */}
          {!loading && error && (
            <View style={styles.centered}>
              <Feather name="alert-circle" size={32} color={colors.textMuted} />
              <Text style={styles.errorText}>Detailed timing unavailable</Text>
              <Pressable style={styles.retryBtn} onPress={loadDetail}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          )}

          {/* Success state */}
          {!loading && !error && detail && (
            <>
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <Feather name="zap" size={14} color={colors.accent} />
                  <Text style={styles.sessionName}>{detail.session.name}</Text>
                  <Text style={styles.sessionType}>{detail.session.type}</Text>
                </View>
                {statusConfig && (
                  <View style={[styles.statusPill, { borderColor: statusConfig.colour }]}>
                    {detail.session.status === "live" && (
                      <View style={[styles.statusDot, { backgroundColor: statusConfig.colour }]} />
                    )}
                    <Text style={[styles.statusText, { color: statusConfig.colour }]}>
                      {statusConfig.label}
                    </Text>
                  </View>
                )}
              </View>

              {/* Circuit */}
              <Text style={styles.circuit} numberOfLines={1}>
                {detail.session.circuit} · {detail.session.country}
              </Text>

              {/* Column labels */}
              <View style={styles.colLabels}>
                <Text style={[styles.colLabel, { flex: 1 }]}>Driver</Text>
                {isRaceType(detail.session.type) && (
                  <Text style={styles.colLabel}>Gap</Text>
                )}
                <Text style={styles.colLabel}>Timing</Text>
              </View>

              {/* Driver list */}
              {detail.drivers.length === 0 ? (
                <View style={styles.centered}>
                  <Text style={styles.emptyText}>
                    No driver data available for this session.
                  </Text>
                </View>
              ) : (() => {
                const allTimingNull =
                  detail.drivers.length > 0 &&
                  detail.drivers.every(
                    (d) => d.fastestLap == null && d.lastLap == null
                  );
                return (
                  <>
                    {allTimingNull && (
                      <Text style={styles.timingMissingBanner}>
                        Timing data is loading from OpenF1 — pull to refresh
                      </Text>
                    )}
                    <FlatList
                      data={detail.drivers}
                      keyExtractor={(d) => String(d.driverNumber)}
                      renderItem={({ item }) => (
                        <DriverRow driver={item} sessionType={detail.session.type} />
                      )}
                      contentContainerStyle={{ paddingBottom: 40 }}
                      showsVerticalScrollIndicator={false}
                      ItemSeparatorComponent={() => <View style={styles.separator} />}
                      refreshControl={
                        <RefreshControl
                          refreshing={isRefreshing}
                          onRefresh={handleRefresh}
                          tintColor={colors.accent}
                        />
                      }
                    />
                  </>
                );
              })()}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
