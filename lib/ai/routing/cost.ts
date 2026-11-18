import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import { type PremiumModelId, premiumModels } from "./catalog";

export function usageCost(model: PremiumModelId, usage: LanguageModelV4Usage) {
  const p = premiumModels[model];
  const input = usage.inputTokens.total;
  const output = usage.outputTokens.total;
  const cached = usage.inputTokens.cacheRead ?? 0;
  const written = usage.inputTokens.cacheWrite;
  if (
    input === undefined ||
    output === undefined ||
    [input, output, cached, written ?? 0].some(
      (n) => !Number.isFinite(n) || n < 0
    ) ||
    cached + (written ?? 0) > input
  ) {
    return null;
  }
  // If cache-write details are absent, conservatively price all noncached tokens
  // as 30m writes. We never request 12h caching or premium processing tiers.
  const reasoning = usage.outputTokens.reasoning;
  if (
    reasoning !== undefined &&
    (!Number.isFinite(reasoning) || reasoning < 0 || reasoning > output)
  ) {
    return null;
  }
  const writeTokens = written ?? input - cached;
  const usd =
    ((input - cached - writeTokens) * p.input +
      cached * p.cached +
      writeTokens * p.cacheWrite +
      output * p.output) /
    1_000_000;
  return {
    input,
    cached,
    cacheWrite: written ?? null,
    output,
    reasoning: usage.outputTokens.reasoning ?? null,
    usd,
    exactBreakdown: written !== undefined,
  };
}

/** Conservative reservation, never represented as measured usage. Text-only lane. */
export function inputTokenBound(params: unknown) {
  return Buffer.byteLength(JSON.stringify(params), "utf8") + 4096;
}
export function reserveCost(
  model: PremiumModelId,
  params: unknown,
  outputTokens: number
) {
  const inputBound = inputTokenBound(params);
  const p = premiumModels[model];
  return (inputBound * p.cacheWrite + outputTokens * p.output) / 1_000_000;
}
