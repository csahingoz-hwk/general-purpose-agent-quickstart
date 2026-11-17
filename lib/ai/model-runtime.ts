import "server-only";
import { GROQ_BASE_URL, parseVerification } from "./groq-verification";
import { chatModels, DEFAULT_CHAT_MODEL } from "./models";
import {
  ARGON,
  gatewayEnabled,
  HYDROGEN,
  isOpenAIPremiumModel,
  legacyEnabled,
  openAIEnabled,
  TERRA,
  vertexEnabled,
} from "./routing/catalog";
import { discoverGatewayReadiness, type Readiness } from "./routing/gateway";
import { getVertexWifAccessToken } from "./vertex-auth";

let premiumCache:
  | { key: string; expires: number; result: Readiness }
  | undefined;

/**
 * Primary lane: Google Vertex AI via keyless Vercel OIDC -> WIF (`vercel-pool`
 * on `project-cd0bc64c-0025-446c-b41`, billing `0140A2-72DEB2-62EDCD` Ultra credit)
 * serving `gemini-4-hydrogen` (default) and `gemini-4-argon` (research escalation).
 * Fallback lane: `gpt-6.1-terra` via Vercel AI Gateway (or direct OpenAI API).
 */
async function premiumAvailability(): Promise<Readiness> {
  const useVertex = vertexEnabled();
  const useGateway = gatewayEnabled();
  const cacheTag = `${useVertex ? "vertex" : "no-vertex"}:${useGateway ? "gw" : "no-gw"}`;

  if (useVertex || useGateway) {
    const cached = premiumCache;
    if (cached?.key === cacheTag && cached.expires > Date.now()) {
      return cached.result;
    }

    const [vertexTokenOk, gatewayResult] = await Promise.all([
      useVertex
        ? getVertexWifAccessToken()
            .then(() => true)
            .catch(() => false)
        : Promise.resolve(false),
      useGateway ? discoverGatewayReadiness() : Promise.resolve(null),
    ]);

    if (vertexTokenOk) {
      const vertexModels = chatModels.filter(
        (m) => m.id === HYDROGEN || m.id === ARGON
      );
      const terraModels =
        gatewayResult?.status === "ready" ? gatewayResult.models : [];
      const combined = [...vertexModels, ...terraModels];
      const result: Readiness = {
        status: "ready",
        reason: "ready",
        hint: null,
        models: combined,
        defaultModelId: HYDROGEN,
        checkedAt: new Date().toISOString(),
        unavailableModels: gatewayResult?.unavailableModels ?? [],
      };
      premiumCache = { key: cacheTag, expires: Date.now() + 300_000, result };
      return result;
    }

    // Fallback order when Vertex WIF is unavailable: Terra via Gateway.
    if (gatewayResult) {
      if (gatewayResult.status === "ready") {
        premiumCache = {
          key: cacheTag,
          expires: Date.now() + 60_000,
          result: gatewayResult,
        };
      }
      return gatewayResult;
    }

    return {
      status: "setup_required",
      reason: "gateway_auth_missing",
      hint: "Vertex AI Workload Identity Federation is configured, but no Vercel OIDC token reached the function.",
      models: [],
      defaultModelId: null,
      checkedAt: null,
      unavailableModels: [],
    };
  }

  const empty: Readiness = {
    status: "setup_required",
    reason: "provider_opt_in_missing",
    hint: "No model lane is enabled for this deployment. Set GOOGLE_VERTEX_PROJECT_ID + GOOGLE_VERTEX_WORKLOAD_AUDIENCE (or AI_GATEWAY_USAGE_ENABLED=true) and redeploy.",
    models: [],
    defaultModelId: null,
    checkedAt: null,
    unavailableModels: [],
  };
  if (!openAIEnabled()) {
    return empty;
  }
  const key = process.env.OPENAI_API_KEY?.trim() ?? "";
  const cacheKey = `openai:${key}`;
  if (premiumCache?.key === cacheKey && premiumCache.expires > Date.now()) {
    return premiumCache.result;
  }
  const unavailable = (
    reason: "catalog_unavailable" | "model_unavailable"
  ) => ({
    ...empty,
    status: "temporarily_unavailable" as const,
    reason,
    hint:
      reason === "model_unavailable"
        ? "GPT-6.1 Terra is not listed for this OpenAI account."
        : "The OpenAI model catalog could not be reached. Try again shortly.",
  });
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return unavailable("catalog_unavailable");
    }
    const body = await response.json();
    const listed = new Set(
      (body.data ?? []).map((model: { id: string }) => model.id)
    );
    const models = chatModels.filter(
      (model) =>
        isOpenAIPremiumModel(model.id) &&
        model.id === TERRA &&
        listed.has(model.id)
    );
    if (!models.some((model) => model.id === TERRA)) {
      return unavailable("model_unavailable");
    }
    const result: Readiness = {
      status: "ready",
      reason: "ready",
      hint: null,
      models,
      defaultModelId: TERRA,
      checkedAt: new Date().toISOString(),
      unavailableModels: [],
    };
    premiumCache = { key: cacheKey, expires: Date.now() + 60_000, result };
    return result;
  } catch {
    return unavailable("catalog_unavailable");
  }
}

export async function getModelAvailability() {
  if (!legacyEnabled()) {
    return premiumAvailability();
  }
  const verified = parseVerification(process.env.VERIFIED_GROQ_MODELS);
  const empty = {
    status: "setup_required" as const,
    models: [],
    defaultModelId: null,
    checkedAt: verified.checkedAt,
  };
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey || verified.status !== "ready") {
    return empty;
  }
  try {
    const response = await fetch(`${GROQ_BASE_URL}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return { ...empty, status: "temporarily_unavailable" as const };
    }
    const data = await response.json();
    const listed = new Set(
      (data.data ?? []).map((model: { id: string }) => model.id)
    );
    const models = chatModels.filter(
      (model) => verified.modelIds.includes(model.id) && listed.has(model.id)
    );
    return {
      status: models.length
        ? ("ready" as const)
        : ("temporarily_unavailable" as const),
      models,
      defaultModelId:
        models.find((model) => model.id === DEFAULT_CHAT_MODEL)?.id ??
        models[0]?.id ??
        null,
      checkedAt: verified.checkedAt,
    };
  } catch {
    return { ...empty, status: "temporarily_unavailable" as const };
  }
}

export function getRequestModelAvailability() {
  if (!legacyEnabled()) {
    return getModelAvailability();
  }
  const verified = parseVerification(process.env.VERIFIED_GROQ_MODELS);
  return Promise.resolve({
    status:
      process.env.GROQ_API_KEY && verified.status === "ready"
        ? "ready"
        : "setup_required",
    models: chatModels.filter((model) => verified.modelIds.includes(model.id)),
  });
}
