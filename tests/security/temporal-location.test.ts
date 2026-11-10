import assert from "node:assert/strict";
import { test } from "node:test";
import { postRequestBodySchema } from "../../app/(chat)/api/chat/schema";
import { selectActiveTools } from "../../lib/ai/context/select-tools";
import { systemPrompt } from "../../lib/ai/prompts";
import { getCurrentTime } from "../../lib/ai/tools/get-current-time";
import { getWeather } from "../../lib/ai/tools/get-weather";
import {
  browserLocation,
  geocodeCity,
  reverseGeocode,
} from "../../lib/location";
import {
  contextBlock,
  describeTime,
  nextOffsetChange,
  validTimeZone,
} from "../../lib/temporal";
import type { ChatMessage } from "../../lib/types";

const at = (iso: string) => new Date(iso);
const user = (text: string) =>
  ({
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  }) as ChatMessage;
const run = async (t: unknown, input: object) =>
  // biome-ignore lint/suspicious/noExplicitAny: invoking the tool's execute directly
  (t as any).execute(input, { toolCallId: "t", messages: [] });

test("London switches GMT to BST at 01:00 UTC on the last Sunday of March and back in October", () => {
  const before = describeTime(at("2026-03-29T00:59:59Z"), "Europe/London");
  assert.equal(before.utcOffset, "+00:00");
  assert.equal(before.isDaylightSaving, false);
  const after = describeTime(at("2026-03-29T01:00:00Z"), "Europe/London");
  assert.equal(after.utcOffset, "+01:00");
  assert.equal(after.isDaylightSaving, true);
  assert.equal(after.local, "2026-03-29T02:00:00+01:00");
  assert.equal(
    describeTime(at("2026-10-25T00:59:59Z"), "Europe/London").isDaylightSaving,
    true
  );
  assert.equal(
    describeTime(at("2026-10-25T01:00:00Z"), "Europe/London").utcOffset,
    "+00:00"
  );
});

test("next offset change is found to the minute; zones without DST report none", () => {
  assert.equal(
    nextOffsetChange(at("2026-11-08T12:00:00Z"), "Europe/London"),
    "2027-03-28T01:00:00.000Z"
  );
  assert.equal(
    nextOffsetChange(at("2026-11-08T12:00:00Z"), "Europe/Istanbul"),
    null
  );
});

test("Istanbul is a fixed +03:00 without DST; Sydney and New York follow their own hemispheres", () => {
  const istanbul = describeTime(at("2026-07-01T12:00:00Z"), "Europe/Istanbul");
  assert.equal(istanbul.utcOffset, "+03:00");
  assert.equal(istanbul.isDaylightSaving, false);
  assert.equal(istanbul.local, "2026-07-01T15:00:00+03:00");
  assert.equal(
    describeTime(at("2026-01-15T00:00:00Z"), "Australia/Sydney")
      .isDaylightSaving,
    true
  );
  assert.equal(
    describeTime(at("2026-07-15T00:00:00Z"), "Australia/Sydney")
      .isDaylightSaving,
    false
  );
  assert.equal(
    describeTime(at("2026-07-01T12:00:00Z"), "America/New_York").utcOffset,
    "-04:00"
  );
});

test("time zone validation accepts IANA names only", () => {
  assert.equal(validTimeZone("Europe/London"), "Europe/London");
  assert.equal(validTimeZone("Not/AZone"), null);
  assert.equal(validTimeZone(undefined), null);
  assert.equal(validTimeZone("x".repeat(80)), null);
});

test("getCurrentTime is deterministic from the injected clock and never guesses a zone", async () => {
  const tool = getCurrentTime({
    defaultTimeZone: "Europe/London",
    now: () => at("2026-03-29T01:30:00Z"),
  });
  const local = await run(tool, {});
  assert.equal(local.timeZone, "Europe/London");
  assert.equal(local.local, "2026-03-29T02:30:00+01:00");
  const other = await run(tool, { timeZone: "Europe/Istanbul" });
  assert.equal(other.local, "2026-03-29T04:30:00+03:00");
  assert.deepEqual(await run(tool, { timeZone: "Mars/Olympus" }), {
    error: "invalid_timezone",
  });
  const unknown = await run(
    getCurrentTime({
      defaultTimeZone: null,
      now: () => at("2026-03-29T01:30:00Z"),
    }),
    {}
  );
  assert.equal(unknown.error, "timezone_unknown");
});

test("every request context states server time, browser zone and unknown location honestly", () => {
  const now = at("2026-11-08T21:15:00Z");
  const known = contextBlock({ now, timeZone: "Europe/Istanbul", home: null });
  assert.match(known, /2026-11-08T21:15:00\.000Z/);
  assert.match(
    known,
    /Europe\/Istanbul; local time 2026-11-09T00:15:00\+03:00/
  );
  assert.match(known, /Saved home location: none/);
  assert.match(known, /never guess it/);
  const noZone = contextBlock({ now, timeZone: null, home: null });
  assert.match(noZone, /time zone: unknown/);
  const withHome = contextBlock({
    now,
    timeZone: "Europe/London",
    home: {
      label: "Chessington",
      latitude: 51.36,
      longitude: -0.3,
      source: "city",
    },
  });
  assert.match(withHome, /Saved home location: Chessington/);
  assert.doesNotMatch(`${known}${noZone}${withHome}`, /San Francisco/);
});

test("the system prompt carries the rules and the context in both languages of use", () => {
  const prompt = systemPrompt({
    supportsTools: true,
    context: contextBlock({
      now: at("2026-11-08T21:15:00Z"),
      timeZone: "Europe/London",
      home: null,
    }),
  });
  assert.match(prompt, /never default to a city such as San Francisco/);
  assert.match(prompt, /ask which city, in the user's language/);
  assert.match(prompt, /Current context \(authoritative/);
});

test("English and Turkish clock questions select getCurrentTime; ordinary chat does not", () => {
  for (const q of [
    "What time is it in Istanbul?",
    "What's the date today?",
    "Do the clocks change soon?",
    "Saat kaç?",
    "Londra'da saat kaç şimdi?",
    "Yaz saati ne zaman başlıyor?",
    "Bugün günlerden ne?",
  ]) {
    assert.ok(selectActiveTools([user(q)], true).includes("getCurrentTime"), q);
  }
  assert.deepEqual(selectActiveTools([user("Merhaba!")], true), []);
  assert.deepEqual(selectActiveTools([user("Tell me a joke")], true), []);
});

test("stating a home city selects setHomeLocation in English and Turkish", () => {
  assert.ok(
    selectActiveTools([user("I live in Chessington")], true).includes(
      "setHomeLocation"
    )
  );
  assert.ok(
    selectActiveTools([user("Ben Ankara'da yaşıyorum")], true).includes(
      "setHomeLocation"
    )
  );
  assert.equal(
    selectActiveTools([user("I live in Chessington")], false).includes(
      "setHomeLocation"
    ),
    false
  );
});

test("weather with no stated place and no home never fetches and asks for a location", async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("no network without a location");
  }) as typeof fetch;
  try {
    const tool = getWeather({ home: null });
    assert.match(
      String((tool as { description?: string }).description),
      /never guess/
    );
    assert.doesNotMatch(JSON.stringify(tool), /San Francisco/);
    for (const input of [{}, { latitude: 51 }, { city: undefined }]) {
      assert.deepEqual(await run(tool, input), { error: "location_required" });
    }
  } finally {
    globalThis.fetch = prior;
  }
});

test("weather uses the saved home location only when no place is given", async () => {
  const urls: string[] = [];
  const prior = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    urls.push(String(input));
    return Promise.resolve(
      Response.json({ current: { temperature_2m: 9 }, hourly: {}, daily: {} })
    );
  }) as typeof fetch;
  try {
    const home = {
      label: "Chessington",
      latitude: 51.36,
      longitude: -0.3,
      source: "city" as const,
    };
    const result = await run(getWeather({ home }), {});
    assert.equal(result.cityName, "Chessington");
    assert.match(urls[0], /latitude=51\.36&longitude=-0\.3/);
    const explicit = await run(getWeather({ home }), {
      latitude: 41,
      longitude: 29,
    });
    assert.match(urls[1], /latitude=41&longitude=29/);
    assert.equal(explicit.cityName, undefined);
  } finally {
    globalThis.fetch = prior;
  }
});

test("weather asks Open-Meteo for a 3-day forecast and tells the model tomorrow's chance of rain", async () => {
  const urls: string[] = [];
  const prior = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
      return Promise.resolve(
        Response.json({ results: [{ latitude: 39.9, longitude: 32.9 }] })
      );
    }
    return Promise.resolve(
      Response.json({
        current: { time: "2026-11-10T12:00", temperature_2m: 9 },
        current_units: { temperature_2m: "°C" },
        hourly: { time: ["2026-11-10T12:00"], temperature_2m: [9] },
        daily_units: {
          precipitation_probability_max: "%",
          precipitation_sum: "mm",
        },
        daily: {
          time: ["2026-11-10", "2026-11-11", "2026-11-12"],
          sunrise: ["2026-11-10T06:50"],
          sunset: ["2026-11-10T16:40"],
          temperature_2m_max: [11, 8, 10],
          temperature_2m_min: [3, 2, 4],
          precipitation_probability_max: [10, 80, 35],
          precipitation_sum: [0, 6.4, 1.1],
          weather_code: [1, 63, 3],
        },
      })
    );
  }) as typeof fetch;
  try {
    const tool = getWeather({ home: null });
    const output = await run(tool, { city: "Ankara" });
    const forecastUrl = urls.find((u) =>
      u.startsWith("https://api.open-meteo.com/")
    );
    assert.ok(forecastUrl);
    assert.match(forecastUrl, /forecast_days=3/);
    for (const field of [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
      "weather_code",
      "sunrise",
      "sunset",
    ]) {
      assert.match(forecastUrl, new RegExp(`daily=[^&]*${field}`), field);
    }
    assert.match(
      String((tool as { description?: string }).description),
      /3-day forecast.*chance of rain/
    );
    const modelOutput = (
      tool as unknown as {
        toModelOutput: (o: { output: unknown }) => { value: string };
      }
    ).toModelOutput({ output });
    const compact = JSON.parse(modelOutput.value);
    assert.equal(compact.city, "Ankara");
    assert.equal(compact.daily.length, 3);
    assert.deepEqual(compact.daily[1], {
      date: "2026-11-11",
      min: 2,
      max: 8,
      rainChance: 80,
      rainSum: 6.4,
    });
    assert.equal(compact.dailyUnits.rainChance, "%");
    assert.equal(compact.dailyUnits.rainSum, "mm");
    // Compact: no hourly arrays are replayed to the model.
    assert.doesNotMatch(modelOutput.value, /hourly/);
  } finally {
    globalThis.fetch = prior;
  }
});

test("browser coordinates are validated and rounded; geocoding failure saves nothing", async () => {
  assert.deepEqual(browserLocation(51.3612, -0.3049, "Europe/London"), {
    label: "Current location",
    latitude: 51.36,
    longitude: -0.3,
    timeZone: "Europe/London",
    source: "browser",
  });
  assert.equal(browserLocation(91, 0, null), null);
  assert.equal(browserLocation("51", 0, null), null);
  assert.equal(
    await geocodeCity("Nowhere", () =>
      Promise.resolve(Response.json({ results: [] }))
    ),
    null
  );
  const found = await geocodeCity("İstanbul", () =>
    Promise.resolve(
      Response.json({
        results: [
          {
            name: "İstanbul",
            latitude: 41.01,
            longitude: 28.95,
            country: "Türkiye",
            timezone: "Europe/Istanbul",
          },
        ],
      })
    )
  );
  assert.equal(found?.timeZone, "Europe/Istanbul");
});

test("the chat request accepts an optional browser time zone", () => {
  const base = {
    id: crypto.randomUUID(),
    message: {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "Saat kaç?" }],
    },
    selectedChatModel: "gpt-6-luna",
    selectedVisibilityType: "private",
  };
  assert.equal(
    postRequestBodySchema.parse({ ...base, timeZone: "Europe/London" })
      .timeZone,
    "Europe/London"
  );
  assert.equal(postRequestBodySchema.parse(base).timeZone, undefined);
});

test("weather stays available through short follow-ups after saving a location", () => {
  assert.ok(
    selectActiveTools(
      [
        user("What's the weather today?"),
        user("Use my current location"),
        user("Now saved in the system"),
        user("Try again"),
      ],
      true
    ).includes("getWeather")
  );
  assert.ok(
    selectActiveTools(
      [user("Hava nasıl?"), user("Konumu kaydettim"), user("Tekrar dene")],
      true
    ).includes("getWeather")
  );
  assert.deepEqual(
    selectActiveTools(
      [user("What's the weather today?"), user("Thanks"), user("Merhaba!")],
      true
    ),
    []
  );
});

test("browser coordinates are named by place, with a neutral fallback", async () => {
  const named = await reverseGeocode(51.36, -0.3, () =>
    Promise.resolve(
      Response.json({
        locality: "Chessington",
        city: "Kingston upon Thames",
        countryName: "United Kingdom",
      })
    )
  );
  assert.deepEqual(named, { label: "Chessington", country: "United Kingdom" });
  assert.equal(
    await reverseGeocode(51.36, -0.3, () =>
      Promise.resolve(new Response("x", { status: 500 }))
    ),
    null
  );
  assert.equal(
    await reverseGeocode(51.36, -0.3, () =>
      Promise.resolve(Response.json({ locality: "", city: "" }))
    ),
    null
  );
});
