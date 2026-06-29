/**
 * Multi-source sports scores client.
 *
 * - ESPN scoreboard header API: Cricket, Football (Soccer), Tennis — leagues discovered
 *   dynamically per sport from ESPN's header endpoint, so new tournaments (e.g. FIFA World Cup)
 *   appear automatically without any code change.
 * - OpenF1 API: Formula 1 live timing and results.
 *
 * All APIs are free and require no API keys.
 * Scores are cached in-memory for 30 seconds.
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
  /** Raw ESPN event id (no league prefix) — used to build match-detail URLs. */
  eventId: string;
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
  /** ESPN league slug used to construct football match-detail URLs (e.g. "eng.1", "fifa.world"). */
  leaguePath?: string;
  /** ESPN numeric league id used to construct cricket match-detail URLs (e.g. "8048", "8042"). */
  leagueId?: string;
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

// ---- Sport definitions (stable — sports don't change, leagues are discovered) ----

const ESPN_SPORTS: Array<{ key: string; display: string }> = [
  { key: "soccer",  display: "Football" },
  { key: "cricket", display: "Cricket"  },
  { key: "tennis",  display: "Tennis"   },
];

function buildHeaderUrl(sportKey: string): string {
  return `https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=${sportKey}&region=us&lang=en`;
}

/**
 * Fetch all events for one sport via the ESPN scoreboard header endpoint.
 * The header returns every league that currently has events, with full event
 * detail embedded — one HTTP call replaces the old per-league scoreboard calls.
 */
async function fetchSportScores(sport: { key: string; display: string }): Promise<LiveScore[]> {
  const cacheKey = `header:${sport.key}`;
  const cached = scoreCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.scores;
  }

  try {
    const url = buildHeaderUrl(sport.key);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn(`[sports:espn] header for ${sport.key} returned ${response.status}`);
      return cached?.scores ?? [];
    }

    const data = await response.json();

    // ESPN header: data.sports[0].leagues[].events[]
    const leagues: any[] = data?.sports?.[0]?.leagues ?? [];

    const scores: LiveScore[] = [];

    for (const league of leagues) {
      const leagueName: string = league.name ?? league.slug ?? "Unknown";
      const leagueSlug: string = league.slug ?? "";
      // Cricket leagues use numeric slugs (e.g. "23813"); soccer leagues use dot-slugs (e.g. "eng.1")
      const isCricketNumericId = /^\d+$/.test(leagueSlug);
      const events: any[] = league.events ?? [];

      for (const event of events) {
        const competitors: any[] = event.competitors ?? [];
        const home = competitors.find((c: any) => c.homeAway === "home") ?? competitors[0];
        const away = competitors.find((c: any) => c.homeAway === "away") ?? competitors[1];

        // Map ESPN status string to our three-state convention
        const rawStatus: string = event.status ?? "pre";
        const mappedStatus: LiveScore["status"] =
          rawStatus === "in" ? "in" : rawStatus === "post" ? "post" : "pre";

        // summary field holds human-readable state like "HT", "FT", "1-0", "45'"
        const summary: string = event.summary ?? "";
        // clock is a numeric string like "45:00"
        const clock: string = event.clock ?? "";

        const homeScore: string = home?.score ?? "";
        const awayScore: string = away?.score ?? "";

        // Globally-unique React key. ESPN models some tournaments (e.g. a tennis
        // Grand Slam) as a SINGLE event id shared by every match in the draw, so
        // `${slug}-${event.id}` alone collides across matches. Append the two
        // competitor ids (which differ per match) to guarantee uniqueness. The raw
        // ESPN event id is preserved separately in `eventId` for detail fetches.
        const competitorKey = [home?.id, away?.id].filter(Boolean).join("-");
        const score: LiveScore = {
          id: competitorKey
            ? `${leagueSlug}-${event.id}-${competitorKey}`
            : `${leagueSlug}-${event.id}`,
          eventId: String(event.id ?? ""),
          sport: sport.display,
          league: leagueName,
          status: mappedStatus,
          statusDetail: summary || clock,
          shortDetail: summary || clock,
          startTime: event.date ?? "",
          venue: event.location ?? undefined,
          venueCity: undefined,
          statusSummary: undefined,
          broadcast: undefined,
          // Provide routing hints so the mobile detail fetch is fully dynamic —
          // no hardcoded maps required on the client.
          leaguePath: isCricketNumericId ? undefined : leagueSlug || undefined,
          leagueId:   isCricketNumericId ? leagueSlug : undefined,
          homeTeam: {
            name: home?.displayName ?? home?.name ?? "Home",
            abbreviation: home?.abbreviation ?? "",
            logo: home?.logo ?? "",
            score: homeScore,
          },
          awayTeam: {
            name: away?.displayName ?? away?.name ?? "Away",
            abbreviation: away?.abbreviation ?? "",
            logo: away?.logo ?? "",
            score: awayScore,
          },
        };

        scores.push(score);
      }
    }

    scoreCache.set(cacheKey, { scores, fetchedAt: Date.now() });
    return scores;
  } catch (err) {
    console.warn(
      `[sports:espn] failed to fetch header for ${sport.key}:`,
      err instanceof Error ? err.message : err
    );
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
        eventId: String(session.session_key),
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
 * Returns live games, today's finished games, and upcoming games (within 6–48 hours).
 * Live games are sorted first.
 */
export async function getLiveScores(): Promise<LiveScore[]> {
  const results = await Promise.allSettled([
    ...ESPN_SPORTS.map((sport) => fetchSportScores(sport)),
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
    ...ESPN_SPORTS.map((sport) => fetchSportScores(sport)),
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
