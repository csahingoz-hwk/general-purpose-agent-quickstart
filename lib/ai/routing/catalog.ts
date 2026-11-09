/** Official Standard USD/1M tokens, verified 2026-11-08. See docs/MODEL_ROUTING.md. */
export const premiumModels = {
  "gpt-6-luna": {
    input: 0.1,
    cached: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
    contextWindow: 1_050_000,
    inferenceBudget: 32_768,
    outputLimit: 2048,
  },
  "gpt-6.1-terra": {
    input: 1,
    cached: 0.05,
    cacheWrite: 1.25,
    output: 5,
    contextWindow: 1_050_000,
    inferenceBudget: 65_536,
    outputLimit: 4096,
  },
} as const;
export type PremiumModelId = keyof typeof premiumModels;
export const LUNA: PremiumModelId = "gpt-6-luna";
export const TERRA: PremiumModelId = "gpt-6.1-terra";
export function isPremiumModel(id: string): id is PremiumModelId {
  return Object.hasOwn(premiumModels, id);
}
export function legacyEnabled() {
  return (
    process.env.CHAT_PROVIDER === "groq-legacy" &&
    process.env.ENABLE_LEGACY_GROQ === "true"
  );
}
export function openAIEnabled() {
  return (
    !legacyEnabled() &&
    process.env.OPENAI_API_USAGE_ENABLED === "true" &&
    Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}
/**
 * Opt-in, preview-only AI Gateway lane; Production stays disabled by default.
 *
 * This deliberately checks the explicit opt-in flag ONLY. It must not look for a
 * credential in process.env: on Vercel the OIDC token reaches a deployed
 * function in the `x-vercel-oidc-token` request header, and the AI SDK Gateway
 * provider resolves it (or AI_GATEWAY_API_KEY) itself. Whether authentication
 * actually works is established by the authenticated catalog call in
 * ./gateway.ts, never guessed from environment variables.
 */
export function gatewayEnabled() {
  return !legacyEnabled() && process.env.AI_GATEWAY_USAGE_ENABLED === "true";
}

/** Either explicitly enabled paid lane (Gateway or direct OpenAI). */
export function premiumLaneEnabled() {
  return gatewayEnabled() || openAIEnabled();
}

export function monthlyAllowance() {
  const limit = Number(process.env.AI_MONTHLY_ALLOWANCE_USD ?? "10");
  if (!Number.isFinite(limit) || limit <= 0 || limit > 10) {
    throw new Error("spend_configuration");
  }
  return limit;
}
