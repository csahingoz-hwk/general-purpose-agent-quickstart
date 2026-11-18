import { premiumModels } from "@/lib/ai/routing/catalog";
import { buildOpenUiPayload } from "./attach";
import { visualPromptTokens } from "./prompt";
import { DEFAULT_VISUAL_MODEL } from "./snapshot";
import { validateOpenUiSpec } from "./validate";

export type VisualEvalRow = {
  prompt: string;
  language: "en" | "tr";
  parse: "valid" | "invalid";
  components: string[];
  inventedNumbers: boolean;
  estimatedPromptTokens: number;
};

const weather = {
  latitude: 41.01,
  longitude: 28.97,
  cityName: "Istanbul",
  current: { temperature_2m: 18 },
  current_units: { temperature_2m: "°C" },
  daily: {
    time: ["2026-11-10", "2026-11-11", "2026-11-12"],
    temperature_2m_max: [19, 17, 16],
    temperature_2m_min: [12, 11, 10],
    precipitation_probability_max: [20, 60, 40],
  },
};

const rates = {
  pair: "USD/TRY",
  unit: "TRY",
  series: [
    { label: "Mon", value: 34.1 },
    { label: "Tue", value: 34.4 },
    { label: "Wed", value: 34.2 },
  ],
  results: [
    {
      title: "USD to TRY",
      url: "https://example.com/usd-try",
      snippet: "Mid-market series for the week.",
    },
  ],
};

const fixture = {
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
      url: "https://example.com/galatasaray",
      snippet: "Next match 15 Nov 2026 20:00 vs Trabzonspor.",
    },
  ],
};

function search(output: unknown) {
  return [{ type: "tool-webSearch", state: "output-available", output }];
}

function forecast() {
  return [
    { type: "tool-getWeather", state: "output-available", output: weather },
  ];
}

export const VISUAL_EVAL_CASES: {
  prompt: string;
  language: "en" | "tr";
  parts: { type: string; state: string; output: unknown }[];
  components: string[];
}[] = [
  {
    prompt: "Galatasaray’ın bir sonraki maçı ne zaman?",
    language: "tr",
    parts: search(fixture),
    components: ["Table"],
  },
  {
    prompt: "When is the next Liverpool fixture?",
    language: "en",
    parts: search(fixture),
    components: ["Table"],
  },
  {
    prompt: "How did USD/TRY move this week?",
    language: "en",
    parts: search(rates),
    components: ["Stat", "Chart", "Slider"],
  },
  {
    prompt: "Euro kuru bu hafta ne oldu?",
    language: "tr",
    parts: search({ ...rates, pair: "EUR/TRY" }),
    components: ["Chart", "Slider"],
  },
  {
    prompt: "İstanbul'da hava nasıl?",
    language: "tr",
    parts: forecast(),
    components: ["Stat", "Chart", "Table", "Map"],
  },
  {
    prompt: "Will it rain in London tomorrow?",
    language: "en",
    parts: forecast(),
    components: ["Table"],
  },
  {
    prompt: "Show gold prices as a chart",
    language: "en",
    parts: search({ ...rates, pair: "Gold" }),
    components: ["Chart"],
  },
  {
    prompt: "Fenerbahçe’nin sonraki maçı",
    language: "tr",
    parts: search(fixture),
    components: ["Table"],
  },
  {
    prompt: "Compare the forecast and the sources",
    language: "en",
    parts: search({
      ...fixture,
      series: rates.series,
      pair: "USD/TRY",
      unit: "TRY",
    }),
    components: ["Chart", "Table"],
  },
  {
    prompt: "Where is this forecast?",
    language: "en",
    parts: forecast(),
    components: ["Map"],
  },
];

function componentsIn(spec: string): string[] {
  const names = ["Chart", "Table", "Stat", "Slider", "Tabs", "Map"];
  return names.filter((name) => spec.includes(`${name}(`));
}

export function evaluateVisualCases(): {
  model: string;
  spentUsd: number;
  rows: VisualEvalRow[];
  lunaEstimateUsd: number;
  terraEstimateUsd: number;
} {
  const rows: VisualEvalRow[] = VISUAL_EVAL_CASES.map((item) => {
    const payload = buildOpenUiPayload(
      item.parts,
      DEFAULT_VISUAL_MODEL,
      "2026-11-10T00:00:00.000Z"
    );
    const verdict = payload
      ? validateOpenUiSpec(payload.spec, payload.data)
      : { ok: false as const, reason: "missing" };
    return {
      prompt: item.prompt,
      language: item.language,
      parse: verdict.ok ? "valid" : "invalid",
      components: payload ? componentsIn(payload.spec) : [],
      inventedNumbers: payload ? /\d/.test(payload.spec) : false,
      estimatedPromptTokens: visualPromptTokens(),
    };
  });
  const outputTokens = rows.length * 180;
  const inputTokens = visualPromptTokens() * rows.length;
  const luna = premiumModels["gpt-6-luna"];
  const terra = premiumModels["gpt-6.1-terra"];
  const lunaEstimateUsd =
    (inputTokens / 1_000_000) * luna.input +
    (outputTokens / 1_000_000) * luna.output;
  const terraEstimateUsd =
    (inputTokens / 1_000_000) * terra.input +
    (outputTokens / 1_000_000) * terra.output;
  return {
    model: DEFAULT_VISUAL_MODEL,
    spentUsd: 0,
    rows,
    lunaEstimateUsd,
    terraEstimateUsd,
  };
}
