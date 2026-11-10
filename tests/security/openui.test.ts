import assert from "node:assert/strict";
import test from "node:test";
import { systemPrompt } from "../../lib/ai/prompts";
import { attachOpenUiPart, buildOpenUiPayload } from "../../lib/openui/attach";
import { evaluateVisualCases, VISUAL_EVAL_CASES } from "../../lib/openui/eval";
import { visualPrompt } from "../../lib/openui/prompt";
import { filterSeries } from "../../lib/openui/snapshot";
import { validateOpenUiSpec } from "../../lib/openui/validate";
import type { ChatMessage } from "../../lib/types";

const weather = {
  latitude: 41.01,
  longitude: 28.97,
  cityName: "Istanbul",
  current: { temperature_2m: 18 },
  current_units: { temperature_2m: "°C" },
  daily: {
    time: ["2026-11-10", "2026-11-11"],
    temperature_2m_max: [19, 17],
    temperature_2m_min: [12, 11],
    precipitation_probability_max: [20, 80],
  },
};

test("weather and search cards copy tool numbers and never invent them", () => {
  const forecast = buildOpenUiPayload(
    [{ type: "tool-getWeather", state: "output-available", output: weather }],
    "gpt-6-luna",
    "2026-11-10T00:00:00.000Z"
  );
  assert.ok(forecast);
  assert.equal(forecast.specOrigin, "tool-snapshot");
  assert.equal(forecast.data.stats.current?.value, "18°C");
  assert.equal(forecast.data.series.dailyHigh?.points[0]?.value, 19);
  assert.equal(validateOpenUiSpec(forecast.spec, forecast.data).ok, true);
  assert.equal(/\d/.test(forecast.spec), false);

  const search = buildOpenUiPayload(
    [
      {
        type: "tool-webSearch",
        state: "output-available",
        output: {
          pair: "USD/TRY",
          unit: "TRY",
          series: [
            { label: "Mon", value: 34.1 },
            { label: "Tue", value: 34.4 },
          ],
          results: [
            {
              title: "USD to TRY",
              url: "https://example.com/usd-try",
              snippet: "Week series.",
            },
          ],
        },
      },
    ],
    "gpt-6-luna",
    "2026-11-10T00:00:00.000Z"
  );
  assert.ok(search);
  assert.equal(search.data.series.rates?.points[1]?.value, 34.4);
  assert.match(search.spec, /Slider\(/);
  assert.match(search.spec, /Chart\(/);
  assert.equal(search.data.tables.sources, undefined);
  assert.doesNotMatch(search.spec, /Sources/);
  assert.equal(/\d/.test(search.spec), false);
});

test("a search result that is only titles and snippets draws no card", () => {
  const payload = buildOpenUiPayload(
    [
      {
        type: "text",
        text: "I looked that up.",
      },
      {
        type: "tool-webSearch",
        state: "output-available",
        output: {
          results: [
            {
              title: "Galatasaray news",
              url: "https://example.com/galatasaray-news",
              snippet: "Squad list and recent headlines.",
            },
          ],
        },
      },
    ],
    "gpt-6-luna",
    "2026-11-10T00:00:00.000Z"
  );
  assert.equal(payload, null);
});

test("a fixture card is copied only when the answer and a snippet agree", () => {
  const results = [
    {
      title: "Galatasaray fixture",
      url: "https://www.mackolik.com/galatasaray",
      snippet:
        "Galatasaray - Trabzonspor | 22 Kasım 2026 20:00 | Süper Lig | RAMS Park",
    },
  ];
  const agreed = buildOpenUiPayload(
    [
      {
        type: "text",
        text: "Galatasaray'ın sonraki maçı 22 Kasım 2026 Pazar günü saat 20.00'de Trabzonspor ile RAMS Park'ta Süper Lig'de.",
      },
      {
        type: "tool-webSearch",
        state: "output-available",
        output: { results },
      },
    ],
    "gpt-6-luna",
    "2026-11-10T00:00:00.000Z"
  );
  assert.ok(agreed);
  const rows = agreed.data.tables.fixtures?.rows ?? [];
  const value = (label: string) => rows.find((row) => row[0] === label)?.[1];
  assert.equal(value("Match"), "Galatasaray vs Trabzonspor");
  assert.match(value("Date") ?? "", /22 Kasım 2026/);
  assert.equal(value("Time"), "20:00");
  assert.equal(value("Competition"), "Süper Lig");
  assert.equal(value("Venue"), "RAMS Park");
  assert.equal(value("Source"), "https://www.mackolik.com/galatasaray");
  assert.equal(agreed.data.tables.sources, undefined);
  assert.doesNotMatch(agreed.spec, /Sources/);
  assert.equal(/\d/.test(agreed.spec), false);

  const inventedTime = buildOpenUiPayload(
    [
      {
        type: "text",
        text: "Galatasaray vs Trabzonspor on 22 November 2026 at 21:30.",
      },
      {
        type: "tool-webSearch",
        state: "output-available",
        output: {
          results: [
            {
              title: "Fixture",
              url: "https://example.com/fixture",
              snippet: "Galatasaray vs Trabzonspor on 22 November 2026.",
            },
          ],
        },
      },
    ],
    "gpt-6-luna",
    "2026-11-10T00:00:00.000Z"
  );
  assert.equal(
    inventedTime?.data.tables.fixtures?.rows.find(
      (row) => row[0] === "Time"
    )?.[1],
    "TBC"
  );
  assert.equal(
    inventedTime?.data.tables.fixtures?.rows.find(
      (row) => row[0] === "Venue"
    )?.[1],
    "TBC"
  );

  const uncited = buildOpenUiPayload(
    [
      {
        type: "text",
        text: "Galatasaray vs Fenerbahçe on 22 November 2026.",
      },
      {
        type: "tool-webSearch",
        state: "output-available",
        output: { results },
      },
    ],
    "gpt-6-luna",
    "2026-11-10T00:00:00.000Z"
  );
  assert.equal(uncited, null);
});

test("a bad model spec falls back to readable tool text", () => {
  const payload = buildOpenUiPayload(
    [
      {
        type: "text",
        text: '```openui\nroot = HtmlView("<b>no</b>")\n```',
      },
      {
        type: "tool-getWeather",
        state: "output-available",
        output: weather,
      },
    ],
    "gpt-6-luna",
    "2026-11-10T00:00:00.000Z"
  );
  assert.ok(payload);
  assert.equal(payload.specOrigin, "fallback");
  assert.match(payload.fallbackText, /18°C/);
  assert.equal(validateOpenUiSpec(payload.spec, payload.data).ok, true);
});

test("slider filtering is local and does not change the snapshot", () => {
  const points = [
    { label: "Mon", value: 34.1 },
    { label: "Tue", value: 34.4 },
  ];
  const filtered = filterSeries(points, 34.2);
  assert.deepEqual(filtered, [{ label: "Tue", value: 34.4 }]);
  assert.equal(points.length, 2);
});

test("visual instructions stay compact and are omitted from ordinary turns", () => {
  assert.ok(visualPrompt.length < 900);
  for (const name of ["Chart", "Table", "Stat", "Slider", "Tabs", "Map"]) {
    assert.match(visualPrompt, new RegExp(name));
  }
  assert.doesNotMatch(visualPrompt, /HtmlView/);
  const plain = systemPrompt({ supportsTools: true });
  assert.doesNotMatch(plain, /Visual card/);
  const visual = systemPrompt({
    supportsTools: true,
    includeVisual: true,
    includeWebSearch: true,
  });
  assert.match(visual, /Visual card/);
});

test("the saved message part is versioned openui-lang and is not duplicated", () => {
  const message = {
    id: "55555555-5555-4555-8555-555555555555",
    role: "assistant",
    parts: [
      {
        type: "tool-webSearch",
        state: "output-available",
        output: {
          fixtures: [
            {
              when: "15 Nov 2026 20:00",
              competition: "Super Lig",
              opponent: "Trabzonspor",
            },
          ],
          results: [
            {
              title: "Galatasaray fixture",
              url: "https://example.com/gs",
              snippet: "Next match 15 Nov 2026 20:00.",
            },
          ],
        },
      },
    ],
  } as unknown as ChatMessage;
  const saved = attachOpenUiPart(message, "gpt-6-luna");
  const part = saved.parts.find((item) => item.type === "data-openui");
  assert.ok(part && part.type === "data-openui");
  assert.equal(part.data.format, "openui-lang");
  assert.equal(part.data.schemaVersion, 1);
  assert.equal(part.data.sourceModel, "gpt-6-luna");
  const fixtureRows = part.data.data.tables.fixtures?.rows ?? [];
  assert.equal(
    fixtureRows.find((row) => row[0] === "Match")?.[1],
    "TBC vs Trabzonspor"
  );
  assert.equal(fixtureRows.find((row) => row[0] === "Time")?.[1], "20:00");
  assert.equal(fixtureRows.find((row) => row[0] === "Venue")?.[1], "TBC");
  assert.equal(part.data.data.tables.sources, undefined);
  assert.equal(
    attachOpenUiPart(saved, "gpt-6-luna").parts.length,
    saved.parts.length
  );
});

test("ten grounded EN/TR visuals parse and the live model spend is zero", () => {
  const report = evaluateVisualCases();
  assert.equal(report.spentUsd, 0);
  assert.equal(report.model, "gpt-6-luna");
  assert.equal(report.rows.length, 10);
  for (const [index, row] of report.rows.entries()) {
    const expected = VISUAL_EVAL_CASES[index];
    assert.equal(row.parse, "valid", row.prompt);
    assert.equal(row.inventedNumbers, false, row.prompt);
    for (const name of expected?.components ?? []) {
      assert.ok(row.components.includes(name), `${row.prompt} missing ${name}`);
    }
  }
  assert.ok(report.terraEstimateUsd > report.lunaEstimateUsd);
});
