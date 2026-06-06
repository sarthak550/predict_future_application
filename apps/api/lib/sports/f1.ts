/**
 * OpenF1 API client for Formula 1 session detail data.
 *
 * This module owns all detailed F1 fetch logic (lap times, gaps, tire stints).
 * The list-level fetchF1Scores function remains in espn.ts and is re-exported
 * from there to preserve all existing call sites.
 *
 * OpenF1 docs: https://openf1.org/
 */

// ---- Raw OpenF1 shapes -------------------------------------------------------

type OpenF1Session = {
  session_key: number;
  session_name: string;
  session_type: string;
  circuit_short_name: string;
  country_name: string;
  date_start: string;
  date_end: string;
};

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

type OpenF1Lap = {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  is_pit_out_lap: boolean;
};

type OpenF1Interval = {
  driver_number: number;
  gap_to_leader: number | null;
  interval: number | null;
  date: string;
};

type OpenF1Stint = {
  driver_number: number;
  compound: string;
  lap_start: number;
  lap_end: number | null;
};

// ---- Public result types (also exported from packages/types) -----------------

export type F1SessionStatus = "upcoming" | "live" | "finished";
export type F1TireCompound = "HARD" | "MEDIUM" | "SOFT" | "INTERMEDIATE" | "WET";

export type F1DriverDetail = {
  driverNumber: number;
  position: number;
  name: string;
  abbreviation: string;
  headshot?: string;
  team: string;
  teamColour: string;
  lastLap?: { duration: number; lapNumber: number; isPitOut: boolean };
  fastestLap?: { duration: number; lapNumber: number };
  fastestLapOverall: boolean;
  gapToLeader?: number;
  intervalAhead?: number;
  tireCompound?: F1TireCompound;
};

export type F1SessionDetail = {
  session: {
    key: number;
    name: string;
    type: string;
    circuit: string;
    country: string;
    dateStart: string;
    dateEnd: string;
    status: F1SessionStatus;
  };
  drivers: F1DriverDetail[];
};

// ---- Helpers ----------------------------------------------------------------

const BASE = "https://api.openf1.org/v1";

async function openF1Fetch<T>(path: string): Promise<T[]> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`OpenF1 ${path} returned HTTP ${res.status}`);
  }
  return res.json() as Promise<T[]>;
}

function normalizeTeamColour(raw: string | undefined): string {
  if (!raw) return "#888888";
  return raw.startsWith("#") ? raw : `#${raw}`;
}

function resolveSessionStatus(dateStart: string, dateEnd: string): F1SessionStatus {
  const now = Date.now();
  const start = new Date(dateStart).getTime();
  // Add a 2-hour grace window after official end — sessions often run long.
  const end = new Date(dateEnd).getTime() + 2 * 60 * 60 * 1000;
  if (now < start) return "upcoming";
  if (now > end) return "finished";
  return "live";
}

const VALID_COMPOUNDS: Set<string> = new Set(["HARD", "MEDIUM", "SOFT", "INTERMEDIATE", "WET"]);

function toTireCompound(raw: string | undefined): F1TireCompound | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  return VALID_COMPOUNDS.has(upper) ? (upper as F1TireCompound) : undefined;
}

const RACE_SESSION_TYPES: Set<string> = new Set(["Race", "Sprint"]);

// ---- Main export ------------------------------------------------------------

/**
 * Fetch full F1 session detail from OpenF1.
 *
 * Returns null when:
 * - sessionKey is invalid (NaN, 0, negative)
 * - OpenF1 returns an empty session array (session not found)
 *
 * Throws when a downstream fetch fails so the caller can return 503.
 *
 * Uses Promise.allSettled for the parallel data fetches so that a failure on
 * one endpoint (e.g. intervals for a Qualifying session) does not prevent the
 * remaining data from being returned.
 */
export async function fetchF1SessionDetail(sessionKey: number): Promise<F1SessionDetail | null> {
  if (!Number.isFinite(sessionKey) || sessionKey <= 0) return null;

  // Step 1: fetch session metadata first — we need session_type before deciding
  // whether to trust the intervals response.
  const sessions = await openF1Fetch<OpenF1Session>(`/sessions?session_key=${sessionKey}`);
  const session = sessions[0];
  if (!session) return null;

  const isRaceSession = RACE_SESSION_TYPES.has(session.session_type);

  // Step 2: fan out to remaining endpoints in parallel; tolerate partial failures.
  const [driversResult, positionsResult, lapsResult, intervalsResult, stintsResult] =
    await Promise.allSettled([
      openF1Fetch<OpenF1Driver>(`/drivers?session_key=${sessionKey}`),
      openF1Fetch<OpenF1Position>(`/position?session_key=${sessionKey}`),
      openF1Fetch<OpenF1Lap>(`/laps?session_key=${sessionKey}`),
      openF1Fetch<OpenF1Interval>(`/intervals?session_key=${sessionKey}`),
      openF1Fetch<OpenF1Stint>(`/stints?session_key=${sessionKey}`),
    ]);

  if (driversResult.status === "rejected") {
    console.warn("[f1] drivers fetch failed:", driversResult.reason);
  }
  if (positionsResult.status === "rejected") {
    console.warn("[f1] positions fetch failed:", positionsResult.reason);
  }
  if (lapsResult.status === "rejected") {
    console.warn("[f1] laps fetch failed:", lapsResult.reason);
  }
  if (intervalsResult.status === "rejected") {
    console.warn("[f1] intervals fetch failed:", intervalsResult.reason);
  }
  if (stintsResult.status === "rejected") {
    console.warn("[f1] stints fetch failed:", stintsResult.reason);
  }

  const rawDrivers = driversResult.status === "fulfilled" ? driversResult.value : [];
  const rawPositions = positionsResult.status === "fulfilled" ? positionsResult.value : [];
  const rawIntervals = intervalsResult.status === "fulfilled" ? intervalsResult.value : [];
  const rawStints = stintsResult.status === "fulfilled" ? stintsResult.value : [];

  // Retry laps once if the first attempt returned an empty array or all-null durations.
  // This handles the common OpenF1 flake where /v1/laps returns an empty result on
  // the first call but succeeds seconds later. We do NOT retry on rejection (transient
  // network error) — the console.warn above already handles that path.
  let rawLaps = lapsResult.status === "fulfilled" ? lapsResult.value : [];
  if (
    lapsResult.status === "fulfilled" &&
    (rawLaps.length === 0 || rawLaps.every((l) => l.lap_duration === null))
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const retryLaps = await openF1Fetch<OpenF1Lap>(`/laps?session_key=${sessionKey}`);
      const adopted = retryLaps.some((l) => l.lap_duration !== null);
      console.log(`[f1] laps retry — adopted=${adopted}`);
      if (adopted) rawLaps = retryLaps;
    } catch {
      // Retry failed — continue with original (empty/null) result.
    }
  }

  // ---- Build lookup maps ----

  // driver_number → driver metadata
  const driverMap = new Map<number, OpenF1Driver>(
    rawDrivers.map((d) => [d.driver_number, d])
  );

  // driver_number → latest position
  const posMap = new Map<number, OpenF1Position>();
  for (const p of rawPositions) {
    const existing = posMap.get(p.driver_number);
    if (!existing || p.date > existing.date) {
      posMap.set(p.driver_number, p);
    }
  }

  // driver_number → { lastLap, fastestLap }
  const lapsByDriver = new Map<number, { lastLap: OpenF1Lap; fastestLap: OpenF1Lap }>();
  for (const lap of rawLaps) {
    // Skip laps with null duration (e.g. pit-out lap where timing failed).
    if (lap.lap_duration === null) continue;
    const existing = lapsByDriver.get(lap.driver_number);
    if (!existing) {
      lapsByDriver.set(lap.driver_number, { lastLap: lap, fastestLap: lap });
    } else {
      const updatedLast =
        lap.lap_number > existing.lastLap.lap_number ? lap : existing.lastLap;
      const updatedFastest =
        lap.lap_duration < (existing.fastestLap.lap_duration ?? Infinity) ? lap : existing.fastestLap;
      lapsByDriver.set(lap.driver_number, { lastLap: updatedLast, fastestLap: updatedFastest });
    }
  }

  // driver_number → latest interval entry (race sessions only)
  const intervalMap = new Map<number, OpenF1Interval>();
  if (isRaceSession) {
    for (const iv of rawIntervals) {
      const existing = intervalMap.get(iv.driver_number);
      if (!existing || iv.date > existing.date) {
        intervalMap.set(iv.driver_number, iv);
      }
    }
  }

  // driver_number → current tire compound (stint with highest lap_start)
  const stintMap = new Map<number, OpenF1Stint>();
  for (const stint of rawStints) {
    const existing = stintMap.get(stint.driver_number);
    if (!existing || stint.lap_start > existing.lap_start) {
      stintMap.set(stint.driver_number, stint);
    }
  }

  // ---- Compute global fastest lap across all drivers ----
  let globalFastestDriverNumber: number | null = null;
  let globalFastestDuration = Infinity;
  for (const [dNum, { fastestLap }] of lapsByDriver) {
    const dur = fastestLap.lap_duration;
    if (dur !== null && dur < globalFastestDuration) {
      globalFastestDuration = dur;
      globalFastestDriverNumber = dNum;
    }
  }

  // ---- Collect all driver numbers from position + driver list ----
  // Drivers in positions but possibly not in driverMap are included.
  const allDriverNumbers = new Set<number>([
    ...posMap.keys(),
    ...driverMap.keys(),
  ]);

  // ---- Merge into result drivers ----
  const drivers: F1DriverDetail[] = [];

  for (const dNum of allDriverNumbers) {
    const pos = posMap.get(dNum);
    const driverMeta = driverMap.get(dNum);
    if (!pos && !driverMeta) continue;

    const lapData = lapsByDriver.get(dNum);
    const interval = intervalMap.get(dNum);
    const stint = stintMap.get(dNum);

    const lastLapRaw = lapData?.lastLap;
    const fastestLapRaw = lapData?.fastestLap;

    const lastLap =
      lastLapRaw && lastLapRaw.lap_duration !== null
        ? {
            duration: lastLapRaw.lap_duration,
            lapNumber: lastLapRaw.lap_number,
            isPitOut: lastLapRaw.is_pit_out_lap,
          }
        : undefined;

    const fastestLap =
      fastestLapRaw && fastestLapRaw.lap_duration !== null
        ? {
            duration: fastestLapRaw.lap_duration,
            lapNumber: fastestLapRaw.lap_number,
          }
        : undefined;

    const driver: F1DriverDetail = {
      driverNumber: dNum,
      position: pos?.position ?? 99,
      name: driverMeta?.full_name ?? `Driver #${dNum}`,
      abbreviation: driverMeta?.name_acronym ?? String(dNum),
      headshot: driverMeta?.headshot_url ?? undefined,
      team: driverMeta?.team_name ?? "",
      teamColour: normalizeTeamColour(driverMeta?.team_colour),
      lastLap,
      fastestLap,
      fastestLapOverall: globalFastestDriverNumber === dNum,
      // Race/Sprint sessions only
      gapToLeader: isRaceSession && interval?.gap_to_leader != null
        ? interval.gap_to_leader
        : undefined,
      intervalAhead: isRaceSession && interval?.interval != null
        ? interval.interval
        : undefined,
      tireCompound: toTireCompound(stint?.compound),
    };

    drivers.push(driver);
  }

  // For non-race sessions (Qualifying, Practice, Sprint Qualifying, etc.),
  // OpenF1's /v1/position endpoint is unreliable: after each session segment
  // ends, drivers park in the pit box and OpenF1 records position 99
  // (unclassified) for all of them. This makes the positional data useless
  // for Qualifying/Practice. The correct ranking signal is fastest lap time.
  //
  // For Race/Sprint sessions, /v1/position is accurate and is kept as-is.
  if (!isRaceSession) {
    // Sort drivers by fastest lap ascending; drivers without a fastest lap
    // (DNS, did not set a timed lap) sort to the end using Infinity.
    const sorted = [...drivers].sort((a, b) => {
      const aDur = a.fastestLap?.duration ?? Infinity;
      const bDur = b.fastestLap?.duration ?? Infinity;
      return aDur - bDur;
    });
    // Re-assign sequential positions 1..N so downstream consumers get clean
    // ordinal ranks instead of all-99s from the position endpoint.
    sorted.forEach((driver, idx) => {
      driver.position = idx + 1;
    });
  }

  // Sort by position ascending; drivers without a position entry go last.
  drivers.sort((a, b) => a.position - b.position);

  return {
    session: {
      key: session.session_key,
      name: session.session_name,
      type: session.session_type,
      circuit: session.circuit_short_name,
      country: session.country_name,
      dateStart: session.date_start,
      dateEnd: session.date_end,
      status: resolveSessionStatus(session.date_start, session.date_end),
    },
    drivers,
  };
}
