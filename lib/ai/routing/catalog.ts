import { isCopilotFallbackConfigured } from "../copilot-vm-model";
import { isVertexWifConfigured } from "../vertex-auth";

/**
 * Model pricing & budget catalog.
 * - `gemini-4-hydrogen` and `gemini-4-argon` execute directly on Google Cloud
 *   Vertex AI (`project-cd0bc64c-0025-446c-b41`, billing `0140A2-72DEB2-62EDCD`
 *   covered by the $40/mo Google AI Ultra credit), so they consume $0 of the
 *   Vercel AI Gateway / OpenAI cash allowance (`input/output = 0` in the
 *   Gateway spend cap ledger).
 * - `claude-haiku-5.5` executes ONLY as fallback on Vertex failure/timeout via
 *   the GitHub Copilot SDK on the Cloud VM bridge (covered by GitHub Copilot
 *   subscription, $0 pay-per-use cash spend).
 * - `gpt-6.1-terra` and `gpt-6-luna` remain in the catalog for legacy cost/test
 *   verification only; never active in default or fallback routes.
 */
export const premiumModels = {
  "gemini-4-hydrogen": {
    input: 0,
    cached: 0,
    cacheWrite: 0,
    output: 0,
    contextWindow: 1_000_000,
    inferenceBudget: 65_536,
    outputLimit: 8192,
  },
  "gemini-4-argon": {
    input: 0,
    cached: 0,
    cacheWrite: 0,
    output: 0,
    contextWindow: 1_000_000,
    inferenceBudget: 65_536,
    outputLimit: 8192,
  },
  "claude-haiku-5.5": {
    input: 0,
    cached: 0,
    cacheWrite: 0,
    output: 0,
    contextWindow: 200_000,
    inferenceBudget: 65_536,
    outputLimit: 8192,
  },
  "gpt-6.1-terra": {
    input: 1,
    cached: 0.05,
    cacheWrite: 1.25,
    output: 5,
    contextWindow: 1_050_000,
    inferenceBudget: 65_536,
    outputLimit: 8192,
  },
  "gpt-6-luna": {
    input: 0.1,
    cached: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
    contextWindow: 1_050_000,
    inferenceBudget: 32_768,
    outputLimit: 4096,
  },
} as const;

export type PremiumModelId = keyof typeof premiumModels;
export type VertexModelId = "gemini-4-hydrogen" | "gemini-4-argon";

/**
 * AI Gateway DeepSeek Search: USD 0.75 per 1,000 billable requests when routed
 * through AI Gateway (`gpt-6.1-terra`). Vertex AI models use native Vertex
 * Google Search grounding billed to `0140A2-72DEB2-62EDCD` Ultra credit.
 */
export const WEB_SEARCH_COST_USD = 0.000_75;
export const WEB_SEARCH_MAX_CALLS = 8;
export const WEB_SEARCH_TOOL_ID = "gateway.deepseek_search";

export const HYDROGEN = "gemini-4-hydrogen" as const;
export const ARGON = "gemini-4-argon" as const;
export const COPILOT_HAIKU = "claude-haiku-5.5" as const;
export const TERRA = "gpt-6.1-terra" as const;
export const LUNA = "gpt-6-luna" as const;

export function isPremiumModel(id: string): id is PremiumModelId {
  return Object.hasOwn(premiumModels, id);
}
export function isVertexModel(id: string): id is VertexModelId {
  return id === HYDROGEN || id === ARGON;
}
export function isCopilotFallbackModel(id: string): id is typeof COPILOT_HAIKU {
  return id === COPILOT_HAIKU;
}
export function isOpenAIPremiumModel(
  id: string
): id is "gpt-6.1-terra" | "gpt-6-luna" {
  return id === TERRA || id === LUNA;
}
export function isFloorCompliantModel(id: string): boolean {
  return (
    id === HYDROGEN || id === ARGON || id === COPILOT_HAIKU || id === TERRA
  );
}
/**
 * True ONLY inside the hermetic CI wire-fixture harness (`scripts/test-sdk7-integration.sh`
 * + `tests/sdk7/provider-fixture.ts`), which intercepts `fetch` in-process and rejects
 * any real credential. Never true in production, preview, or with real API keys.
 */
export function isSyntheticSdk7FixtureMode(): boolean {
  return process.env.GROQ_API_KEY === "synthetic-sdk7-provider-key";
}

export function legacyEnabled() {
  return (
    process.env.CHAT_PROVIDER === "groq-legacy" &&
    process.env.ENABLE_LEGACY_GROQ === "true"
  );
}
export function vertexEnabled() {
  return !legacyEnabled() && isVertexWifConfigured();
}
export function copilotFallbackEnabled() {
  return !legacyEnabled() && isCopilotFallbackConfigured();
}
export function openAIEnabled() {
  return (
    !legacyEnabled() &&
    process.env.OPENAI_API_USAGE_ENABLED === "true" &&
    Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}
export function gatewayEnabled() {
  return !legacyEnabled() && process.env.AI_GATEWAY_USAGE_ENABLED === "true";
}

/**
 * Web search is available on Vertex AI Gemini 4 models (via Vertex Google Search
 * grounding on Ultra credit) and on Gateway-served premium models (`gpt-6.1-terra`).
 */
export function webSearchLane(modelId: string) {
  if (legacyEnabled()) {
    return false;
  }
  if (isVertexModel(modelId) && vertexEnabled()) {
    return true;
  }
  return gatewayEnabled() && isPremiumModel(modelId);
}

/** Any enabled primary/fallback lane (Vertex WIF, Gateway, or direct OpenAI). */
export function premiumLaneEnabled() {
  return vertexEnabled() || gatewayEnabled() || openAIEnabled();
}

export function monthlyAllowance() {
  const limit = Number(process.env.AI_MONTHLY_ALLOWANCE_USD ?? "10");
  if (!Number.isFinite(limit) || limit <= 0 || limit > 10) {
    throw new Error("spend_configuration");
  }
  return limit;
}
