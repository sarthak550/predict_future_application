import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/sports/match/[eventId]?league=8048
 *
 * Fetches detailed match data (cricket scorecard or football match detail) from ESPN summary API.
 * Cached in-memory for 30 seconds.
 */

type CacheEntry = { data: unknown; fetchedAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

/**
 * Leagues are now discovered dynamically via the ESPN scoreboard header.
 * Cricket leagues use numeric ids (e.g. "8048"), football leagues use slug paths
 * (e.g. "eng.1", "fifa.world"). We detect the type by checking whether the id is
 * purely numeric rather than maintaining an exhaustive whitelist.
 *
 * Friendly display names are kept for the detail response body only.
 */
const KNOWN_CRICKET_NAMES: Record<string, string> = {
  "8048": "IPL",
  "8042": "International",
};

const KNOWN_FOOTBALL_NAMES: Record<string, string> = {
  "eng.1": "EPL",
  "esp.1": "La Liga",
  "uefa.champions": "UCL",
  "ita.1": "Serie A",
  "ger.1": "Bundesliga",
  "ind.1": "ISL",
  "fifa.world": "FIFA World Cup",
  "fifa.friendly": "Internationals",
};

/** Returns true for purely numeric league ids — those are cricket. */
function isCricketLeagueId(leagueId: string): boolean {
  return /^\d+$/.test(leagueId);
}

function findStat(stats: any[], name: string): any {
  return stats?.find((s: any) => s.name === name);
}

function findStatValue(stats: any[], name: string, fallback: any = 0): any {
  const stat = findStat(stats, name);
  return stat?.value ?? stat?.displayValue ?? fallback;
}

function parseExtrasFromStats(stats: any[]) {
  return {
    total: Number(findStatValue(stats, "extras", 0)),
    wides: Number(findStatValue(stats, "wides", 0)),
    noBalls: Number(findStatValue(stats, "noballs", 0)),
    byes: Number(findStatValue(stats, "byes", 0)),
    legByes: Number(findStatValue(stats, "legbyes", 0)),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } }
) {
  try {
    const { eventId } = params;
    const leagueId = request.nextUrl.searchParams.get("league") || "8048";

    // Basic validation: leagueId must be non-empty. We no longer maintain an
    // exhaustive whitelist — leagues are discovered dynamically.
    if (!leagueId.trim()) {
      return NextResponse.json(
        { error: "Missing league parameter." },
        { status: 400 }
      );
    }

    const cacheKey = `${leagueId}:${eventId}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json(cached.data, {
        headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
      });
    }

    const isFootball = !isCricketLeagueId(leagueId);
    const sport = isFootball ? "soccer" : "cricket";
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueId}/summary?event=${eventId}`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });

    if (!res.ok) {
      console.error(`[sports:match] ESPN returned ${res.status} for event ${eventId} (league=${leagueId})`);
      return NextResponse.json(
        { error: `ESPN API returned ${res.status}` },
        { status: 502 }
      );
    }

    const raw = await res.json();
    const data = isFootball
      ? transformFootballSummary(raw, eventId, leagueId)
      : transformEspnSummary(raw, eventId, leagueId);

    cache.set(cacheKey, { data, fetchedAt: Date.now() });

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("[sports:match] error:", error);
    return NextResponse.json({ error: "Failed to fetch match details" }, { status: 500 });
  }
}

function transformEspnSummary(raw: any, eventId: string, leagueId: string) {
  const header = raw.header ?? {};
  const competition = header.competitions?.[0] ?? {};
  const competitors = competition.competitors ?? [];
  const statusObj = competition.status ?? {};
  const gameInfo = raw.gameInfo ?? {};

  // Teams
  const home = competitors.find((c: any) => c.homeAway === "home") ?? competitors[0];
  const away = competitors.find((c: any) => c.homeAway === "away") ?? competitors[1];

  // Status
  const statusState = statusObj.type?.state ?? "pre";
  const statusDetail = statusObj.type?.detail ?? "";
  const statusSummary = statusObj.summary ?? "";

  // Venue
  const venue = gameInfo.venue;
  const venueName = venue?.fullName ?? "";
  const venueCity = venue?.address?.city ?? venue?.city ?? "";

  // Toss - extract from status summary if it mentions toss
  const toss = statusSummary.toLowerCase().includes("toss") ? statusSummary : "";

  // Umpires
  const officials = gameInfo.officials ?? [];
  const umpires = officials.map((o: any) => o.displayName ?? "").filter(Boolean);

  // Team extras and runRate from competitor linescores
  function extractTeamStats(competitor: any) {
    const ls = competitor?.linescores?.[0];
    const stats = ls?.statistics?.categories?.[0]?.stats ?? [];
    const extras = parseExtrasFromStats(stats);
    const runRate = String(findStatValue(stats, "runRate", ""));
    return { extras, runRate: runRate || undefined };
  }

  const homeStats = extractTeamStats(home);
  const awayStats = extractTeamStats(away);

  // Build innings from rosters
  const rosters = raw.rosters ?? [];
  const innings = buildInnings(rosters, competitors, competition);

  return {
    eventId,
    sport: "Cricket",
    league: KNOWN_CRICKET_NAMES[leagueId] ?? leagueId,
    status: statusState as "pre" | "in" | "post",
    statusDetail,
    statusSummary,
    venue: venueName,
    venueCity,
    toss,
    umpires,
    homeTeam: {
      name: home?.team?.displayName ?? home?.team?.name ?? "Home",
      abbreviation: home?.team?.abbreviation ?? "",
      logo: home?.team?.logo ?? home?.team?.logos?.[0]?.href ?? "",
      score: home?.score ?? "",
      runRate: homeStats.runRate,
      extras: homeStats.extras,
    },
    awayTeam: {
      name: away?.team?.displayName ?? away?.team?.name ?? "Away",
      abbreviation: away?.team?.abbreviation ?? "",
      logo: away?.team?.logo ?? away?.team?.logos?.[0]?.href ?? "",
      score: away?.score ?? "",
      runRate: awayStats.runRate,
      extras: awayStats.extras,
    },
    innings,
  };
}

function buildInnings(rosters: any[], competitors: any[], competition: any) {
  const innings: any[] = [];

  // FOW and partnerships from competition level
  const fowData = competition.fow ?? [];
  const partnershipsData = competition.partnerships ?? [];

  for (const roster of rosters) {
    const teamId = roster.team?.id;
    const teamName = roster.team?.displayName ?? roster.team?.name ?? "";
    const teamAbbr = roster.team?.abbreviation ?? "";

    // Find the competitor to get score info
    const competitor = competitors.find((c: any) => c.id === teamId) ?? {};
    const linescores = competitor.linescores ?? [];

    // Each linescore entry = one innings for this team
    for (let inningsIdx = 0; inningsIdx < Math.max(linescores.length, 1); inningsIdx++) {
      const ls = linescores[inningsIdx];

      // Score string
      const runs = ls?.runs ?? ls?.value ?? "";
      const wickets = ls?.wickets ?? "";
      const overs = ls?.displayValue ?? ls?.overs ?? "";
      let score = "";
      if (runs !== "" && wickets !== "") {
        score = `${runs}/${wickets}`;
        if (overs) score += ` (${overs} ov)`;
      } else if (runs !== "") {
        score = String(runs);
      }

      // Extras and run rate from this innings linescore stats
      const lsStats = ls?.statistics?.categories?.[0]?.stats ?? [];
      const extras = parseExtrasFromStats(lsStats);
      const runRate = String(findStatValue(lsStats, "runRate", ""));

      // Batting stats - from roster linescores
      const batting: any[] = [];
      const bowling: any[] = [];
      const entries = roster.roster ?? [];

      for (const player of entries) {
        const playerName = player.athlete?.displayName ?? player.athlete?.shortName ?? "";

        // Batting: roster[].linescores[inningsIdx].linescores[0].statistics.categories[0].stats[]
        const playerInningsLS = player.linescores?.[inningsIdx];
        const battingStats = playerInningsLS?.linescores?.[0]?.statistics?.categories?.[0]?.stats ?? [];
        const batted = Number(findStatValue(battingStats, "batted", 0));
        if (batted === 1 || battingStats.length > 0) {
          const pRuns = Number(findStatValue(battingStats, "runs", 0));
          const pBalls = Number(findStatValue(battingStats, "ballsFaced", 0));
          const pFours = Number(findStatValue(battingStats, "fours", 0));
          const pSixes = Number(findStatValue(battingStats, "sixes", 0));
          const pSR = findStatValue(battingStats, "strikeRate", "0.00");
          const dismissalText = findStatValue(battingStats, "dismissalText", "");
          const dismissalCard = findStatValue(battingStats, "dismissalCard", "");
          const dismissal = dismissalCard || dismissalText || "";
          const isNotOut = !dismissal || dismissal === "not out" || dismissal === "batting";

          if (batted === 1) {
            batting.push({
              name: playerName,
              runs: pRuns,
              balls: pBalls,
              fours: pFours,
              sixes: pSixes,
              strikeRate: String(pSR),
              dismissal: isNotOut ? "not out" : dismissal,
              isNotOut,
            });
          }
        }

        // Bowling: roster[].linescores[inningsIdx].statistics.categories[0].stats[]
        const bowlingStats = playerInningsLS?.statistics?.categories?.[0]?.stats ?? [];
        const bowled = Number(findStatValue(bowlingStats, "bowled", 0));
        if (bowled > 0 || bowlingStats.length > 0) {
          const bOvers = findStatValue(bowlingStats, "overs", "0");
          const bMaidens = Number(findStatValue(bowlingStats, "maidens", 0));
          const bConceded = Number(findStatValue(bowlingStats, "conceded", 0));
          const bWickets = Number(findStatValue(bowlingStats, "wickets", 0));
          const bEcon = findStatValue(bowlingStats, "economy", "0.00");

          if (bowled > 0) {
            bowling.push({
              name: playerName,
              overs: String(bOvers),
              maidens: bMaidens,
              runs: bConceded,
              wickets: bWickets,
              economy: String(bEcon),
            });
          }
        }
      }

      // Only add innings if we have score data or batting data
      if (score || batting.length > 0) {
        // FOW for this team
        const teamFow = fowData
          .filter((f: any) => {
            const fowTeam = f.team?.abbreviation ?? f.team?.id;
            return fowTeam === teamAbbr || fowTeam === teamId;
          })
          .map((f: any) => ({
            wicketNum: f.wicketNumber ?? 0,
            runs: f.runs ?? 0,
            overs: f.wicketOver ?? "",
            batter: f.athlete?.displayName ?? f.athlete?.shortName ?? "",
          }));

        // Partnerships for this team
        const teamPartnerships = partnershipsData
          .filter((p: any) => {
            const pTeam = p.team?.abbreviation ?? p.team?.id;
            return pTeam === teamAbbr || pTeam === teamId;
          })
          .map((p: any, idx: number) => ({
            wicketNum: idx + 1,
            runs: p.runs ?? 0,
            overs: p.balls ? String(Math.floor(p.balls / 6)) + "." + (p.balls % 6) : "",
            batsmen: (p.batsmen ?? []).map((b: any) => ({
              name: b.athlete?.displayName ?? b.name ?? "",
              runs: b.runs ?? 0,
              balls: b.balls ?? 0,
            })),
          }));

        innings.push({
          teamAbbr,
          teamName,
          score,
          runRate: runRate || "",
          extras,
          batting,
          bowling,
          fow: teamFow,
          partnerships: teamPartnerships,
        });
      }
    }
  }

  return innings;
}

// ---- Football transform ----

function transformFootballSummary(raw: any, eventId: string, leagueId: string) {
  const header = raw.header ?? {};
  const competition = header.competitions?.[0] ?? {};
  const competitors = competition.competitors ?? [];
  const statusObj = competition.status ?? {};
  const gameInfo = raw.gameInfo ?? {};
  const boxscore = raw.boxscore ?? {};

  // Teams
  const home = competitors.find((c: any) => c.homeAway === "home") ?? competitors[0];
  const away = competitors.find((c: any) => c.homeAway === "away") ?? competitors[1];

  // Rosters for lineups
  const rosters = raw.rosters ?? [];
  const homeRoster = rosters.find((r: any) => r.homeAway === "home") ?? rosters[0];
  const awayRoster = rosters.find((r: any) => r.homeAway === "away") ?? rosters[1];

  // Status
  const statusState = statusObj.type?.state ?? "pre";
  const statusDetail = statusObj.type?.detail ?? "";
  const displayClock = statusObj.displayClock ?? "";
  const period = statusObj.period ?? 0;

  let clock = "";
  if (statusState === "post") {
    clock = "FT";
  } else if (statusState === "in") {
    if (period === 1 && displayClock === "45:00") clock = "HT";
    else clock = displayClock ? displayClock.replace(/:00$/, "'") : `${period * 45}'`;
  }

  // Venue & officials
  const venue = gameInfo.venue?.fullName ?? "";
  const attendance = gameInfo.attendance ? String(gameInfo.attendance) : "";
  const officials = gameInfo.officials ?? [];
  const referee = officials.find((o: any) =>
    o.position?.displayName?.toLowerCase()?.includes("referee") ||
    o.position?.displayName?.toLowerCase()?.includes("main")
  )?.displayName ?? officials[0]?.displayName ?? "";

  // Stats from boxscore
  const boxTeams = boxscore.teams ?? [];
  const homeBoxTeam = boxTeams.find((t: any) => t.team?.id === home?.id) ?? boxTeams[0];
  const awayBoxTeam = boxTeams.find((t: any) => t.team?.id === away?.id) ?? boxTeams[1];

  const statNames: Array<{ key: string; label: string }> = [
    { key: "possessionPct", label: "Possession %" },
    { key: "totalShots", label: "Total Shots" },
    { key: "shotsOnTarget", label: "Shots on Target" },
    { key: "wonCorners", label: "Corners" },
    { key: "foulsCommitted", label: "Fouls" },
    { key: "yellowCards", label: "Yellow Cards" },
    { key: "redCards", label: "Red Cards" },
    { key: "offsides", label: "Offsides" },
    { key: "saves", label: "Saves" },
    { key: "totalPasses", label: "Passes" },
    { key: "accuratePasses", label: "Accurate Passes" },
    { key: "passPct", label: "Pass Accuracy %" },
  ];

  function getTeamStat(teamBox: any, key: string): string {
    if (!teamBox?.statistics) return "0";
    const stat = teamBox.statistics.find((s: any) => s.name === key);
    return stat?.displayValue ?? stat?.value?.toString() ?? "0";
  }

  const stats = statNames.map(({ key, label }) => ({
    name: label,
    home: getTeamStat(homeBoxTeam, key),
    away: getTeamStat(awayBoxTeam, key),
  }));

  // Key events
  const keyEvents = raw.keyEvents ?? [];
  const events = keyEvents
    .filter((e: any) => {
      const t = (e.type?.text ?? "").toLowerCase();
      return t.includes("goal") || t.includes("yellow") || t.includes("red") || t.includes("substitution");
    })
    .map((e: any) => {
      const typeText = (e.type?.text ?? "").toLowerCase();
      let type: "goal" | "yellow" | "red" | "sub" = "goal";
      if (typeText.includes("yellow")) type = "yellow";
      else if (typeText.includes("red")) type = "red";
      else if (typeText.includes("substitution")) type = "sub";

      return {
        minute: e.clock?.displayValue ?? "",
        type,
        team: e.team?.abbreviation ?? "",
        player: e.participants?.[0]?.athlete?.displayName ?? "",
        detail: e.text ?? undefined,
      };
    });

  // Lineups
  function buildLineup(roster: any) {
    if (!roster) return { formation: "", starters: [], subs: [] };
    const formation = roster.formation ?? "";
    const players = roster.roster ?? [];
    const starters = players
      .filter((p: any) => p.starter === true)
      .map((p: any) => ({
        name: p.athlete?.displayName ?? "",
        jersey: p.athlete?.jersey ?? p.jersey ?? "",
        position: p.position?.abbreviation ?? "",
      }));
    const subs = players
      .filter((p: any) => p.starter !== true)
      .map((p: any) => ({
        name: p.athlete?.displayName ?? "",
        jersey: p.athlete?.jersey ?? p.jersey ?? "",
        position: p.position?.abbreviation ?? "",
      }));
    return { formation, starters, subs };
  }

  return {
    eventId,
    sport: "Football" as const,
    league: KNOWN_FOOTBALL_NAMES[leagueId] ?? leagueId,
    status: statusState as "pre" | "in" | "post",
    statusDetail,
    clock,
    venue,
    attendance,
    referee,
    homeTeam: {
      name: home?.team?.displayName ?? home?.team?.name ?? "Home",
      abbreviation: home?.team?.abbreviation ?? "",
      logo: home?.team?.logo ?? home?.team?.logos?.[0]?.href ?? "",
      score: home?.score ?? "",
      formation: homeRoster?.formation ?? "",
    },
    awayTeam: {
      name: away?.team?.displayName ?? away?.team?.name ?? "Away",
      abbreviation: away?.team?.abbreviation ?? "",
      logo: away?.team?.logo ?? away?.team?.logos?.[0]?.href ?? "",
      score: away?.score ?? "",
      formation: awayRoster?.formation ?? "",
    },
    stats,
    events,
    homeLineup: buildLineup(homeRoster),
    awayLineup: buildLineup(awayRoster),
  };
}
