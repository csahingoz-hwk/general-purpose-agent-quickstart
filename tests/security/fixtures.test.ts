import assert from "node:assert/strict";
import test from "node:test";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import { systemPrompt } from "../../lib/ai/prompts";
import {
  clearFixtureCache,
  getFixtures,
} from "../../lib/ai/tools/get-fixtures";
import {
  labelKickoff,
  OWNER_TIME_ZONE,
  safeBadgeUrl,
} from "../../lib/fixtures";
import { contextBlock } from "../../lib/temporal";
import type { ChatMessage } from "../../lib/types";

const user = (text: string) =>
  ({
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  }) as ChatMessage;

const run = (input: { team: string }, fetchImpl: typeof fetch, now: Date) => {
  clearFixtureCache();
  const tool = getFixtures({
    now: () => now,
    fetchImpl,
    footballDataKey: null,
  });
  return (
    tool as unknown as {
      execute: (value: { team: string }, ctx: object) => Promise<unknown>;
    }
  ).execute(input, { toolCallId: "t", messages: [] });
};

const event = {
  idEvent: "1",
  strTimestamp: "2026-11-07T16:00:00",
  strLeague: "Turkish Super Lig",
  strVenue: "Rams Park",
  strHomeTeam: "Galatasaray",
  strAwayTeam: "Amed",
  strHomeTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/gs.png",
  strAwayTeamBadge: "https://evil.example/badge.png",
  intHomeScore: "4",
  intAwayScore: "3",
  strSeason: "2026-2027",
  intRound: "12",
  idLeague: "4339",
};

const upcoming = [
  {
    ...event,
    idEvent: "2",
    strTimestamp: "2026-11-21T13:00:00",
    strAwayTeam: "Samsunspor",
    intHomeScore: null,
    intAwayScore: null,
  },
  {
    ...event,
    idEvent: "3",
    strTimestamp: "2026-11-30T17:00:00",
    strHomeTeam: "Beşiktaş",
    strAwayTeam: "Galatasaray",
    strVenue: "Beşiktaş Park",
    intHomeScore: null,
    intAwayScore: null,
  },
  {
    ...event,
    idEvent: "4",
    strTimestamp: "2026-12-04T17:00:00",
    strAwayTeam: "Rizespor",
    intHomeScore: null,
    intAwayScore: null,
  },
];

function payloadFor(url: string) {
  if (url.includes("searchteams.php")) {
    return {
      teams: [
        {
          idTeam: "133804",
          strTeam: "Galatasaray",
          strSport: "Soccer",
          idLeague: "4339",
          strBadge: "https://r2.thesportsdb.com/images/media/team/badge/gs.png",
        },
      ],
    };
  }
  if (url.includes("eventsnext.php")) {
    return { events: [upcoming[0]] };
  }
  if (url.includes("eventslast.php")) {
    return { results: [event] };
  }
  if (url.includes("eventsround.php")) {
    return { events: upcoming };
  }
  return {};
}

test("fixture questions select getFixtures in English and Turkish, with search only on the gateway lane", () => {
  for (const query of [
    "Galatasaray'ın sıradaki maçı",
    "Galatasaray’ın bi dahaki maçı ne zaman?",
    "Next Liverpool match",
    "When is the next Galatasaray fixture?",
    "Beşiktaş maç skoru kaç?",
  ]) {
    const on = selectActiveTools([user(query)], true, true);
    const off = selectActiveTools([user(query)], true, false);
    assert.ok(on.includes("getFixtures"), query);
    assert.ok(off.includes("getFixtures"), query);
    assert.ok(on.includes("webSearch"), query);
    assert.ok(!off.includes("webSearch"), query);
  }
  assert.ok(
    !selectActiveTools(
      [user("Who is the Galatasaray manager in 2026?")],
      true,
      true
    ).includes("getFixtures")
  );
  assert.ok(
    !selectActiveTools(
      [user("What's the weather in London?")],
      true,
      true
    ).includes("getFixtures")
  );
});

test("owner clock is Europe/London on every context block and next events cannot be in the past", () => {
  const block = contextBlock({
    now: new Date("2026-11-10T04:14:00Z"),
    timeZone: null,
    home: null,
  });
  assert.match(block, /Owner clock \(Europe\/London\)/);
  assert.match(block, /sıradaki/);
  assert.match(block, /do not guess a date or kickoff/);
  const prompt = systemPrompt({ supportsTools: true, includeFixtures: true });
  assert.match(prompt, /kickoff in Europe\/London/);
  assert.match(prompt, /one short sentence/);
  assert.equal(OWNER_TIME_ZONE, "Europe/London");
  const label = labelKickoff(
    "2026-11-21T13:00:00Z",
    "2026-11-10T04:14:00Z",
    "tr"
  );
  assert.equal(label?.relative, "Cumartesi · 11 gün sonra");
  assert.equal(label?.clock, "13:00");
});

test("getFixtures keeps only future matches, drops foreign badges, and caches for ten minutes", async () => {
  const urls: string[] = [];
  const fetchImpl = ((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    assert.ok(url.startsWith("https://www.thesportsdb.com/api/v1/json/123/"));
    assert.equal(new URL(url).hostname, "www.thesportsdb.com");
    return Promise.resolve(Response.json(payloadFor(url)));
  }) as typeof fetch;
  const now = new Date("2026-11-10T04:14:00Z");
  const first = await run({ team: "Galatasaray" }, fetchImpl, now);
  assert.ok(first && typeof first === "object" && "upcoming" in first);
  const payload = first as {
    upcoming: {
      away: { name: string; badge: string | null };
      kickoffUtc: string;
    }[];
    last: { away: { name: string; badge: string | null }; homeScore: number };
  };
  assert.equal(payload.upcoming[0]?.away.name, "Samsunspor");
  assert.equal(payload.upcoming.length, 3);
  assert.ok(
    payload.upcoming.every(
      (match) => Date.parse(match.kickoffUtc) > now.getTime()
    )
  );
  assert.equal(payload.last?.away.name, "Amed");
  assert.equal(payload.last?.homeScore, 4);
  assert.equal(payload.last?.away.badge, null);
  assert.equal(payload.upcoming[0]?.away.badge, null);
  const calls = urls.length;
  const tool = getFixtures({
    now: () => now,
    fetchImpl,
    footballDataKey: null,
  });
  await (
    tool as unknown as {
      execute: (value: { team: string }, ctx: object) => Promise<unknown>;
    }
  ).execute({ team: "galatasaray" }, { toolCallId: "t2", messages: [] });
  assert.equal(urls.length, calls);
  assert.equal(safeBadgeUrl("https://evil.example/badge.png"), null);
  assert.equal(
    safeBadgeUrl("http://r2.thesportsdb.com/images/media/team/badge/gs.png"),
    null
  );
});

test("a missing club can use football-data.org only when the key is set", async () => {
  const urls: string[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("thesportsdb.com")) {
      return Promise.resolve(Response.json({ teams: null }));
    }
    assert.equal(new URL(url).hostname, "api.football-data.org");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-Auth-Token"), "test-key");
    if (url.includes("/matches?")) {
      return Promise.resolve(
        Response.json({
          matches: [
            {
              id: 9,
              utcDate: "2026-11-22T16:30:00Z",
              venue: "Anfield",
              competition: { name: "Premier League" },
              homeTeam: {
                name: "Liverpool",
                crest: "https://crests.football-data.org/64.png",
              },
              awayTeam: { name: "Manchester United", crest: null },
              score: { fullTime: { home: null, away: null } },
            },
          ],
        })
      );
    }
    return Promise.resolve(
      Response.json({
        teams: [
          {
            id: 64,
            name: "Liverpool",
            crest: "https://crests.football-data.org/64.png",
          },
        ],
      })
    );
  }) as typeof fetch;
  clearFixtureCache();
  const withoutKey = getFixtures({
    now: () => new Date("2026-11-10T04:14:00Z"),
    fetchImpl,
    footballDataKey: null,
  });
  const missed = await (
    withoutKey as unknown as {
      execute: (value: { team: string }, ctx: object) => Promise<unknown>;
    }
  ).execute({ team: "Liverpool" }, { toolCallId: "t", messages: [] });
  assert.deepEqual(missed, { error: "team_not_found", team: "Liverpool" });
  assert.ok(urls.every((url) => !url.includes("football-data.org")));
  clearFixtureCache();
  urls.length = 0;
  const withKey = getFixtures({
    now: () => new Date("2026-11-10T04:14:00Z"),
    fetchImpl,
    footballDataKey: "test-key",
  });
  const found = await (
    withKey as unknown as {
      execute: (value: { team: string }, ctx: object) => Promise<unknown>;
    }
  ).execute({ team: "Liverpool" }, { toolCallId: "t", messages: [] });
  assert.ok(found && typeof found === "object" && "upcoming" in found);
  const upcomingMatch = (
    found as {
      upcoming: { away: { name: string }; home: { badge: string | null } }[];
    }
  ).upcoming[0];
  assert.equal(upcomingMatch?.away.name, "Manchester United");
  assert.equal(
    upcomingMatch?.home.badge,
    "https://crests.football-data.org/64.png"
  );
});
