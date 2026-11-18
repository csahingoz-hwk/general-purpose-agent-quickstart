import { tool } from "ai";
import { z } from "zod";
import {
  type FixtureMatch,
  type FixturePayload,
  type FixtureSide,
  OWNER_TIME_ZONE,
  safeBadgeUrl,
} from "@/lib/fixtures";

const CACHE_MS = 10 * 60 * 1000;
const SPORTSDB = "www.thesportsdb.com";
const FOOTBALL_DATA = "api.football-data.org";

const teamSchema = z.object({
  idTeam: z.string().regex(/^\d{1,12}$/),
  strTeam: z.string().min(1).max(80),
  strTeamShort: z.string().max(12).nullable().optional(),
  strSport: z.string().max(40).nullable().optional(),
  idLeague: z
    .string()
    .regex(/^\d{1,12}$/)
    .nullable()
    .optional(),
  strBadge: z.string().max(300).nullable().optional(),
});

const eventSchema = z.object({
  idEvent: z.string().regex(/^\d{1,12}$/),
  strEvent: z.string().max(120).nullable().optional(),
  dateEvent: z.string().max(20).nullable().optional(),
  strTime: z.string().max(12).nullable().optional(),
  strTimestamp: z.string().max(40).nullable().optional(),
  strLeague: z.string().max(80).nullable().optional(),
  strSeason: z.string().max(12).nullable().optional(),
  intRound: z.union([z.string(), z.number()]).nullable().optional(),
  strVenue: z.string().max(80).nullable().optional(),
  strHomeTeam: z.string().max(80).nullable().optional(),
  strAwayTeam: z.string().max(80).nullable().optional(),
  strHomeTeamBadge: z.string().max(300).nullable().optional(),
  strAwayTeamBadge: z.string().max(300).nullable().optional(),
  intHomeScore: z.union([z.string(), z.number()]).nullable().optional(),
  intAwayScore: z.union([z.string(), z.number()]).nullable().optional(),
  idLeague: z
    .string()
    .regex(/^\d{1,12}$/)
    .nullable()
    .optional(),
});

const fdTeamSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(80),
  crest: z.string().max(300).nullable().optional(),
  venue: z.string().max(80).nullable().optional(),
});

const fdMatchSchema = z.object({
  id: z.number().int().optional(),
  utcDate: z.string().max(40),
  status: z.string().max(40).optional(),
  venue: z.string().max(80).nullable().optional(),
  competition: z.object({ name: z.string().max(80) }).optional(),
  homeTeam: z.object({
    name: z.string().max(80),
    crest: z.string().max(300).nullable().optional(),
  }),
  awayTeam: z.object({
    name: z.string().max(80),
    crest: z.string().max(300).nullable().optional(),
  }),
  score: z
    .object({
      fullTime: z
        .object({
          home: z.number().int().nullable().optional(),
          away: z.number().int().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
});

type CacheEntry = {
  expires: number;
  value:
    | Omit<FixturePayload, "now">
    | { error: "team_not_found"; team: string };
};

const cache = new Map<string, CacheEntry>();
let nextSportsDbSlot = 0;

async function paceSportsDb() {
  const nowMs = Date.now();
  const wait = Math.max(0, nextSportsDbSlot - nowMs);
  nextSportsDbSlot = Math.max(nowMs, nextSportsDbSlot) + 350;
  if (wait > 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, wait);
    });
  }
}

export function clearFixtureCache() {
  cache.clear();
}

function fold(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanTeamName(value: string): string | null {
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60) {
    return null;
  }
  if (!/^[\p{L}\p{M}\d .'’-]+$/u.test(name)) {
    return null;
  }
  return name;
}

function allowedUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }
    if (url.hostname !== SPORTSDB && url.hostname !== FOOTBALL_DATA) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function fetchJson(
  value: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const url = allowedUrl(value);
  if (!url) {
    throw new Error("fixtures_host_blocked");
  }
  if (url.hostname === SPORTSDB) {
    await paceSportsDb();
  }
  let wait = 800;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(url, init);
    if (response.status === 429 && attempt < 2) {
      await new Promise((resolve) => {
        setTimeout(resolve, wait);
      });
      wait *= 2;
      continue;
    }
    if (!response.ok) {
      throw new Error("fixtures_unavailable");
    }
    return response.json();
  }
  throw new Error("fixtures_unavailable");
}

function score(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d{1,2}$/.test(value)) {
    return Number(value);
  }
  return null;
}

function kickoffUtc(event: z.infer<typeof eventSchema>): string | null {
  const stamp = event.strTimestamp ?? "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(stamp)) {
    return stamp;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(stamp)) {
    return `${stamp}Z`;
  }
  if (
    event.dateEvent &&
    event.strTime &&
    /^\d{4}-\d{2}-\d{2}$/.test(event.dateEvent) &&
    /^\d{2}:\d{2}:\d{2}$/.test(event.strTime)
  ) {
    return `${event.dateEvent}T${event.strTime}Z`;
  }
  return null;
}

function side(
  name: string | null | undefined,
  badge: unknown
): FixtureSide | null {
  const clean = name?.replace(/\s+/g, " ").trim() ?? "";
  if (!clean) {
    return null;
  }
  return { name: clean.slice(0, 80), badge: safeBadgeUrl(badge) };
}

function toMatch(event: z.infer<typeof eventSchema>): FixtureMatch | null {
  const kickoff = kickoffUtc(event);
  const home = side(event.strHomeTeam, event.strHomeTeamBadge);
  const away = side(event.strAwayTeam, event.strAwayTeamBadge);
  if (!kickoff || !home || !away || Number.isNaN(Date.parse(kickoff))) {
    return null;
  }
  return {
    id: event.idEvent,
    competition: (event.strLeague ?? "").slice(0, 80),
    venue: (event.strVenue ?? "").slice(0, 80),
    kickoffUtc: kickoff,
    home,
    away,
    homeScore: score(event.intHomeScore),
    awayScore: score(event.intAwayScore),
  };
}

function sportsDbUrl(file: string, params: Record<string, string>): string {
  const url = new URL(`https://${SPORTSDB}/api/v1/json/123/${file}`);
  for (const [key, param] of Object.entries(params)) {
    url.searchParams.set(key, param);
  }
  return url.href;
}

async function loadSportsDb(
  team: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<Loaded> {
  const found = z
    .object({ teams: z.array(teamSchema).nullable() })
    .safeParse(
      await fetchJson(
        sportsDbUrl("searchteams.php", { t: team }),
        { signal },
        fetchImpl
      )
    );
  const clubs = (found.success ? found.data.teams : []) ?? [];
  const soccer = clubs.filter(
    (item) => !item.strSport || fold(item.strSport) === "soccer"
  );
  const exact =
    soccer.find((item) => fold(item.strTeam) === fold(team)) ?? soccer[0];
  if (!exact) {
    return { error: "team_not_found", team };
  }
  const nextRaw = await fetchJson(
    sportsDbUrl("eventsnext.php", { id: exact.idTeam }),
    { signal },
    fetchImpl
  );
  const lastRaw = await fetchJson(
    sportsDbUrl("eventslast.php", { id: exact.idTeam }),
    { signal },
    fetchImpl
  ).catch(() => null);
  const nextEvents =
    z.object({ events: z.array(eventSchema).nullable() }).safeParse(nextRaw)
      .data?.events ?? [];
  const lastEvents =
    z.object({ results: z.array(eventSchema).nullable() }).safeParse(lastRaw)
      .data?.results ?? [];
  const anchor = nextEvents[0];
  const season = anchor?.strSeason ?? "";
  const league = exact.idLeague ?? anchor?.idLeague ?? "";
  const round = Number(anchor?.intRound);
  const extra: z.infer<typeof eventSchema>[] = [];
  if (/^\d{4}-\d{4}$/.test(season) && /^\d{1,12}$/.test(league) && round > 0) {
    const rounds: unknown[] = [];
    for (const item of [round, round + 1, round + 2]) {
      try {
        rounds.push(
          await fetchJson(
            sportsDbUrl("eventsround.php", {
              id: league,
              r: String(item),
              s: season,
            }),
            { signal },
            fetchImpl
          )
        );
      } catch {
        break;
      }
    }
    for (const raw of rounds) {
      const parsed = z
        .object({ events: z.array(eventSchema).nullable() })
        .safeParse(raw);
      for (const event of parsed.success ? (parsed.data.events ?? []) : []) {
        const home = fold(event.strHomeTeam ?? "");
        const away = fold(event.strAwayTeam ?? "");
        if (home === fold(exact.strTeam) || away === fold(exact.strTeam)) {
          extra.push(event);
        }
      }
    }
  }
  const byId = new Map<string, FixtureMatch>();
  for (const event of [...nextEvents, ...extra, ...lastEvents]) {
    const match = toMatch(event);
    if (match) {
      byId.set(match.id, match);
    }
  }
  return {
    team: {
      id: exact.idTeam,
      name: exact.strTeam,
      badge: safeBadgeUrl(exact.strBadge),
    },
    timeZone: OWNER_TIME_ZONE,
    matches: [...byId.values()],
  };
}

type Loaded =
  | { error: "team_not_found"; team: string }
  | (Omit<FixturePayload, "now" | "upcoming" | "last"> & {
      matches: FixtureMatch[];
    });

function splitMatches(
  loaded: Loaded,
  now: Date
):
  | Omit<FixturePayload, "now">
  | {
      error: "team_not_found";
      team: string;
    } {
  if ("error" in loaded) {
    return loaded;
  }
  const upcoming = loaded.matches
    .filter((match) => Date.parse(match.kickoffUtc) > now.getTime())
    .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc))
    .slice(0, 3);
  const finished = loaded.matches
    .filter(
      (match) =>
        Date.parse(match.kickoffUtc) <= now.getTime() &&
        match.homeScore !== null &&
        match.awayScore !== null
    )
    .sort((a, b) => Date.parse(b.kickoffUtc) - Date.parse(a.kickoffUtc));
  return {
    team: loaded.team,
    timeZone: OWNER_TIME_ZONE,
    upcoming,
    last: finished[0] ?? null,
  };
}

async function loadFootballData(
  team: string,
  key: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<Loaded> {
  const headers = { "X-Auth-Token": key };
  const searchUrl = `https://${FOOTBALL_DATA}/v4/teams?name=${encodeURIComponent(team)}`;
  const raw = await fetchJson(searchUrl, { signal, headers }, fetchImpl);
  const parsed = z
    .object({ teams: z.array(fdTeamSchema).optional() })
    .safeParse(raw);
  const club = parsed.success ? parsed.data.teams?.[0] : undefined;
  if (!club) {
    return { error: "team_not_found", team };
  }
  const [scheduledRaw, finishedRaw] = await Promise.all([
    fetchJson(
      `https://${FOOTBALL_DATA}/v4/teams/${club.id}/matches?status=SCHEDULED&limit=3`,
      { signal, headers },
      fetchImpl
    ),
    fetchJson(
      `https://${FOOTBALL_DATA}/v4/teams/${club.id}/matches?status=FINISHED&limit=1`,
      { signal, headers },
      fetchImpl
    ),
  ]);
  const scheduled =
    z
      .object({ matches: z.array(fdMatchSchema).optional() })
      .safeParse(scheduledRaw).data?.matches ?? [];
  const finished =
    z
      .object({ matches: z.array(fdMatchSchema).optional() })
      .safeParse(finishedRaw).data?.matches ?? [];
  const matches = [...scheduled, ...finished].flatMap((match) => {
    const kickoff = /^\d{4}-\d{2}-\d{2}T/.test(match.utcDate)
      ? match.utcDate
      : "";
    if (!kickoff || Number.isNaN(Date.parse(kickoff))) {
      return [];
    }
    return [
      {
        id: String(match.id ?? kickoff),
        competition: match.competition?.name ?? "",
        venue: match.venue ?? club.venue ?? "",
        kickoffUtc: kickoff,
        home: {
          name: match.homeTeam.name,
          badge: safeBadgeUrl(match.homeTeam.crest),
        },
        away: {
          name: match.awayTeam.name,
          badge: safeBadgeUrl(match.awayTeam.crest),
        },
        homeScore: match.score?.fullTime?.home ?? null,
        awayScore: match.score?.fullTime?.away ?? null,
      } satisfies FixtureMatch,
    ];
  });
  return {
    team: {
      id: String(club.id),
      name: club.name,
      badge: safeBadgeUrl(club.crest),
    },
    timeZone: OWNER_TIME_ZONE,
    matches,
  };
}

export function getFixtures({
  now = () => new Date(),
  fetchImpl = fetch,
  footballDataKey = null,
}: {
  now?: () => Date;
  fetchImpl?: typeof fetch;
  footballDataKey?: string | null;
} = {}) {
  return tool({
    description:
      "Look up a football club's upcoming fixtures and most recent result. Pass the club name in English or Turkish spelling (for example Galatasaray or Liverpool). Use this before web search for next-match, fixture, kickoff, and latest-score questions. Results are timed in Europe/London. Never describe a match at or before the owner clock as the next match.",
    inputSchema: z.object({
      team: z
        .string()
        .describe("Club name the user asked about, without a match date"),
    }),
    toModelOutput: ({ output }) => {
      if (!output || typeof output !== "object") {
        return { type: "text", value: "fixtures_unavailable" } as const;
      }
      if ("error" in output) {
        return {
          type: "text",
          value: JSON.stringify(output),
        } as const;
      }
      const payload = output as FixturePayload;
      const next = payload.upcoming[0];
      return {
        type: "text",
        value: JSON.stringify({
          team: payload.team.name,
          now: payload.now,
          timeZone: payload.timeZone,
          next: next
            ? {
                home: next.home.name,
                away: next.away.name,
                kickoffUtc: next.kickoffUtc,
                competition: next.competition,
                venue: next.venue,
              }
            : null,
          upcomingCount: payload.upcoming.length,
          last: payload.last
            ? {
                home: payload.last.home.name,
                away: payload.last.away.name,
                homeScore: payload.last.homeScore,
                awayScore: payload.last.awayScore,
                kickoffUtc: payload.last.kickoffUtc,
              }
            : null,
          note: "The fixture card shows crests and the list. Reply with one short sentence and do not repeat the schedule. Do not call the last result the next match.",
        }),
      } as const;
    },
    execute: async ({ team }, { abortSignal }) => {
      const name = cleanTeamName(team);
      const clock = now();
      if (!name) {
        return { error: "team_not_found" as const, team };
      }
      const dataKey =
        footballDataKey && /^[A-Za-z0-9_-]{8,128}$/.test(footballDataKey)
          ? footballDataKey
          : null;
      const key = fold(name);
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) {
        if ("error" in hit.value) {
          return hit.value;
        }
        return { ...hit.value, now: clock.toISOString() };
      }
      const signal = AbortSignal.any([
        AbortSignal.timeout(20_000),
        ...(abortSignal ? [abortSignal] : []),
      ]);
      try {
        let loaded: Loaded = await loadSportsDb(name, fetchImpl, signal);
        if ("error" in loaded && dataKey) {
          loaded = await loadFootballData(name, dataKey, fetchImpl, signal);
        }
        const value = splitMatches(loaded, clock);
        cache.set(key, { expires: Date.now() + CACHE_MS, value });
        if ("error" in value) {
          return value;
        }
        return { ...value, now: clock.toISOString() };
      } catch {
        return { error: "fixtures_unavailable" as const, team: name };
      }
    },
  });
}
