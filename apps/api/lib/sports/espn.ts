/**
 * Multi-source sports scores client.
 *
 * - ESPN public API: Cricket (IPL, International), Football (EPL, La Liga, UCL, etc.), Tennis
 * - OpenF1 API: Formula 1 live timing and results
 *
 * All APIs are free and require no API keys.
 * Scores are cached in-memory for 2 minutes.
 */

export type TeamDetail = {
  name: string;
  abbreviation: string;
  logo: string;
  score: string;
  record?: string;       // e.g. "16-10-7"
  linescores?: string[];  // per-period scores
};

export type LiveScore = {
  id: string;
  sport: string;
  league: string;
  status: "pre" | "in" | "post";
  statusDetail: string;
  shortDetail: string;
  startTime: string;
  venue?: string;
  venueCity?: string;
  statusSummary?: string;  // e.g. "GT won toss & fielded"
  broadcast?: string;
  homeTeam: TeamDetail;
  awayTeam: TeamDetail;
  leaderboard?: Array<{
    position: number;
    name: string;
    abbreviation: string;
    logo: string;
    team: string;
    teamColour?: string;
  }>;
};

type CacheEntry = {
  scores: LiveScore[];
  fetchedAt: number;
};

const CACHE_TTL_MS = 30 * 1000; // 30 seconds for more real-time scores

const scoreCache = new Map<string, CacheEntry>();

// ---- ESPN Leagues ----

const ESPN_LEAGUES: Array<{ sport: string; league: string; path: string }> = [
  // Cricket
  { sport: "Cricket", league: "IPL", path: "cricket/8048" },
  { sport: "Cricket", league: "International", path: "cricket/8042" },
  // Football (Soccer)
  { sport: "Football", league: "EPL", path: "soccer/eng.1" },
  { sport: "Football", league: "La Liga", path: "soccer/esp.1" },
  { sport: "Football", league: "UCL", path: "soccer/uefa.champions" },
  { sport: "Football", league: "Serie A", path: "soccer/ita.1" },
  { sport: "Football", league: "Bundesliga", path: "soccer/ger.1" },
  { sport: "Football", league: "ISL", path: "soccer/ind.1" },
  // Tennis
  { sport: "Tennis", league: "ATP", path: "tennis/atp" },
  { sport: "Tennis", league: "WTA", path: "tennis/wta" },
];

function buildScoreboardUrl(path: string): string {
  return `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;
}

async function fetchLeagueScores(leagueConfig: typeof ESPN_LEAGUES[number]): Promise<LiveScore[]> {
  const cacheKey = leagueConfig.path;
  const cached = scoreCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.scores;
  }

  try {
    const url = buildScoreboardUrl(leagueConfig.path);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn(`[sports:espn] ${leagueConfig.league} returned ${response.status}`);
      return cached?.scores ?? [];
    }

    const data = await response.json();
    const events = data?.events ?? [];

    const scores: LiveScore[] = events.map((event: any) => {
      const competition = event.competitions?.[0];
      const statusObj = competition?.status ?? event.status;
      const competitors = competition?.competitors ?? [];

      const home = competitors.find((c: any) => c.homeAway === "home") ?? competitors[0];
      const away = competitors.find((c: any) => c.homeAway === "away") ?? competitors[1];

      const statusState = statusObj?.type?.state ?? "pre";

      const homeScore = home?.score ?? "0";
      const awayScore = away?.score ?? "0";

      // Extract extra detail fields
      const venue = competition?.venue;
      const broadcasts = competition?.broadcasts ?? [];
      const broadcastName = broadcasts[0]?.names?.[0] ?? "";

      const extractRecord = (c: any): string | undefined => {
        const rec = c?.records?.find((r: any) => r.type === "total");
        return rec?.summary || undefined;
      };

      const extractLinescores = (c: any): string[] | undefined => {
        const ls = c?.linescores;
        if (!ls || !Array.isArray(ls) || ls.length === 0) return undefined;
        return ls.map((l: any) => {
          // Cricket: show runs/wickets, Football: show goals
          if (l.wickets !== undefined) return `${l.runs}/${l.wickets}`;
          return String(l.value ?? l.displayValue ?? "");
        });
      };

      return {
        id: event.id,
        sport: leagueConfig.sport,
        league: leagueConfig.league,
        status: statusState as LiveScore["status"],
        statusDetail: statusObj?.type?.detail ?? "",
        shortDetail: statusObj?.type?.shortDetail ?? statusObj?.displayClock ?? "",
        startTime: event.date ?? competition?.date ?? "",
        venue: venue?.fullName ?? undefined,
        venueCity: venue?.address?.city ?? undefined,
        statusSummary: statusObj?.summary ?? undefined,
        broadcast: broadcastName || undefined,
        homeTeam: {
          name: home?.team?.displayName ?? home?.team?.name ?? "Home",
          abbreviation: home?.team?.abbreviation ?? "",
          logo: home?.team?.logo ?? home?.team?.logos?.[0]?.href ?? "",
          score: homeScore,
          record: extractRecord(home),
          linescores: extractLinescores(home),
        },
        awayTeam: {
          name: away?.team?.displayName ?? away?.team?.name ?? "Away",
          abbreviation: away?.team?.abbreviation ?? "",
          logo: away?.team?.logo ?? away?.team?.logos?.[0]?.href ?? "",
          score: awayScore,
          record: extractRecord(away),
          linescores: extractLinescores(away),
        },
      };
    });

    scoreCache.set(cacheKey, { scores, fetchedAt: Date.now() });
    return scores;
  } catch (err) {
    console.warn(`[sports:espn] failed to fetch ${leagueConfig.league}:`, err instanceof Error ? err.message : err);
    return cached?.scores ?? [];
  }
}

// ---- OpenF1 (Formula 1) ----

type OpenF1Driver = {
  driver_number: number;
  full_name: string;
  team_name: string;
  team_colour: string;
  name_acronym: string;
  headshot_url?: string;
};

type OpenF1Position = {
  driver_number: number;
  position: number;
  date: string;
};

type OpenF1Session = {
  session_key: number;
  session_name: string;
  session_type: string;
  circuit_short_name: string;
  country_name: string;
  date_start: string;
  date_end: string;
};

async function fetchF1Scores(): Promise<LiveScore[]> {
  const cacheKey = "openf1";
  const cached = scoreCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.scores;
  }

  try {
    // Fetch latest session
    const sessionRes = await fetch("https://api.openf1.org/v1/sessions?session_key=latest", { cache: "no-store" });
    if (!sessionRes.ok) return cached?.scores ?? [];
    const sessions: OpenF1Session[] = await sessionRes.json();
    const session = sessions[0];
    if (!session) return [];

    // Fetch drivers and positions in parallel
    const [driversRes, positionsRes] = await Promise.all([
      fetch(`https://api.openf1.org/v1/drivers?session_key=${session.session_key}`, { cache: "no-store" }),
      fetch(`https://api.openf1.org/v1/position?session_key=${session.session_key}`, { cache: "no-store" }),
    ]);

    if (!driversRes.ok || !positionsRes.ok) return cached?.scores ?? [];

    const drivers: OpenF1Driver[] = await driversRes.json();
    const positions: OpenF1Position[] = await positionsRes.json();

    // Get latest position for each driver
    const latestPositions = new Map<number, OpenF1Position>();
    for (const p of positions) {
      const existing = latestPositions.get(p.driver_number);
      if (!existing || p.date > existing.date) {
        latestPositions.set(p.driver_number, p);
      }
    }

    const driverMap = new Map(drivers.map((d) => [d.driver_number, d]));

    // Sort by position
    const sorted = Array.from(latestPositions.values())
      .sort((a, b) => a.position - b.position);

    // Determine session status
    const sessionEnd = new Date(session.date_end).getTime();
    const sessionStart = new Date(session.date_start).getTime();
    const now = Date.now();
    let status: LiveScore["status"] = "pre";
    if (now >= sessionStart && now <= sessionEnd + 2 * 60 * 60 * 1000) {
      status = "in";
    } else if (now > sessionEnd) {
      status = "post";
    }

    // One card per session with leaderboard; back-compat homeTeam/awayTeam shim P1/P2
    const scores: LiveScore[] = [];
    const topDrivers = sorted.slice(0, 10);

    if (topDrivers.length > 0) {
      const p1 = topDrivers[0];
      const p2 = topDrivers[1] ?? null;
      const d1 = driverMap.get(p1.driver_number);
      const d2 = p2 ? driverMap.get(p2.driver_number) : null;

      scores.push({
        id: `f1-${session.session_key}`,
        sport: "F1",
        league: "F1",
        status,
        statusDetail: `${session.session_name} - ${session.circuit_short_name}`,
        shortDetail: session.session_name,
        startTime: session.date_start,
        homeTeam: {
          name: d1?.full_name ?? `Driver #${p1.driver_number}`,
          abbreviation: d1?.name_acronym ?? String(p1.driver_number),
          logo: d1?.headshot_url ?? "",
          score: `P${p1.position}`,
        },
        awayTeam: {
          name: d2?.full_name ?? "",
          abbreviation: d2?.name_acronym ?? "",
          logo: d2?.headshot_url ?? "",
          score: p2 ? `P${p2.position}` : "",
        },
        leaderboard: topDrivers.map((dp) => {
          const d = driverMap.get(dp.driver_number);
          const rawColour = d?.team_colour ?? undefined;
          const teamColour = rawColour
            ? rawColour.startsWith("#") ? rawColour : `#${rawColour}`
            : undefined;
          return {
            position: dp.position,
            name: d?.full_name ?? `Driver #${dp.driver_number}`,
            abbreviation: d?.name_acronym ?? String(dp.driver_number),
            logo: d?.headshot_url ?? "",
            team: d?.team_name ?? "",
            teamColour,
          };
        }),
      });
    }

    scoreCache.set(cacheKey, { scores, fetchedAt: Date.now() });
    return scores;
  } catch (err) {
    console.warn("[sports:f1] failed to fetch:", err instanceof Error ? err.message : err);
    return cached?.scores ?? [];
  }
}

// ---- Public API ----

/**
 * Fetch scores for all configured sports.
 * Returns live games, today's finished games, and upcoming games (within 6 hours).
 * Live games are sorted first.
 */
export async function getLiveScores(): Promise<LiveScore[]> {
  const results = await Promise.allSettled([
    ...ESPN_LEAGUES.map((league) => fetchLeagueScores(league)),
    fetchF1Scores(),
  ]);

  const allScores: LiveScore[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allScores.push(...result.value);
    }
  }

  const now = Date.now();

  const filtered = allScores.filter((score) => {
    if (score.status === "in") return true;
    const isCricket = score.sport === "Cricket";
    const gameTime = new Date(score.startTime).getTime();
    if (score.status === "post") {
      return now - gameTime < 48 * 60 * 60 * 1000;
    }
    if (score.status === "pre") {
      const window = isCricket ? 48 * 60 * 60 * 1000 : 36 * 60 * 60 * 1000;
      return gameTime - now < window;
    }
    return false;
  });

  // Sort: live first, then upcoming, then finished
  const statusOrder: Record<string, number> = { in: 0, pre: 1, post: 2 };
  filtered.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));

  return filtered;
}

/**
 * Find scores that match keywords from a story headline or market title.
 */
export function matchScoresToText(scores: LiveScore[], text: string): LiveScore[] {
  const lower = text.toLowerCase();
  return scores.filter((score) => {
    const terms = [
      score.homeTeam.name,
      score.homeTeam.abbreviation,
      score.awayTeam.name,
      score.awayTeam.abbreviation,
      score.league,
    ];
    return terms.some((term) => term.length > 2 && lower.includes(term.toLowerCase()));
  });
}

/**
 * Get all live/recent scores (for a standalone scores endpoint).
 */
export async function getAllScores(): Promise<LiveScore[]> {
  const results = await Promise.allSettled([
    ...ESPN_LEAGUES.map((league) => fetchLeagueScores(league)),
    fetchF1Scores(),
  ]);

  const allScores: LiveScore[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allScores.push(...result.value);
    }
  }

  return allScores;
}
