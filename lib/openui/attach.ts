import type { ChatMessage } from "@/lib/types";
import {
  buildSearchSnapshot,
  buildWeatherSnapshot,
  DEFAULT_VISUAL_MODEL,
  fallbackTextFor,
  type OpenUiPart,
  type OpenUiPayload,
  payloadFromSnapshot,
  type VisualSnapshot,
} from "./snapshot";
import { validateOpenUiSpec } from "./validate";

function partOutput(part: {
  type: string;
  output?: unknown;
  state?: string;
}): unknown {
  if (part.state && part.state !== "output-available") {
    return undefined;
  }
  return part.output;
}

export function snapshotFromParts(
  parts: readonly { type: string; output?: unknown; state?: string }[]
): {
  title: string;
  summary: string;
  data: VisualSnapshot;
} | null {
  for (const part of parts) {
    if (part.type === "tool-getWeather") {
      const data = buildWeatherSnapshot(partOutput(part));
      if (data) {
        const city =
          data.places.here?.label ?? data.stats.current?.hint ?? "Forecast";
        return { title: city, summary: "Forecast from the weather tool", data };
      }
    }
  }
  for (const part of parts) {
    if (part.type === "tool-webSearch") {
      const data = buildSearchSnapshot(partOutput(part));
      if (!data) {
        continue;
      }
      if (data.series.rates) {
        return {
          title: data.series.rates.title,
          summary: "Series from the search tool",
          data,
        };
      }
      if (data.tables.fixtures) {
        return {
          title: "Fixture",
          summary: "Fixture rows and sources from the search tool",
          data,
        };
      }
      return {
        title: "Sources",
        summary: "Pages returned by the search tool",
        data,
      };
    }
  }
  return null;
}

function fencedSpec(
  parts: readonly { type: string; text?: string }[]
): string | null {
  for (const part of parts) {
    if (part.type !== "text" || !part.text) {
      continue;
    }
    const match = /```openui\s*([\s\S]*?)```/.exec(part.text);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

export function buildOpenUiPayload(
  parts: readonly {
    type: string;
    output?: unknown;
    state?: string;
    text?: string;
  }[],
  sourceModel: string,
  createdAt = new Date().toISOString()
): OpenUiPayload | null {
  const grounded = snapshotFromParts(parts);
  if (!grounded) {
    return null;
  }
  const base = payloadFromSnapshot({
    ...grounded,
    sourceModel,
    createdAt,
  });
  const proposed = fencedSpec(parts);
  if (!proposed) {
    return base;
  }
  const verdict = validateOpenUiSpec(proposed, grounded.data);
  if (!verdict.ok) {
    return {
      ...base,
      specOrigin: "fallback",
      fallbackText: `${base.fallbackText}\n${verdict.reason}`,
    };
  }
  return {
    ...base,
    spec: proposed,
    specOrigin: "model",
    fallbackText: fallbackTextFor(grounded.data),
  };
}

export function visualPayload(
  parts: ChatMessage["parts"],
  sourceModel = DEFAULT_VISUAL_MODEL
): OpenUiPayload | null {
  const stored = parts.find((part) => part.type === "data-openui");
  if (stored?.type === "data-openui") {
    return stored.data;
  }
  return buildOpenUiPayload(parts, sourceModel);
}

export function attachOpenUiPart(
  message: ChatMessage,
  sourceModel: string
): ChatMessage {
  if (message.parts.some((part) => part.type === "data-openui")) {
    return message;
  }
  const payload = buildOpenUiPayload(message.parts, sourceModel);
  if (!payload) {
    return message;
  }
  const part: OpenUiPart = { type: "data-openui", data: payload };
  return { ...message, parts: [...message.parts, part] };
}
