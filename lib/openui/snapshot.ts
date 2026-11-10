/**
 * Grounded visual answers. Numbers and labels in a snapshot are copied from a
 * tool result. The OpenUI Lang spec only names those ids.
 */

import { extractFixture, fixtureFromStructured } from "./fixture";

export const OPENUI_SCHEMA_VERSION = 1 as const;
export const OPENUI_FORMAT = "openui-lang" as const;

/** Everyday chat. Live Luna/Terra visual calls were not run in this environment. */
export const DEFAULT_VISUAL_MODEL = "gpt-6-luna";

export type SeriesPoint = { label: string; value: number };

export type VisualSnapshot = {
  series: Record<
    string,
    {
      title: string;
      kind: "line" | "bar" | "pie";
      unit?: string;
      points: SeriesPoint[];
    }
  >;
  tables: Record<string, { columns: string[]; rows: string[][] }>;
  stats: Record<string, { label: string; value: string; hint?: string }>;
  places: Record<
    string,
    { label: string; latitude: number; longitude: number }
  >;
};

export type OpenUiPayload = {
  format: typeof OPENUI_FORMAT;
  schemaVersion: typeof OPENUI_SCHEMA_VERSION;
  sourceModel: string;
  specOrigin: "tool-snapshot" | "model" | "fallback";
  spec: string;
  data: VisualSnapshot;
  createdAt: string;
  fallbackText: string;
};

export type OpenUiPart = {
  type: "data-openui";
  data: OpenUiPayload;
};

const emptySnapshot = (): VisualSnapshot => ({
  series: {},
  tables: {},
  stats: {},
  places: {},
});

function quote(value: string): string {
  const clean = value
    .replace(/["\\\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `"${clean.slice(0, 120)}"`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function plain(value: unknown, max = 160): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function filterSeries(
  points: SeriesPoint[],
  minimum: number
): SeriesPoint[] {
  return points.filter((point) => point.value >= minimum);
}

export function readSeries(value: unknown): SeriesPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const points: SeriesPoint[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const label = plain(record.label, 40);
    const amount = finiteNumber(record.value);
    if (!label || amount === null) {
      continue;
    }
    points.push({ label, value: amount });
    if (points.length === 12) {
      break;
    }
  }
  return points;
}

function httpUrl(value: string): string {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return "";
  }
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch {
    return "";
  }
  return "";
}

function searchHits(record: Record<string, unknown>) {
  if (!Array.isArray(record.results)) {
    return [];
  }
  const hits: { title: string; url: string; snippet: string }[] = [];
  for (const item of record.results) {
    const entry = asRecord(item);
    if (!entry) {
      continue;
    }
    const title = plain(entry.title, 160);
    const snippet = plain(entry.snippet ?? entry.content, 500);
    const url = httpUrl(plain(entry.url, 300));
    if (!title && !snippet) {
      continue;
    }
    hits.push({ title, url, snippet });
    if (hits.length === 5) {
      break;
    }
  }
  return hits;
}

export function buildWeatherSnapshot(output: unknown): VisualSnapshot | null {
  const record = asRecord(output);
  if (!record || "error" in record) {
    return null;
  }
  const current = asRecord(record.current);
  const daily = asRecord(record.daily);
  const temperature = finiteNumber(current?.temperature_2m);
  const times = Array.isArray(daily?.time) ? daily.time : [];
  const highs = Array.isArray(daily?.temperature_2m_max)
    ? daily.temperature_2m_max
    : [];
  const lows = Array.isArray(daily?.temperature_2m_min)
    ? daily.temperature_2m_min
    : [];
  const rain = Array.isArray(daily?.precipitation_probability_max)
    ? daily.precipitation_probability_max
    : [];
  if (temperature === null && times.length === 0) {
    return null;
  }
  const city = plain(record.cityName, 80) || "Forecast";
  const unit = plain(asRecord(record.current_units)?.temperature_2m, 8) || "°C";
  const snapshot = emptySnapshot();
  if (temperature !== null) {
    snapshot.stats.current = {
      label: "Now",
      value: `${temperature}${unit}`,
      hint: city,
    };
  }
  const points: SeriesPoint[] = [];
  const rows: string[][] = [];
  for (let index = 0; index < Math.min(times.length, 3); index += 1) {
    const day = plain(times[index], 20);
    const high = finiteNumber(highs[index]);
    const low = finiteNumber(lows[index]);
    const chance = finiteNumber(rain[index]);
    if (day && high !== null) {
      points.push({ label: day.slice(5), value: high });
    }
    rows.push([
      day,
      high === null ? "" : String(high),
      low === null ? "" : String(low),
      chance === null ? "" : String(chance),
    ]);
  }
  if (points.length > 0) {
    snapshot.series.dailyHigh = {
      title: "Daily high",
      kind: "line",
      unit,
      points,
    };
  }
  if (rows.some((row) => row.some(Boolean))) {
    snapshot.tables.daily = {
      columns: ["Date", "High", "Low", "Rain %"],
      rows,
    };
  }
  const latitude = finiteNumber(record.latitude);
  const longitude = finiteNumber(record.longitude);
  if (latitude !== null && longitude !== null) {
    snapshot.places.here = { label: city, latitude, longitude };
  }
  return snapshot;
}

function firstFixture(
  record: Record<string, unknown>,
  hits: { title: string; url: string; snippet: string }[],
  answer: string
): string[][] | null {
  if (Array.isArray(record.fixtures)) {
    for (const item of record.fixtures) {
      const row = asRecord(item);
      if (!row) {
        continue;
      }
      const structured = fixtureFromStructured({
        team: plain(row.team ?? row.home, 80),
        opponent: plain(row.opponent, 80),
        when: [plain(row.date, 40), plain(row.when, 80)]
          .filter(Boolean)
          .join(" "),
        time: plain(row.time, 20),
        competition: plain(row.competition, 80),
        venue: plain(row.venue, 80),
        source: hits.find((hit) => hit.url)?.url ?? "",
      });
      if (structured) {
        return structured;
      }
    }
  }
  return extractFixture(answer, hits);
}

export function buildSearchSnapshot(
  output: unknown,
  answer = ""
): VisualSnapshot | null {
  const record = asRecord(output);
  if (!record) {
    return null;
  }
  const snapshot = emptySnapshot();
  const hits = searchHits(record);
  const fixtures = firstFixture(record, hits, answer);
  if (fixtures) {
    snapshot.tables.fixtures = {
      columns: ["Field", "Value"],
      rows: fixtures,
    };
  }
  const points = readSeries(record.series);
  if (points.length > 0) {
    const unit = plain(record.unit, 16);
    snapshot.series.rates = {
      title: plain(record.pair, 40) || "Series",
      kind: "line",
      unit,
      points,
    };
    const latest = points.at(-1);
    if (latest) {
      snapshot.stats.latest = {
        label: "Latest",
        value: unit ? `${latest.value} ${unit}` : String(latest.value),
        hint: latest.label,
      };
    }
  }
  if (!fixtures && Object.keys(snapshot.series).length === 0) {
    return null;
  }
  return snapshot;
}

/** A links table is not a visual answer. Weather, series, and fixtures are. */
export function hasStructuredVisual(data: VisualSnapshot): boolean {
  if (
    Object.keys(data.series).length > 0 ||
    Object.keys(data.places).length > 0 ||
    Object.keys(data.stats).length > 0
  ) {
    return true;
  }
  return Object.entries(data.tables).some(
    ([id, table]) => id !== "sources" && table.rows.length > 0
  );
}

export function specForSnapshot(
  title: string,
  summary: string,
  data: VisualSnapshot
): string {
  const lines = [`root = Card(${quote(title)}, ${quote(summary)}, [children])`];
  const children: string[] = [];
  if (data.stats.current) {
    lines.push(`now = Stat(${quote(data.stats.current.label)}, "current")`);
    children.push("now");
  }
  if (data.stats.latest) {
    lines.push(`latest = Stat(${quote(data.stats.latest.label)}, "latest")`);
    children.push("latest");
  }
  if (data.series.dailyHigh) {
    lines.push(`chart = Chart(${quote("Daily high")}, "line", "dailyHigh")`);
    children.push("chart");
  }
  if (data.series.rates) {
    lines.push(
      `chart = Chart(${quote(data.series.rates.title)}, "line", "rates")`
    );
    lines.push(`filter = Slider(${quote("Minimum value")}, "rates")`);
    children.push("filter");
    children.push("chart");
  }
  if (data.tables.fixtures) {
    lines.push(`fixtures = Table(${quote("Fixture")}, "fixtures")`);
    children.push("fixtures");
  }
  if (data.tables.daily) {
    lines.push(`days = Table(${quote("Forecast")}, "daily")`);
    children.push("days");
  }
  if (data.places.here) {
    lines.push(`place = Map(${quote(data.places.here.label)}, "here")`);
    children.push("place");
  }
  lines[0] = `root = Card(${quote(title)}, ${quote(summary)}, [${children.join(", ")}])`;
  return lines.join("\n");
}

export function fallbackTextFor(data: VisualSnapshot): string {
  const bits: string[] = [];
  for (const stat of Object.values(data.stats)) {
    bits.push(`${stat.label}: ${stat.value}`);
  }
  for (const table of Object.values(data.tables)) {
    const preview = table.rows
      .slice(0, 3)
      .map((row) => row.filter(Boolean).join(" · "))
      .join("; ");
    if (preview) {
      bits.push(preview);
    }
  }
  return bits.join("\n") || "The tool result did not include a visual card.";
}

export function payloadFromSnapshot(input: {
  title: string;
  summary: string;
  data: VisualSnapshot;
  sourceModel: string;
  createdAt?: string;
}): OpenUiPayload {
  return {
    format: OPENUI_FORMAT,
    schemaVersion: OPENUI_SCHEMA_VERSION,
    sourceModel: input.sourceModel,
    specOrigin: "tool-snapshot",
    spec: specForSnapshot(input.title, input.summary, input.data),
    data: input.data,
    createdAt: input.createdAt ?? new Date().toISOString(),
    fallbackText: fallbackTextFor(input.data),
  };
}
