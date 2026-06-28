import { Feather } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import type { ApiLiveScore, ApiCricketMatchDetail, ApiFootballMatchDetail, ApiMarketSummary, ApiNewsFeedItem } from "@predict-future/types";
import { formatRelativeTime } from "@predict-future/utils";
import { radius, spacing } from "@predict-future/ui-tokens";
import { useTheme, useThemedStyles, type ThemeContextValue } from "@/providers/theme-provider";

import { F1DetailModal } from "@/components/f1-detail-modal";
import { NewsFeedCard } from "@/components/news-feed-card";
import { mobileApi } from "@/lib/api";

const LEAGUE_ICONS: Record<string, React.ComponentProps<typeof Feather>["name"]> = {
  IPL: "target",
  International: "globe",
  EPL: "shield",
  "La Liga": "shield",
  UCL: "star",
  "Serie A": "shield",
  Bundesliga: "shield",
  ISL: "shield",
  ATP: "circle",
  WTA: "circle",
  F1: "zap",
};

// STATUS_COLORS keys mapped in JSX using useTheme() — see SportsScreen and helpers
const STATUS_COLOR_IN = "#ef4444";

function formatMatchTime(startTime: string): string {
  const date = new Date(startTime);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today, ${time}`;
  if (isTomorrow) return `Tomorrow, ${time}`;
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + `, ${time}`;
}

export default function SportsScreen() {
  const { height } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [scores, setScores] = useState<ApiLiveScore[]>([]);
  const [loadingScores, setLoadingScores] = useState(true);
  const [news, setNews] = useState<ApiNewsFeedItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<ApiLiveScore | null>(null);
  const [selectedStory, setSelectedStory] = useState<ApiNewsFeedItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchScores = useCallback(async () => {
    try {
      const res = await mobileApi.getLiveScores();
      if (mountedRef.current) {
        setScores(res.scores);
        setError(null);
      }
    } catch (e) {
      console.warn("[sports] fetchScores error:", e);
      if (mountedRef.current) setError("Couldn't load sports content. Check your connection and tap Retry.");
    }
    if (mountedRef.current) setLoadingScores(false);
  }, []);

  const fetchNews = useCallback(async () => {
    try {
      const res = await mobileApi.getNews({ limit: 20, category: "SPORTS" });
      if (mountedRef.current) {
        setNews(res.items);
        setError(null);
      }
    } catch (e) {
      console.warn("[sports] fetchNews error:", e);
      if (mountedRef.current) setError("Couldn't load sports content. Check your connection and tap Retry.");
    }
    if (mountedRef.current) setLoadingNews(false);
  }, []);

  const retryAll = useCallback(() => {
    setLoadingScores(true);
    setLoadingNews(true);
    setError(null);
    void fetchScores();
    void fetchNews();
  }, [fetchScores, fetchNews]);

  useEffect(() => {
    fetchScores();
    fetchNews();
    const interval = setInterval(fetchScores, 30_000);
    return () => clearInterval(interval);
  }, [fetchScores, fetchNews]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchScores(), fetchNews()]);
    if (mountedRef.current) setRefreshing(false);
  }, [fetchScores, fetchNews]);

  // Build league list from scores
  const leagueSet = new Map<string, { league: string; hasLive: boolean }>();
  for (const s of scores) {
    const existing = leagueSet.get(s.league);
    if (existing) {
      if (s.status === "in") existing.hasLive = true;
    } else {
      leagueSet.set(s.league, { league: s.league, hasLive: s.status === "in" });
    }
  }
  const leagues = Array.from(leagueSet.values()).sort((a, b) =>
    a.hasLive === b.hasLive ? 0 : a.hasLive ? -1 : 1
  );

  const filteredScores = selectedLeague
    ? scores.filter((s) => s.league === selectedLeague)
    : scores;

  const liveCount = scores.filter((s) => s.status === "in").length;

  const renderHeader = () => (
    <>
      {/* League filter chips */}
      {leagues.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.leagueChips}
          contentContainerStyle={styles.leagueChipsContent}
        >
          <Pressable
            style={[styles.leagueChip, !selectedLeague && styles.leagueChipActive]}
            onPress={() => setSelectedLeague(null)}
          >
            <Text style={[styles.leagueChipText, !selectedLeague && styles.leagueChipTextActive]}>
              All
            </Text>
          </Pressable>
          {leagues.map((l) => (
            <Pressable
              key={l.league}
              style={[styles.leagueChip, selectedLeague === l.league && styles.leagueChipActive]}
              onPress={() => setSelectedLeague(selectedLeague === l.league ? null : l.league)}
            >
              <Feather
                name={LEAGUE_ICONS[l.league] ?? "circle"}
                size={12}
                color={selectedLeague === l.league ? colors.surface : colors.text}
              />
              <Text style={[styles.leagueChipText, selectedLeague === l.league && styles.leagueChipTextActive]}>
                {l.league}
              </Text>
              {l.hasLive && <View style={styles.chipLiveDot} />}
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Scores section */}
      {loadingScores ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>Loading scores...</Text>
        </View>
      ) : filteredScores.length === 0 ? (
        <View style={styles.emptyScores}>
          <Feather name="moon" size={24} color={colors.textMuted} />
          <Text style={styles.emptyScoresText}>No games right now</Text>
          <Text style={styles.emptyScoresSub}>Check back when matches are scheduled</Text>
        </View>
      ) : (
        <View style={styles.scoresSection}>
          {filteredScores.map((score) => (
            <ScoreCard
              key={score.id}
              score={score}
              onPress={() => setSelectedMatch(score)}
            />
          ))}
        </View>
      )}

      {/* Sports news header */}
      {news.length > 0 && (
        <View style={styles.newsHeader}>
          <Feather name="rss" size={14} color={colors.text} />
          <Text style={styles.newsHeaderText}>Sports News</Text>
        </View>
      )}
    </>
  );

  // Show full-screen error state when both fetches failed and there's no data yet
  if (error && scores.length === 0 && news.length === 0) {
    return (
      <View style={[styles.screen, styles.errorScreen]}>
        <View style={styles.header}>
          <Feather name="activity" size={22} color={colors.text} />
          <Text style={styles.headerTitle}>Sports</Text>
        </View>
        <View style={styles.errorBox}>
          <Feather name="wifi-off" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
            onPress={retryAll}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Feather name="activity" size={22} color={colors.text} />
        <Text style={styles.headerTitle}>Sports</Text>
        {liveCount > 0 && (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{liveCount} LIVE</Text>
          </View>
        )}
      </View>

      <FlatList
        data={news}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          loadingNews ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.loadingText}>Loading sports news...</Text>
            </View>
          ) : (
            <View style={styles.emptyScores}>
              <Text style={styles.emptyScoresText}>No sports news yet</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <SportsNewsCard item={item} onPress={() => setSelectedStory(item)} />
        )}
        contentContainerStyle={styles.listContent}
      />

      <MatchDetailModal
        match={selectedMatch}
        relatedNews={news}
        onClose={() => setSelectedMatch(null)}
      />

      <StoryModal
        item={selectedStory}
        cardHeight={height * 0.88}
        onClose={() => setSelectedStory(null)}
      />
    </View>
  );
}

// ---- Score Card ----

function ScoreCard({ score, onPress }: { score: ApiLiveScore; onPress: () => void }) {
  if (score.leaderboard && score.leaderboard.length > 0) {
    return <RaceCard score={score} onPress={onPress} />;
  }

  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isLive = score.status === "in";
  const isCricket = score.sport === "Cricket";
  const statusColor = score.status === "in" ? STATUS_COLOR_IN : score.status === "post" ? colors.textMuted : colors.accent;

  return (
    <Pressable style={[styles.scoreCard, isLive && styles.scoreCardLive]} onPress={onPress}>
      <View style={styles.scoreCardHeader}>
        <View style={styles.scoreLeagueRow}>
          <Feather name={LEAGUE_ICONS[score.league] ?? "circle"} size={10} color="rgba(255,255,255,0.4)" />
          <Text style={styles.scoreLeague}>
            {score.sport === score.league ? score.league : `${score.sport} · ${score.league}`}
          </Text>
        </View>
        <View style={styles.scoreStatusBadge}>
          {isLive && <View style={styles.scoreStatusDot} />}
          <Text style={[styles.scoreStatusText, { color: statusColor }]}>
            {isLive ? score.shortDetail || "LIVE" : score.status === "post" ? "FINAL" : formatMatchTime(score.startTime)}
          </Text>
        </View>
      </View>

      <View style={styles.teamsContainer}>
        <TeamRow team={score.homeTeam} isLive={isLive} isCricket={isCricket} />
        <TeamRow team={score.awayTeam} isLive={isLive} isCricket={isCricket} />
      </View>

      {score.venue ? (
        <View style={styles.cardFooter}>
          <Feather name="map-pin" size={9} color="rgba(255,255,255,0.2)" />
          <Text style={styles.venueText} numberOfLines={1}>{score.venue}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ---- Race Card (F1) ----

function normaliseTeamColour(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith("#") ? raw : `#${raw}`;
}

function RaceCard({ score, onPress }: { score: ApiLiveScore; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [expanded, setExpanded] = useState(false);
  const isLive = score.status === "in";
  const lb = score.leaderboard ?? [];
  const podium = lb.slice(0, 3);
  const rest = lb.slice(3);
  const statusColor = score.status === "in" ? STATUS_COLOR_IN : score.status === "post" ? colors.textMuted : colors.accent;

  return (
    <Pressable style={[styles.scoreCard, isLive && styles.scoreCardLive]} onPress={onPress}>
      {/* Header row */}
      <View style={styles.scoreCardHeader}>
        <View style={styles.scoreLeagueRow}>
          <Feather name="zap" size={10} color="rgba(255,255,255,0.4)" />
          <Text style={styles.scoreLeague}>F1</Text>
        </View>
        <View style={styles.scoreStatusBadge}>
          {isLive && <View style={styles.scoreStatusDot} />}
          <Text style={[styles.scoreStatusText, { color: statusColor }]}>
            {isLive ? "LIVE" : score.status === "post" ? "FINAL" : formatMatchTime(score.startTime)}
          </Text>
        </View>
      </View>

      {/* Session name */}
      <Text style={raceStyles.sessionName} numberOfLines={1}>{score.statusDetail}</Text>

      {/* Podium rows P1-P3 */}
      {podium.map((driver, idx) => {
        const colour = normaliseTeamColour(driver.teamColour);
        const isP1 = idx === 0;
        return (
          <View key={driver.position} style={raceStyles.driverRow}>
            <View style={[raceStyles.positionBadge, isP1 && raceStyles.p1Badge]}>
              <Text style={[raceStyles.positionText, isP1 && raceStyles.p1PositionText]}>
                P{driver.position}
              </Text>
            </View>
            {colour ? (
              <View style={[raceStyles.teamColourBar, { backgroundColor: colour }]} />
            ) : (
              <View style={[raceStyles.teamColourBar, raceStyles.teamColourBarFallback]} />
            )}
            {driver.logo ? (
              <Image source={{ uri: driver.logo }} style={raceStyles.driverAvatar} />
            ) : (
              <View style={raceStyles.driverAvatarPlaceholder}>
                <Text style={raceStyles.driverAvatarInitial}>{driver.abbreviation.charAt(0)}</Text>
              </View>
            )}
            <View style={raceStyles.driverInfo}>
              <Text style={[raceStyles.driverName, isP1 && raceStyles.p1Name]} numberOfLines={1}>
                {driver.name}
              </Text>
              <Text style={raceStyles.teamName} numberOfLines={1}>{driver.team}</Text>
            </View>
          </View>
        );
      })}

      {/* Expanded rows P4-P10 */}
      {expanded && rest.map((driver) => (
        <View key={driver.position} style={raceStyles.driverRowCompact}>
          <Text style={raceStyles.positionBadgeCompact}>P{driver.position}</Text>
          <Text style={raceStyles.driverNameCompact} numberOfLines={1}>{driver.name}</Text>
          <Text style={raceStyles.teamNameCompact} numberOfLines={1}>{driver.team}</Text>
        </View>
      ))}

      {/* Expand / collapse toggle */}
      {rest.length > 0 && (
        <Pressable
          style={raceStyles.expandRow}
          onPress={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          hitSlop={8}
        >
          <Text style={raceStyles.expandText}>
            {expanded ? "Show less" : `+ ${rest.length} more drivers`}
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}

function TeamRow({ team, isLive, isCricket }: {
  team: ApiLiveScore["homeTeam"];
  isLive: boolean;
  isCricket: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!team.name && !team.score) return null;

  return (
    <View style={styles.teamRow}>
      {team.logo ? (
        <Image source={{ uri: team.logo }} style={styles.teamLogo} />
      ) : (
        <View style={styles.teamLogoPlaceholder}>
          <Feather name="shield" size={14} color={colors.textMuted} />
        </View>
      )}
      <View style={styles.teamInfo}>
        <Text style={styles.teamName} numberOfLines={1}>{team.name}</Text>
        {team.record ? <Text style={styles.teamRecord}>{team.record}</Text> : null}
      </View>
      <Text
        style={[isCricket ? styles.teamScoreCricket : styles.teamScore, isLive && styles.teamScoreLive]}
        numberOfLines={1}
      >
        {team.score || "-"}
      </Text>
    </View>
  );
}

// ---- Match Detail Modal ----

const FOOTBALL_LEAGUE_PATH: Record<string, string> = {
  EPL: "eng.1",
  "La Liga": "esp.1",
  UCL: "uefa.champions",
  "Serie A": "ita.1",
  Bundesliga: "ger.1",
  ISL: "ind.1",
};

function MatchDetailModal({ match, relatedNews, onClose }: {
  match: ApiLiveScore | null;
  relatedNews: ApiNewsFeedItem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const [cricketDetail, setCricketDetail] = useState<ApiCricketMatchDetail | null>(null);
  const [footballDetail, setFootballDetail] = useState<ApiFootballMatchDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<"summary" | "scorecard" | "stats" | "lineup">("summary");
  const [selectedInningsIdx, setSelectedInningsIdx] = useState(0);
  const [linkedMarkets, setLinkedMarkets] = useState<ApiMarketSummary[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(false);

  useEffect(() => {
    if (!match) {
      setCricketDetail(null);
      setFootballDetail(null);
      setLoadingDetail(false);
      setActiveTab("summary");
      setSelectedInningsIdx(0);
      setLinkedMarkets([]);
      return;
    }
  }, [match]);

  // Fetch linked markets when match changes
  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    setLoadingMarkets(true);
    const q = `${match.homeTeam.name} ${match.awayTeam.name}`;
    mobileApi.getPublicMarkets({ q, category: "SPORTS", limit: 5 })
      .then((res) => { if (!cancelled) setLinkedMarkets(res.markets ?? []); })
      .catch(() => { if (!cancelled) setLinkedMarkets([]); })
      .finally(() => { if (!cancelled) setLoadingMarkets(false); });
    return () => { cancelled = true; };
  }, [match?.id]);

  const handleCreatePrediction = useCallback(() => {
    if (!match) return;
    const initialTitle = `Will ${match.homeTeam.name} beat ${match.awayTeam.name}?`;
    onClose();
    router.push({
      pathname: "/(tabs)/create",
      params: { initialTitle, initialCategory: "SPORTS" },
    });
  }, [match, onClose, router]);

  useEffect(() => {
    if (!match) return;

    if (match.sport === "Cricket") {
      let cancelled = false;
      setLoadingDetail(true);
      const leagueId = match.league === "International" ? "8042" : "8048";
      mobileApi.getCricketMatchDetail(match.id, leagueId)
        .then((data) => { if (!cancelled) setCricketDetail(data); })
        .catch((e) => console.warn("[sports] fetchMatchDetail error:", e))
        .finally(() => { if (!cancelled) setLoadingDetail(false); });
      return () => { cancelled = true; };
    }

    if (match.sport === "Football") {
      let cancelled = false;
      setLoadingDetail(true);
      const leaguePath = FOOTBALL_LEAGUE_PATH[match.league] ?? "eng.1";
      mobileApi.getFootballMatchDetail(match.id, leaguePath)
        .then((data) => { if (!cancelled) setFootballDetail(data); })
        .catch((e) => console.warn("[sports] fetchFootballDetail error:", e))
        .finally(() => { if (!cancelled) setLoadingDetail(false); });
      return () => { cancelled = true; };
    }
  }, [match?.id, match?.sport, match?.league]);

  if (!match) return null;

  // F1 sessions use a dedicated full-leaderboard modal with lap times, gaps, and tire data.
  // This guard runs before any other rendering branch so the generic two-team scoreboard
  // is never shown for F1.
  if (match.sport === "F1") {
    return <F1DetailModal match={match} onClose={onClose} />;
  }

  const isLive = match.status === "in";
  const isCricket = match.sport === "Cricket";
  const statusColor = match.status === "in" ? STATUS_COLOR_IN : match.status === "post" ? colors.textMuted : colors.accent;

  // Find related news by matching team names
  const matchedNews = relatedNews.filter((n) => {
    const lower = n.headline.toLowerCase();
    const terms = [
      match.homeTeam.name, match.homeTeam.abbreviation,
      match.awayTeam.name, match.awayTeam.abbreviation,
    ].filter((t) => t.length > 2);
    return terms.some((t) => lower.includes(t.toLowerCase()));
  }).slice(0, 3);

  // For cricket with detail data, render the enhanced scorecard
  if (isCricket && cricketDetail) {
    return (
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
        <View style={modal.overlay}>
          <Pressable style={modal.dismiss} onPress={onClose} />
          <View style={modal.content}>
            <View style={modal.handle} />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              {/* Header */}
              <View style={modal.header}>
                <View style={modal.leagueRow}>
                  <Feather name={LEAGUE_ICONS[match.league] ?? "circle"} size={14} color={colors.accent} />
                  <Text style={modal.leagueText}>{match.sport} · {match.league}</Text>
                </View>
                <View style={[modal.statusPill, isLive && modal.statusPillLive]}>
                  {isLive && <View style={modal.statusDot} />}
                  <Text style={[modal.statusText, { color: statusColor }]}>
                    {isLive ? "LIVE" : match.status === "post" ? "COMPLETED" : "UPCOMING"}
                  </Text>
                </View>
              </View>

              {/* Score header with team logos */}
              <View style={cs.scoreHeader}>
                <View style={cs.scoreTeam}>
                  {cricketDetail.homeTeam.logo ? (
                    <Image source={{ uri: cricketDetail.homeTeam.logo }} style={cs.scoreLogo} />
                  ) : (
                    <View style={cs.scoreLogoFallback}><Feather name="shield" size={20} color={colors.textMuted} /></View>
                  )}
                  <Text style={cs.scoreAbbr}>{cricketDetail.homeTeam.abbreviation}</Text>
                  <Text style={[cs.scoreValue, isLive && { color: "#ef4444" }]} numberOfLines={1}>
                    {cricketDetail.homeTeam.score || "-"}
                  </Text>
                </View>
                <Text style={cs.scoreVs}>vs</Text>
                <View style={cs.scoreTeam}>
                  {cricketDetail.awayTeam.logo ? (
                    <Image source={{ uri: cricketDetail.awayTeam.logo }} style={cs.scoreLogo} />
                  ) : (
                    <View style={cs.scoreLogoFallback}><Feather name="shield" size={20} color={colors.textMuted} /></View>
                  )}
                  <Text style={cs.scoreAbbr}>{cricketDetail.awayTeam.abbreviation}</Text>
                  <Text style={[cs.scoreValue, isLive && { color: "#ef4444" }]} numberOfLines={1}>
                    {cricketDetail.awayTeam.score || "-"}
                  </Text>
                </View>
              </View>

              {/* Status summary */}
              {(cricketDetail.statusSummary || cricketDetail.toss) ? (
                <Text style={cs.matchStatus}>
                  {cricketDetail.toss || cricketDetail.statusSummary}
                </Text>
              ) : null}

              {/* Tabs */}
              <View style={cs.tabRow}>
                <Pressable
                  style={[cs.tab, activeTab === "summary" && cs.tabActive]}
                  onPress={() => setActiveTab("summary")}
                >
                  <Text style={[cs.tabText, activeTab === "summary" && cs.tabTextActive]}>Summary</Text>
                </Pressable>
                <Pressable
                  style={[cs.tab, activeTab === "scorecard" && cs.tabActive]}
                  onPress={() => setActiveTab("scorecard")}
                >
                  <Text style={[cs.tabText, activeTab === "scorecard" && cs.tabTextActive]}>Scorecard</Text>
                </Pressable>
              </View>

              {activeTab === "summary" ? (
                <CricketSummaryTab detail={cricketDetail} isLive={isLive} matchedNews={matchedNews} />
              ) : (
                <CricketScorecardTab
                  detail={cricketDetail}
                  selectedIdx={selectedInningsIdx}
                  onSelectIdx={setSelectedInningsIdx}
                />
              )}
              <LinkedMarketsPanel
                markets={linkedMarkets}
                loading={loadingMarkets}
                onCreatePrediction={handleCreatePrediction}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  // Football with detail data
  const isFootball = match.sport === "Football";
  if (isFootball && footballDetail) {
    return (
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
        <View style={modal.overlay}>
          <Pressable style={modal.dismiss} onPress={onClose} />
          <View style={modal.content}>
            <View style={modal.handle} />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              {/* Header */}
              <View style={modal.header}>
                <View style={modal.leagueRow}>
                  <Feather name={LEAGUE_ICONS[match.league] ?? "shield"} size={14} color={colors.accent} />
                  <Text style={modal.leagueText}>Football · {match.league}</Text>
                </View>
                <View style={[modal.statusPill, isLive && modal.statusPillLive]}>
                  {isLive && <View style={modal.statusDot} />}
                  <Text style={[modal.statusText, { color: statusColor }]}>
                    {isLive ? "LIVE" : match.status === "post" ? "COMPLETED" : "UPCOMING"}
                  </Text>
                </View>
              </View>

              {/* Score header */}
              <View style={fs.scoreHeader}>
                <View style={fs.scoreTeamCol}>
                  {footballDetail.homeTeam.logo ? (
                    <Image source={{ uri: footballDetail.homeTeam.logo }} style={fs.scoreLogo} />
                  ) : (
                    <View style={fs.scoreLogoFallback}><Feather name="shield" size={22} color={colors.textMuted} /></View>
                  )}
                  <Text style={fs.scoreTeamName} numberOfLines={1}>{footballDetail.homeTeam.name}</Text>
                </View>
                <View style={fs.scoreCenterCol}>
                  <View style={fs.scoreRow}>
                    <Text style={[fs.bigScore, isLive && { color: "#ef4444" }]}>{footballDetail.homeTeam.score || "0"}</Text>
                    <Text style={fs.scoreDash}>-</Text>
                    <Text style={[fs.bigScore, isLive && { color: "#ef4444" }]}>{footballDetail.awayTeam.score || "0"}</Text>
                  </View>
                  <Text style={fs.clockText}>
                    {footballDetail.clock || footballDetail.statusDetail}
                  </Text>
                </View>
                <View style={fs.scoreTeamCol}>
                  {footballDetail.awayTeam.logo ? (
                    <Image source={{ uri: footballDetail.awayTeam.logo }} style={fs.scoreLogo} />
                  ) : (
                    <View style={fs.scoreLogoFallback}><Feather name="shield" size={22} color={colors.textMuted} /></View>
                  )}
                  <Text style={fs.scoreTeamName} numberOfLines={1}>{footballDetail.awayTeam.name}</Text>
                </View>
              </View>

              {/* Tabs */}
              <View style={fs.tabRow}>
                {(["summary", "stats", "lineup"] as const).map((tab) => (
                  <Pressable
                    key={tab}
                    style={[fs.tab, activeTab === tab && fs.tabActive]}
                    onPress={() => setActiveTab(tab)}
                  >
                    <Text style={[fs.tabText, activeTab === tab && fs.tabTextActive]}>
                      {tab === "summary" ? "Summary" : tab === "stats" ? "Stats" : "Lineup"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {activeTab === "summary" ? (
                <FootballSummaryTab detail={footballDetail} homeAbbr={footballDetail.homeTeam.abbreviation} />
              ) : activeTab === "stats" ? (
                <FootballStatsTab detail={footballDetail} />
              ) : (
                <FootballLineupTab detail={footballDetail} />
              )}
              <LinkedMarketsPanel
                markets={linkedMarkets}
                loading={loadingMarkets}
                onCreatePrediction={handleCreatePrediction}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  // Football loading state
  if (isFootball && loadingDetail) {
    return (
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
        <View style={modal.overlay}>
          <Pressable style={modal.dismiss} onPress={onClose} />
          <View style={modal.content}>
            <View style={modal.handle} />
            <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 80 }}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={{ color: colors.textMuted, marginTop: spacing.md, fontSize: 13 }}>
                Loading match details...
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Cricket loading state
  if (isCricket && loadingDetail) {
    return (
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
        <View style={modal.overlay}>
          <Pressable style={modal.dismiss} onPress={onClose} />
          <View style={modal.content}>
            <View style={modal.handle} />
            <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 80 }}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={{ color: colors.textMuted, marginTop: spacing.md, fontSize: 13 }}>
                Loading scorecard...
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Non-cricket / fallback modal (original)
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={modal.overlay}>
        <Pressable style={modal.dismiss} onPress={onClose} />
        <View style={modal.content}>
          <View style={modal.handle} />

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
            {/* Header */}
            <View style={modal.header}>
              <View style={modal.leagueRow}>
                <Feather name={LEAGUE_ICONS[match.league] ?? "circle"} size={14} color={colors.accent} />
                <Text style={modal.leagueText}>{match.sport} · {match.league}</Text>
              </View>
              <View style={[modal.statusPill, isLive && modal.statusPillLive]}>
                {isLive && <View style={modal.statusDot} />}
                <Text style={[modal.statusText, { color: statusColor }]}>
                  {isLive ? "LIVE" : match.status === "post" ? "COMPLETED" : "UPCOMING"}
                </Text>
              </View>
            </View>

            {match.statusSummary ? (
              <Text style={modal.summary}>{match.statusSummary}</Text>
            ) : null}

            {/* Score display */}
            <View style={modal.scoreSection}>
              <View style={modal.teamSide}>
                {match.homeTeam.logo ? (
                  <Image source={{ uri: match.homeTeam.logo }} style={modal.teamLogo} />
                ) : (
                  <View style={modal.teamLogoFallback}>
                    <Feather name="shield" size={28} color={colors.textMuted} />
                  </View>
                )}
                <Text style={modal.teamName} numberOfLines={2}>{match.homeTeam.name}</Text>
                {match.homeTeam.record ? <Text style={modal.teamRecord}>{match.homeTeam.record}</Text> : null}
              </View>

              <View style={modal.scoreCenter}>
                <View style={modal.scoreRow}>
                  <Text style={[modal.bigScore, isLive && modal.scoreLive]}>{match.homeTeam.score || "0"}</Text>
                  <Text style={modal.scoreDash}>-</Text>
                  <Text style={[modal.bigScore, isLive && modal.scoreLive]}>{match.awayTeam.score || "0"}</Text>
                </View>
                <Text style={modal.shortDetail}>
                  {match.status === "pre" ? formatMatchTime(match.startTime) : match.shortDetail}
                </Text>
              </View>

              <View style={modal.teamSide}>
                {match.awayTeam.logo ? (
                  <Image source={{ uri: match.awayTeam.logo }} style={modal.teamLogo} />
                ) : (
                  <View style={modal.teamLogoFallback}>
                    <Feather name="shield" size={28} color={colors.textMuted} />
                  </View>
                )}
                <Text style={modal.teamName} numberOfLines={2}>{match.awayTeam.name}</Text>
                {match.awayTeam.record ? <Text style={modal.teamRecord}>{match.awayTeam.record}</Text> : null}
              </View>
            </View>

            {/* Linescores */}
            {(match.homeTeam.linescores || match.awayTeam.linescores) ? (
              <View style={modal.card}>
                <Text style={modal.cardTitle}>Period Scores</Text>
                <View style={modal.linescoreRow}>
                  <Text style={modal.linescoreTeam} numberOfLines={1}>
                    {match.homeTeam.abbreviation || match.homeTeam.name}
                  </Text>
                  {(match.homeTeam.linescores ?? []).map((s, i) => (
                    <Text key={i} style={modal.linescoreVal}>{s}</Text>
                  ))}
                </View>
                <View style={modal.linescoreRow}>
                  <Text style={modal.linescoreTeam} numberOfLines={1}>
                    {match.awayTeam.abbreviation || match.awayTeam.name}
                  </Text>
                  {(match.awayTeam.linescores ?? []).map((s, i) => (
                    <Text key={i} style={modal.linescoreVal}>{s}</Text>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Match info */}
            <View style={modal.card}>
              <Text style={modal.cardTitle}>Match Info</Text>
              {match.venue ? (
                <InfoRow icon="map-pin" text={match.venue} />
              ) : null}
              <InfoRow icon="clock" text={formatMatchTime(match.startTime)} />
              {match.statusDetail ? <InfoRow icon="info" text={match.statusDetail} /> : null}
              {match.broadcast ? <InfoRow icon="tv" text={match.broadcast} /> : null}
            </View>

            {/* Related news */}
            {matchedNews.length > 0 ? (
              <View style={modal.card}>
                <Text style={modal.cardTitle}>Related News</Text>
                {matchedNews.map((n) => (
                  <View key={n.id} style={modal.newsItem}>
                    <Text style={modal.newsHeadline} numberOfLines={2}>{n.headline}</Text>
                    <View style={modal.newsMeta}>
                      <Text style={modal.newsSource}>{n.sourceName}</Text>
                      <Text style={modal.newsDot}>·</Text>
                      <Text style={modal.newsTime}>{formatRelativeTime(n.publishedAt)}</Text>
                    </View>
                    {n.market ? (
                      <Link href={`/market/${n.market.id}`} asChild>
                        <Pressable style={modal.marketLink}>
                          <Feather name={n.market.marketType === "NUMERIC" ? "hash" : "bar-chart-2"} size={11} color={colors.accent} />
                          <Text style={modal.marketLinkText} numberOfLines={1}>{n.market.title}</Text>
                          <Feather name="chevron-right" size={12} color={colors.accent} />
                        </Pressable>
                      </Link>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
            <LinkedMarketsPanel
              markets={linkedMarkets}
              loading={loadingMarkets}
              onCreatePrediction={handleCreatePrediction}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---- Linked Markets Panel (T5) ----

function LinkedMarketsPanel({
  markets,
  loading,
  onCreatePrediction,
}: {
  markets: ApiMarketSummary[];
  loading: boolean;
  onCreatePrediction: () => void;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={linkedStyles.panel}>
      <Text style={linkedStyles.heading}>Predictions</Text>
      {loading ? (
        <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: spacing.md }} />
      ) : markets.length === 0 ? (
        <Text style={linkedStyles.empty}>No predictions yet for this match.</Text>
      ) : (
        markets.map((m) => (
          <Pressable
            key={m.id}
            style={linkedStyles.marketRow}
            onPress={() => router.push(`/market/${m.id}`)}
          >
            <Text style={linkedStyles.marketTitle} numberOfLines={2}>{m.title}</Text>
            <Feather name="chevron-right" size={14} color={colors.accent} />
          </Pressable>
        ))
      )}
      <Pressable style={linkedStyles.createBtn} onPress={onCreatePrediction}>
        <Feather name="plus" size={14} color="#fff" />
        <Text style={linkedStyles.createBtnText}>Create Prediction</Text>
      </Pressable>
    </View>
  );
}

// linkedStyles lives inside dark modals — rgba overlays are intentional dark panel styling
const linkedStyles = StyleSheet.create({
  panel: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  heading: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: "rgba(255,255,255,0.4)",
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  empty: {
    fontSize: 13,
    color: "rgba(255,255,255,0.4)",
    marginBottom: spacing.sm,
  },
  marketRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
    gap: spacing.sm,
  },
  marketTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#e2e8f0",
    flex: 1,
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    // uses colors.accent — but this component calls useTheme() in JSX above
    backgroundColor: "#6366f1", // brand accent; component reads colors.accent live for icons
  },
  createBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
});

// ---- Cricket Summary Tab ----

function CricketSummaryTab({ detail, isLive, matchedNews }: {
  detail: ApiCricketMatchDetail;
  isLive: boolean;
  matchedNews: ApiNewsFeedItem[];
}) {
  // Show the latest innings info
  const latestInnings = detail.innings[detail.innings.length - 1];
  const currentBatsmen = latestInnings?.batting.filter((b) => b.isNotOut).slice(-2) ?? [];
  const currentBowlers = latestInnings?.bowling.slice(-1) ?? [];

  return (
    <>
      {/* Key stats */}
      {latestInnings ? (
        <View style={cs.card}>
          <View style={cs.cardHeader}>
            <Text style={cs.cardTitle}>{latestInnings.teamAbbr} - {latestInnings.score}</Text>
            {latestInnings.runRate ? (
              <Text style={cs.runRate}>RR: {latestInnings.runRate}</Text>
            ) : null}
          </View>

          {/* Current batsmen */}
          {currentBatsmen.length > 0 ? (
            <View style={cs.currentPlayers}>
              <Text style={cs.sectionLabel}>Batting</Text>
              {currentBatsmen.map((b, i) => (
                <View key={i} style={cs.currentPlayerRow}>
                  <Text style={cs.currentPlayerName} numberOfLines={1}>{b.name}</Text>
                  <Text style={cs.currentPlayerStat}>
                    {b.runs}({b.balls})
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Current bowler */}
          {currentBowlers.length > 0 ? (
            <View style={cs.currentPlayers}>
              <Text style={cs.sectionLabel}>Bowling</Text>
              {currentBowlers.map((b, i) => (
                <View key={i} style={cs.currentPlayerRow}>
                  <Text style={cs.currentPlayerName} numberOfLines={1}>{b.name}</Text>
                  <Text style={cs.currentPlayerStat}>
                    {b.overs}-{b.maidens}-{b.runs}-{b.wickets}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Extras */}
          {latestInnings.extras.total > 0 ? (
            <View style={cs.extrasRow}>
              <Text style={cs.extrasLabel}>Extras: {latestInnings.extras.total}</Text>
              <Text style={cs.extrasDetail}>
                (wd {latestInnings.extras.wides}, nb {latestInnings.extras.noBalls}, b {latestInnings.extras.byes}, lb {latestInnings.extras.legByes})
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* All innings summary */}
      {detail.innings.length > 1 ? (
        <View style={cs.card}>
          <Text style={cs.cardTitle}>Innings</Text>
          {detail.innings.map((inn, idx) => (
            <View key={idx} style={cs.inningSummaryRow}>
              <Text style={cs.inningTeam}>{inn.teamAbbr}</Text>
              <Text style={cs.inningScore}>{inn.score}</Text>
              {inn.runRate ? <Text style={cs.inningRR}>RR {inn.runRate}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* Partnerships */}
      {latestInnings?.partnerships && latestInnings.partnerships.length > 0 ? (
        <View style={cs.card}>
          <Text style={cs.cardTitle}>Partnerships</Text>
          {latestInnings.partnerships.map((p, idx) => (
            <View key={idx} style={cs.partnershipRow}>
              <Text style={cs.partnershipWicket}>W{p.wicketNum}</Text>
              <View style={cs.partnershipDetail}>
                <Text style={cs.partnershipRuns}>{p.runs} runs</Text>
                {p.batsmen.map((b, bi) => (
                  <Text key={bi} style={cs.partnershipBatter}>
                    {b.name} {b.runs}({b.balls})
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Match info */}
      <View style={cs.card}>
        <Text style={cs.cardTitle}>Match Info</Text>
        {detail.venue ? <InfoRow icon="map-pin" text={`${detail.venue}${detail.venueCity ? `, ${detail.venueCity}` : ""}`} /> : null}
        {detail.umpires.length > 0 ? <InfoRow icon="user" text={`Umpires: ${detail.umpires.join(", ")}`} /> : null}
        {detail.statusDetail ? <InfoRow icon="info" text={detail.statusDetail} /> : null}
      </View>

      {/* Related news */}
      {matchedNews.length > 0 ? (
        <View style={cs.card}>
          <Text style={cs.cardTitle}>Related News</Text>
          {matchedNews.map((n) => (
            <View key={n.id} style={modal.newsItem}>
              <Text style={modal.newsHeadline} numberOfLines={2}>{n.headline}</Text>
              <View style={modal.newsMeta}>
                <Text style={modal.newsSource}>{n.sourceName}</Text>
                <Text style={modal.newsDot}>·</Text>
                <Text style={modal.newsTime}>{formatRelativeTime(n.publishedAt)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

// ---- Cricket Scorecard Tab ----

function CricketScorecardTab({ detail, selectedIdx, onSelectIdx }: {
  detail: ApiCricketMatchDetail;
  selectedIdx: number;
  onSelectIdx: (idx: number) => void;
}) {
  const innings = detail.innings;
  if (innings.length === 0) {
    return (
      <View style={{ padding: spacing.xl, alignItems: "center" }}>
        <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>No scorecard data available</Text>
      </View>
    );
  }

  const safeIdx = selectedIdx < innings.length ? selectedIdx : 0;
  const inn = innings[safeIdx];

  return (
    <>
      {/* Innings selector chips */}
      {innings.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
          <View style={cs.inningsChipRow}>
            {innings.map((inn, idx) => (
              <Pressable
                key={idx}
                style={[cs.inningsChip, safeIdx === idx && cs.inningsChipActive]}
                onPress={() => onSelectIdx(idx)}
              >
                <Text style={[cs.inningsChipText, safeIdx === idx && cs.inningsChipTextActive]}>
                  {inn.teamAbbr} {inn.score ? `- ${inn.score}` : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {/* Batting table */}
      <View style={cs.card}>
        <Text style={cs.cardTitle}>Batting</Text>
        {/* Header */}
        <View style={cs.tableHeaderRow}>
          <Text style={[cs.tableHeaderCell, { flex: 1 }]}>Batter</Text>
          <Text style={[cs.tableHeaderCell, cs.statCell]}>R</Text>
          <Text style={[cs.tableHeaderCell, cs.statCell]}>B</Text>
          <Text style={[cs.tableHeaderCell, cs.statCell]}>4s</Text>
          <Text style={[cs.tableHeaderCell, cs.statCell]}>6s</Text>
          <Text style={[cs.tableHeaderCell, cs.statCellWide]}>SR</Text>
        </View>
        {inn.batting.map((b, idx) => (
          <View key={idx} style={cs.tableRow}>
            <View style={{ flex: 1 }}>
              <Text style={cs.batterName} numberOfLines={1}>{b.name}</Text>
              <Text style={cs.dismissalText} numberOfLines={1}>{b.dismissal}</Text>
            </View>
            <Text style={[cs.statValue, b.isNotOut && cs.statValueHighlight]}>{b.runs}</Text>
            <Text style={cs.statValue}>{b.balls}</Text>
            <Text style={cs.statValue}>{b.fours}</Text>
            <Text style={cs.statValue}>{b.sixes}</Text>
            <Text style={[cs.statValue, cs.statCellWide]}>{b.strikeRate}</Text>
          </View>
        ))}

        {/* Extras row */}
        {inn.extras.total > 0 ? (
          <View style={cs.extrasTableRow}>
            <Text style={cs.extrasLabel}>Extras</Text>
            <Text style={cs.extrasDetail}>
              {inn.extras.total} (wd {inn.extras.wides}, nb {inn.extras.noBalls}, b {inn.extras.byes}, lb {inn.extras.legByes})
            </Text>
          </View>
        ) : null}

        {/* Total row */}
        <View style={cs.totalRow}>
          <Text style={cs.totalLabel}>Total</Text>
          <Text style={cs.totalValue}>{inn.score}</Text>
        </View>
      </View>

      {/* Bowling table */}
      {inn.bowling.length > 0 ? (
        <View style={cs.card}>
          <Text style={cs.cardTitle}>Bowling</Text>
          <View style={cs.tableHeaderRow}>
            <Text style={[cs.tableHeaderCell, { flex: 1 }]}>Bowler</Text>
            <Text style={[cs.tableHeaderCell, cs.statCell]}>O</Text>
            <Text style={[cs.tableHeaderCell, cs.statCell]}>M</Text>
            <Text style={[cs.tableHeaderCell, cs.statCell]}>R</Text>
            <Text style={[cs.tableHeaderCell, cs.statCell]}>W</Text>
            <Text style={[cs.tableHeaderCell, cs.statCellWide]}>Econ</Text>
          </View>
          {inn.bowling.map((b, idx) => (
            <View key={idx} style={cs.tableRow}>
              <Text style={[cs.batterName, { flex: 1 }]} numberOfLines={1}>{b.name}</Text>
              <Text style={cs.statValue}>{b.overs}</Text>
              <Text style={cs.statValue}>{b.maidens}</Text>
              <Text style={cs.statValue}>{b.runs}</Text>
              <Text style={[cs.statValue, b.wickets > 0 && cs.statValueHighlight]}>{b.wickets}</Text>
              <Text style={[cs.statValue, cs.statCellWide]}>{b.economy}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Fall of wickets */}
      {inn.fow.length > 0 ? (
        <View style={cs.card}>
          <Text style={cs.cardTitle}>Fall of Wickets</Text>
          <View style={cs.fowContainer}>
            {inn.fow.map((f, idx) => (
              <View key={idx} style={cs.fowChip}>
                <Text style={cs.fowNum}>{f.wicketNum}</Text>
                <Text style={cs.fowDetail}>{f.runs}/{f.wicketNum} ({f.overs})</Text>
                {f.batter ? <Text style={cs.fowBatter}>{f.batter}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

// ---- Football Summary Tab ----

function FootballSummaryTab({ detail, homeAbbr }: {
  detail: ApiFootballMatchDetail;
  homeAbbr: string;
}) {
  // Possession stat
  const possessionStat = detail.stats.find((s) => s.name === "Possession %");
  const shotsStat = detail.stats.find((s) => s.name === "Total Shots");
  const shotsOnTargetStat = detail.stats.find((s) => s.name === "Shots on Target");

  return (
    <>
      {/* Match events timeline */}
      {detail.events.length > 0 ? (
        <View style={fs.card}>
          <Text style={fs.cardTitle}>Match Events</Text>
          {detail.events.map((evt, idx) => {
            const isHome = evt.team === homeAbbr;
            return (
              <View
                key={idx}
                style={[fs.eventRow, isHome ? fs.eventRowHome : fs.eventRowAway]}
              >
                <View style={fs.eventIconCol}>
                  {evt.type === "goal" && <Text style={fs.eventIconGoal}>&#9917;</Text>}
                  {evt.type === "yellow" && <View style={fs.yellowCardIcon} />}
                  {evt.type === "red" && <View style={fs.redCardIcon} />}
                  {evt.type === "sub" && <Feather name="repeat" size={12} color="rgba(255,255,255,0.5)" />}
                </View>
                <View style={[fs.eventInfo, isHome ? { alignItems: "flex-start" } : { alignItems: "flex-end" }]}>
                  <Text style={fs.eventPlayer} numberOfLines={1}>{evt.player}</Text>
                  {evt.minute ? <Text style={fs.eventMinute}>{evt.minute}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Key stats preview */}
      {possessionStat ? (
        <View style={fs.card}>
          <Text style={fs.cardTitle}>Key Stats</Text>
          {/* Possession bar */}
          <View style={fs.possessionRow}>
            <Text style={fs.possessionValue}>{possessionStat.home}%</Text>
            <View style={fs.possessionBarContainer}>
              <View style={[fs.possessionBarHome, { flex: parseFloat(possessionStat.home) || 50 }]} />
              <View style={[fs.possessionBarAway, { flex: parseFloat(possessionStat.away) || 50 }]} />
            </View>
            <Text style={fs.possessionValue}>{possessionStat.away}%</Text>
          </View>
          <Text style={fs.possessionLabel}>Possession</Text>

          {shotsStat ? (
            <View style={fs.miniStatRow}>
              <Text style={fs.miniStatValue}>{shotsStat.home}</Text>
              <Text style={fs.miniStatLabel}>Shots</Text>
              <Text style={fs.miniStatValue}>{shotsStat.away}</Text>
            </View>
          ) : null}
          {shotsOnTargetStat ? (
            <View style={fs.miniStatRow}>
              <Text style={fs.miniStatValue}>{shotsOnTargetStat.home}</Text>
              <Text style={fs.miniStatLabel}>On Target</Text>
              <Text style={fs.miniStatValue}>{shotsOnTargetStat.away}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Match info */}
      <View style={fs.card}>
        <Text style={fs.cardTitle}>Match Info</Text>
        {detail.venue ? <InfoRow icon="map-pin" text={detail.venue} /> : null}
        {detail.attendance ? <InfoRow icon="users" text={`Attendance: ${detail.attendance}`} /> : null}
        {detail.referee ? <InfoRow icon="user" text={`Referee: ${detail.referee}`} /> : null}
        {detail.statusDetail ? <InfoRow icon="info" text={detail.statusDetail} /> : null}
      </View>
    </>
  );
}

// ---- Football Stats Tab ----

function FootballStatsTab({ detail }: { detail: ApiFootballMatchDetail }) {
  return (
    <>
      {detail.stats.map((stat, idx) => {
        const homeNum = parseFloat(stat.home) || 0;
        const awayNum = parseFloat(stat.away) || 0;
        const total = homeNum + awayNum || 1;
        const isPossession = stat.name.toLowerCase().includes("possession");

        return (
          <View key={idx} style={fs.statBlock}>
            <View style={fs.statLabelRow}>
              <Text style={fs.statValueText}>{stat.home}{isPossession ? "%" : ""}</Text>
              <Text style={fs.statNameText}>{stat.name}</Text>
              <Text style={fs.statValueText}>{stat.away}{isPossession ? "%" : ""}</Text>
            </View>
            <View style={fs.statBarContainer}>
              <View style={[fs.statBarHome, { flex: homeNum / total }]} />
              <View style={[fs.statBarAway, { flex: awayNum / total }]} />
            </View>
          </View>
        );
      })}
    </>
  );
}

// ---- Football Lineup Tab ----

function FootballLineupTab({ detail }: { detail: ApiFootballMatchDetail }) {
  return (
    <>
      {/* Home team */}
      <View style={fs.card}>
        <Text style={fs.cardTitle}>
          {detail.homeTeam.abbreviation} {detail.homeLineup.formation ? `· ${detail.homeLineup.formation}` : ""}
        </Text>
        <Text style={fs.lineupSectionLabel}>Starting XI</Text>
        {detail.homeLineup.starters.map((p, idx) => (
          <View key={idx} style={fs.lineupPlayerRow}>
            <Text style={fs.lineupJersey}>{p.jersey}</Text>
            <Text style={fs.lineupName} numberOfLines={1}>{p.name}</Text>
            <Text style={fs.lineupPos}>{p.position}</Text>
          </View>
        ))}
        {detail.homeLineup.subs.length > 0 ? (
          <>
            <Text style={[fs.lineupSectionLabel, { marginTop: spacing.md }]}>Substitutes</Text>
            {detail.homeLineup.subs.map((p, idx) => (
              <View key={idx} style={fs.lineupPlayerRow}>
                <Text style={fs.lineupJersey}>{p.jersey}</Text>
                <Text style={[fs.lineupName, { color: "rgba(255,255,255,0.5)" }]} numberOfLines={1}>{p.name}</Text>
                <Text style={fs.lineupPos}>{p.position}</Text>
              </View>
            ))}
          </>
        ) : null}
      </View>

      {/* Away team */}
      <View style={fs.card}>
        <Text style={fs.cardTitle}>
          {detail.awayTeam.abbreviation} {detail.awayLineup.formation ? `· ${detail.awayLineup.formation}` : ""}
        </Text>
        <Text style={fs.lineupSectionLabel}>Starting XI</Text>
        {detail.awayLineup.starters.map((p, idx) => (
          <View key={idx} style={fs.lineupPlayerRow}>
            <Text style={fs.lineupJersey}>{p.jersey}</Text>
            <Text style={fs.lineupName} numberOfLines={1}>{p.name}</Text>
            <Text style={fs.lineupPos}>{p.position}</Text>
          </View>
        ))}
        {detail.awayLineup.subs.length > 0 ? (
          <>
            <Text style={[fs.lineupSectionLabel, { marginTop: spacing.md }]}>Substitutes</Text>
            {detail.awayLineup.subs.map((p, idx) => (
              <View key={idx} style={fs.lineupPlayerRow}>
                <Text style={fs.lineupJersey}>{p.jersey}</Text>
                <Text style={[fs.lineupName, { color: "rgba(255,255,255,0.5)" }]} numberOfLines={1}>{p.name}</Text>
                <Text style={fs.lineupPos}>{p.position}</Text>
              </View>
            ))}
          </>
        ) : null}
      </View>
    </>
  );
}

function InfoRow({ icon, text }: { icon: React.ComponentProps<typeof Feather>["name"]; text: string }) {
  return (
    <View style={modal.infoRow}>
      <Feather name={icon} size={14} color="rgba(255,255,255,0.4)" />
      <Text style={modal.infoText}>{text}</Text>
    </View>
  );
}

// ---- Sports News Card ----

function SportsNewsCard({ item, onPress }: { item: ApiNewsFeedItem; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      style={({ pressed }) => [styles.newsCard, pressed && styles.newsCardPressed]}
      onPress={onPress}
    >
      <View style={styles.newsCardInner}>
        <View style={styles.newsCardText}>
          <Text style={styles.newsHeadline}>{item.headline}</Text>
          <View style={styles.newsMetaRow}>
            <Text style={styles.newsMeta}>{item.sourceName}</Text>
            <Text style={styles.newsMetaDot}>·</Text>
            <Text style={styles.newsMeta}>{formatRelativeTime(item.publishedAt)}</Text>
            {item.market && (
              <>
                <Text style={styles.newsMetaDot}>·</Text>
                <Feather name="bar-chart-2" size={11} color={colors.accent} />
              </>
            )}
          </View>
        </View>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.newsThumb} />
        ) : null}
      </View>
    </Pressable>
  );
}

// ---- Story Modal ----

function StoryModal({
  item,
  cardHeight,
  onClose,
}: {
  item: ApiNewsFeedItem | null;
  cardHeight: number;
  onClose: () => void;
}) {
  const storyModal = useThemedStyles(makeStoryModalStyles);
  if (!item) return null;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={storyModal.overlay}>
        <Pressable style={storyModal.dismiss} onPress={onClose} />
        <View style={[storyModal.sheet, { height: cardHeight }]}>
          <View style={storyModal.handle} />
          <NewsFeedCard item={item} viewportHeight={cardHeight - 28} />
        </View>
      </View>
    </Modal>
  );
}

const makeStoryModalStyles = (t: ThemeContextValue) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: t.colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
    paddingTop: 10,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: t.colors.border,
    alignSelf: "center", marginBottom: 6,
  },
});

// ---- Styles ----

const makeStyles = (t: ThemeContextValue) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.colors.background },
  errorScreen: { justifyContent: "flex-start" },
  errorBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  errorText: {
    fontSize: 14,
    color: t.colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: t.colors.accent,
  },
  retryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: t.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  headerTitle: { fontSize: 22, fontWeight: "800", color: t.colors.text },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill,
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ef4444" },
  liveText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, color: "#ef4444" },
  listContent: { paddingBottom: 100 },

  // League chips
  leagueChips: { marginTop: spacing.sm, marginBottom: spacing.xs },
  leagueChipsContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  leagueChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
  leagueChipActive: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
  leagueChipText: { fontSize: 12, fontWeight: "700", color: t.colors.text },
  leagueChipTextActive: { color: "#FFFFFF" },
  chipLiveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#ef4444" },

  // Loading / empty
  loadingBox: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  loadingText: { fontSize: 13, color: t.colors.textMuted },
  emptyScores: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.xs },
  emptyScoresText: { fontSize: 15, fontWeight: "600", color: t.colors.textMuted },
  emptyScoresSub: { fontSize: 13, color: t.colors.textMuted },

  // Score cards — intentionally dark UI strip regardless of app theme
  scoresSection: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  scoreCard: {
    padding: spacing.md, borderRadius: radius.md,
    backgroundColor: "#1a1a2e", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  scoreCardLive: { borderColor: "rgba(239,68,68,0.2)" },
  scoreCardHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: spacing.sm,
  },
  scoreLeagueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  scoreLeague: {
    fontSize: 10, fontWeight: "800", letterSpacing: 0.8,
    color: "rgba(255,255,255,0.5)", textTransform: "uppercase",
  },
  scoreStatusBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  scoreStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ef4444" },
  scoreStatusText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  teamsContainer: { gap: 2 },
  teamRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  teamLogo: { width: 24, height: 24, borderRadius: 12 },
  teamLogoPlaceholder: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center",
  },
  teamInfo: { flex: 1 },
  teamName: { fontSize: 14, fontWeight: "600", color: "#e2e8f0" },
  teamRecord: { fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 },
  teamScore: { fontSize: 20, fontWeight: "800", color: "#FFF", minWidth: 32, textAlign: "right" },
  teamScoreCricket: { fontSize: 13, fontWeight: "700", color: "#FFF", maxWidth: 140, textAlign: "right" },
  teamScoreLive: { color: "#ef4444" },
  cardFooter: {
    flexDirection: "row", alignItems: "center", gap: 4,
    marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.04)",
  },
  venueText: { fontSize: 10, color: "rgba(255,255,255,0.25)", flex: 1 },

  // News section
  newsHeader: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm,
  },
  newsHeaderText: { fontSize: 16, fontWeight: "700", color: t.colors.text },
  newsCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radius.md, backgroundColor: t.colors.surface,
    borderWidth: 1, borderColor: t.colors.border,
  },
  newsCardInner: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  newsCardText: { flex: 1 },
  newsThumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: t.colors.surface },
  newsHeadline: { fontSize: 14, fontWeight: "700", lineHeight: 20, color: t.colors.text },
  newsMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.xs },
  newsMeta: { fontSize: 11, color: t.colors.textMuted },
  newsMetaDot: { fontSize: 11, color: t.colors.textMuted },
  newsCardPressed: { opacity: 0.85 },
  newsCardPollHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  newsCardPollHintText: {
    fontSize: 11,
    fontWeight: "600",
    color: t.colors.accent,
  },
  newsSummaryBlock: {
    marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.sm,
    backgroundColor: t.colors.surfaceMuted,
  },
  newsSummaryText: { fontSize: 13, lineHeight: 19, color: t.colors.textMuted },
});

// ---- Modal styles — intentional dark overlay panel, kept as-is ----

const modal = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  dismiss: { flex: 1 },
  content: {
    backgroundColor: "#1a1a2e", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg, maxHeight: "85%",
  },
  handle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)",
    alignSelf: "center", marginTop: spacing.sm, marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: spacing.xs,
  },
  leagueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  leagueText: { fontSize: 14, fontWeight: "700", color: "#e2e8f0" },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  statusPillLive: { backgroundColor: "rgba(239,68,68,0.15)" },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ef4444" },
  statusText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  summary: { fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: spacing.md },

  scoreSection: {
    flexDirection: "row", alignItems: "flex-start", justifyContent: "center",
    paddingVertical: spacing.lg, gap: spacing.md,
  },
  teamSide: { alignItems: "center", flex: 1, gap: 4 },
  teamLogo: { width: 52, height: 52, borderRadius: 26 },
  teamLogoFallback: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center",
  },
  teamName: { fontSize: 13, fontWeight: "700", color: "#e2e8f0", textAlign: "center", marginTop: 4 },
  teamRecord: { fontSize: 11, color: "rgba(255,255,255,0.35)" },

  scoreCenter: { alignItems: "center", justifyContent: "center", paddingTop: 8, minWidth: 80 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  bigScore: { fontSize: 36, fontWeight: "800", color: "#FFF" },
  scoreDash: { fontSize: 24, fontWeight: "300", color: "rgba(255,255,255,0.3)" },
  cricketScore: { fontSize: 16, fontWeight: "800", color: "#FFF", textAlign: "center" },
  vsText: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.2)", paddingVertical: 4 },
  scoreLive: { color: "#ef4444" },
  shortDetail: { fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 6, textAlign: "center" },

  // Info cards
  card: {
    marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cardTitle: {
    fontSize: 12, fontWeight: "800", letterSpacing: 0.5,
    color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: spacing.sm,
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5 },
  infoText: { fontSize: 13, color: "rgba(255,255,255,0.6)", flex: 1 },

  // Linescores
  linescoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 6 },
  linescoreTeam: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.6)", width: 50 },
  linescoreVal: {
    fontSize: 12, fontWeight: "700", color: "#FFF", minWidth: 40, textAlign: "center",
    paddingVertical: 3, paddingHorizontal: 6, borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden",
  },

  // Related news
  newsItem: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" },
  newsHeadline: { fontSize: 13, fontWeight: "600", color: "#e2e8f0", lineHeight: 18 },
  newsMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  newsSource: { fontSize: 10, color: "rgba(255,255,255,0.35)" },
  newsDot: { fontSize: 10, color: "rgba(255,255,255,0.35)" },
  newsTime: { fontSize: 10, color: "rgba(255,255,255,0.35)" },
  marketLink: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6,
    paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm,
    backgroundColor: "rgba(14,165,233,0.08)",
  },
  marketLinkText: { fontSize: 12, fontWeight: "600", color: "#0ea5e9", flex: 1 },
});

// ---- Cricket Scorecard styles — intentional dark panel ----

const cs = StyleSheet.create({
  // Score header
  scoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    gap: spacing.lg,
  },
  scoreTeam: { alignItems: "center", flex: 1, gap: 4 },
  scoreLogo: { width: 40, height: 40, borderRadius: 20 },
  scoreLogoFallback: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center",
  },
  scoreAbbr: { fontSize: 14, fontWeight: "800", color: "#e2e8f0", letterSpacing: 0.5 },
  scoreValue: { fontSize: 16, fontWeight: "800", color: "#FFF", textAlign: "center" },
  scoreVs: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.2)" },

  // Status
  matchStatus: {
    fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "center",
    marginBottom: spacing.sm, paddingHorizontal: spacing.md,
  },

  // Tabs
  tabRow: {
    flexDirection: "row", marginVertical: spacing.sm,
    borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden",
  },
  tab: {
    flex: 1, paddingVertical: 10, alignItems: "center",
  },
  tabActive: { backgroundColor: "#6366f1" },
  tabText: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.5)" },
  tabTextActive: { color: "#FFF" },

  // Card
  card: {
    marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cardHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: 12, fontWeight: "800", letterSpacing: 0.5,
    color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: spacing.xs,
  },
  runRate: { fontSize: 12, fontWeight: "700", color: "#6366f1" },

  // Current players (summary)
  currentPlayers: { marginTop: spacing.sm },
  sectionLabel: {
    fontSize: 10, fontWeight: "800", letterSpacing: 0.5,
    color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 4,
  },
  currentPlayerRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 4,
  },
  currentPlayerName: { fontSize: 13, fontWeight: "600", color: "#e2e8f0", flex: 1 },
  currentPlayerStat: { fontSize: 13, fontWeight: "700", color: "#FFF", fontVariant: ["tabular-nums"] },

  // Extras
  extrasRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)",
  },
  extrasLabel: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.5)" },
  extrasDetail: { fontSize: 11, color: "rgba(255,255,255,0.35)" },

  // Innings summary
  inningSummaryRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)",
  },
  inningTeam: { fontSize: 13, fontWeight: "700", color: "#e2e8f0", width: 44 },
  inningScore: { fontSize: 13, fontWeight: "600", color: "#FFF", flex: 1 },
  inningRR: { fontSize: 11, color: "rgba(255,255,255,0.4)" },

  // Partnerships
  partnershipRow: {
    flexDirection: "row", gap: spacing.sm, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)",
  },
  partnershipWicket: {
    fontSize: 11, fontWeight: "800", color: "#6366f1", width: 28,
    paddingTop: 2,
  },
  partnershipDetail: { flex: 1 },
  partnershipRuns: { fontSize: 13, fontWeight: "700", color: "#e2e8f0" },
  partnershipBatter: { fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 },

  // Innings selector chips
  inningsChipRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: 2 },
  inningsChip: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "transparent",
  },
  inningsChipActive: { backgroundColor: "rgba(14,165,233,0.15)", borderColor: "#6366f1" },
  inningsChipText: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.5)" },
  inningsChipTextActive: { color: "#6366f1" },

  // Table
  tableHeaderRow: {
    flexDirection: "row", alignItems: "center",
    paddingBottom: 6, marginBottom: 2,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  tableHeaderCell: {
    fontSize: 10, fontWeight: "800", letterSpacing: 0.3,
    color: "rgba(255,255,255,0.35)", textTransform: "uppercase",
  },
  statCell: { width: 30, textAlign: "center" },
  statCellWide: { width: 42, textAlign: "center" },
  tableRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.03)",
  },
  batterName: { fontSize: 13, fontWeight: "600", color: "#e2e8f0" },
  dismissalText: { fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 },
  statValue: {
    fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.7)",
    width: 30, textAlign: "center", fontVariant: ["tabular-nums"],
  },
  statValueHighlight: { color: "#FFF", fontWeight: "800" },

  // Extras table row
  extrasTableRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },

  // Total row
  totalRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 8, marginTop: 2,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)",
  },
  totalLabel: { fontSize: 14, fontWeight: "800", color: "#e2e8f0" },
  totalValue: { fontSize: 14, fontWeight: "800", color: "#FFF" },

  // Fall of wickets
  fowContainer: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  fowChip: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
  },
  fowNum: { fontSize: 10, fontWeight: "800", color: "#6366f1" },
  fowDetail: { fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.6)" },
  fowBatter: { fontSize: 9, color: "rgba(255,255,255,0.35)" },
});

// ---- Football styles — intentional dark panel ----

const fs = StyleSheet.create({
  // Score header
  scoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  scoreTeamCol: { alignItems: "center", flex: 1, gap: 4 },
  scoreLogo: { width: 44, height: 44, borderRadius: 22 },
  scoreLogoFallback: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center",
  },
  scoreTeamName: { fontSize: 12, fontWeight: "700", color: "#e2e8f0", textAlign: "center" },
  scoreCenterCol: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  bigScore: { fontSize: 36, fontWeight: "800", color: "#FFF" },
  scoreDash: { fontSize: 24, fontWeight: "300", color: "rgba(255,255,255,0.3)" },
  clockText: { fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4, textAlign: "center" },

  // Tabs
  tabRow: {
    flexDirection: "row", marginVertical: spacing.sm,
    borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden",
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabActive: { backgroundColor: "#6366f1" },
  tabText: { fontSize: 13, fontWeight: "700", color: "rgba(255,255,255,0.5)" },
  tabTextActive: { color: "#FFF" },

  // Card
  card: {
    marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cardTitle: {
    fontSize: 12, fontWeight: "800", letterSpacing: 0.5,
    color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: spacing.xs,
  },

  // Events timeline
  eventRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)",
  },
  eventRowHome: { justifyContent: "flex-start" },
  eventRowAway: { flexDirection: "row-reverse" },
  eventIconCol: { width: 20, alignItems: "center" },
  eventIconGoal: { fontSize: 14 },
  yellowCardIcon: {
    width: 10, height: 14, borderRadius: 2, backgroundColor: "#facc15",
  },
  redCardIcon: {
    width: 10, height: 14, borderRadius: 2, backgroundColor: "#ef4444",
  },
  eventInfo: { flex: 1 },
  eventPlayer: { fontSize: 13, fontWeight: "600", color: "#e2e8f0" },
  eventMinute: { fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 1 },

  // Possession / key stats preview
  possessionRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginBottom: 4,
  },
  possessionBarContainer: {
    flex: 1, flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden",
  },
  possessionBarHome: { backgroundColor: "#6366f1" },
  possessionBarAway: { backgroundColor: "rgba(255,255,255,0.2)" },
  possessionValue: {
    fontSize: 13, fontWeight: "700", color: "#FFF", width: 42, textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  possessionLabel: {
    fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.35)",
    textAlign: "center", textTransform: "uppercase", letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  miniStatRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)",
  },
  miniStatValue: {
    fontSize: 14, fontWeight: "700", color: "#FFF", width: 42, textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  miniStatLabel: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.5)", textAlign: "center" },

  // Stats tab - full stat bars
  statBlock: { marginBottom: spacing.md },
  statLabelRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: 4,
  },
  statValueText: {
    fontSize: 13, fontWeight: "700", color: "#FFF", width: 50, fontVariant: ["tabular-nums"],
  },
  statNameText: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.5)", textAlign: "center", flex: 1 },
  statBarContainer: {
    flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", gap: 2,
  },
  statBarHome: { backgroundColor: "#6366f1", borderRadius: 3 },
  statBarAway: { backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 3 },

  // Lineup tab
  lineupSectionLabel: {
    fontSize: 10, fontWeight: "800", letterSpacing: 0.5,
    color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 4, marginTop: spacing.xs,
  },
  lineupPlayerRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.03)",
  },
  lineupJersey: {
    fontSize: 12, fontWeight: "800", color: "#6366f1", width: 24, textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  lineupName: { fontSize: 13, fontWeight: "600", color: "#e2e8f0", flex: 1 },
  lineupPos: {
    fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.35)",
    width: 36, textAlign: "right", textTransform: "uppercase",
  },
});

// ---- Race Card styles — intentional dark panel ----

const raceStyles = StyleSheet.create({
  sessionName: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.45)",
    marginBottom: spacing.sm,
  },
  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  positionBadge: {
    width: 28,
    height: 20,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  p1Badge: {
    backgroundColor: "rgba(250,204,21,0.18)",
  },
  positionText: {
    fontSize: 10,
    fontWeight: "800",
    color: "rgba(255,255,255,0.6)",
    letterSpacing: 0.3,
    fontVariant: ["tabular-nums"],
  },
  p1PositionText: {
    color: "#facc15",
  },
  teamColourBar: {
    width: 4,
    height: 28,
    borderRadius: 2,
  },
  teamColourBarFallback: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  driverAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  driverAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  driverAvatarInitial: {
    fontSize: 11,
    fontWeight: "800",
    color: "rgba(255,255,255,0.5)",
  },
  driverInfo: {
    flex: 1,
    gap: 1,
  },
  driverName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#e2e8f0",
  },
  p1Name: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFF",
  },
  teamName: {
    fontSize: 10,
    color: "rgba(255,255,255,0.4)",
  },
  driverRowCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  positionBadgeCompact: {
    fontSize: 10,
    fontWeight: "800",
    color: "rgba(255,255,255,0.4)",
    width: 28,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  driverNameCompact: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.7)",
    flex: 1,
  },
  teamNameCompact: {
    fontSize: 10,
    color: "rgba(255,255,255,0.3)",
    maxWidth: 100,
    textAlign: "right",
  },
  expandRow: {
    alignItems: "center",
    paddingVertical: spacing.sm,
    marginTop: 2,
  },
  expandText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6366f1",
    letterSpacing: 0.3,
  },
});
