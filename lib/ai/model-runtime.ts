import "server-only";
import { GROQ_BASE_URL, parseVerification } from "./groq-verification";
import { chatModels, SYNTHETIC_SDK7_FIXTURE_MODELS } from "./models";
import {
  copilotFallbackEnabled,
  HYDROGEN,
  isPremiumModel,
  isSyntheticSdk7FixtureMode,
  LUNA,
  legacyEnabled,
  NEON,
  openAIEnabled,
  vertexEnabled,
} from "./routing/catalog";
import type { Readiness } from "./routing/gateway";
import { getVertexWifAccessToken, resolveVercelOidcJwt } from "./vertex-auth";

let vertexCache:
  | { key: string; expires: number; result: Readiness }
  | undefined;

let syntheticPremiumCache:
  | { key: string; expires: number; result: Readiness }
  | undefined;

async function syntheticSdk7Availability(): Promise<Readiness> {
  if (!legacyEnabled()) {
    const empty: Readiness = {
      status: "setup_required",
      reason: "provider_opt_in_missing",
      hint: null,
      models: [],
      defaultModelId: null,
      checkedAt: null,
      unavailableModels: [],
    };
    const key = process.env.OPENAI_API_KEY?.trim() ?? "";
    if (!openAIEnabled() || key !== "synthetic-sdk7-openai-key") {
      return empty;
    }
    if (
      syntheticPremiumCache?.key === key &&
      syntheticPremiumCache.expires > Date.now()
    ) {
      return syntheticPremiumCache.result;
    }
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        return {
          ...empty,
          status: "temporarily_unavailable",
          reason: "catalog_unavailable",
        };
      }
      const body = (await response.json()) as { data?: Array<{ id: string }> };
      const listed = new Set((body.data ?? []).map((m) => m.id));
      const models = SYNTHETIC_SDK7_FIXTURE_MODELS.filter(
        (m) => isPremiumModel(m.id) && listed.has(m.id)
      );
      if (!models.some((m) => m.id === LUNA)) {
        return {
          ...empty,
          status: "temporarily_unavailable",
          reason: "catalog_unavailable",
        };
      }
      const result: Readiness = {
        status: "ready",
        reason: "ready",
        hint: null,
        models,
        defaultModelId: LUNA,
        checkedAt: new Date().toISOString(),
        unavailableModels: [],
      };
      syntheticPremiumCache = { key, expires: Date.now() + 60_000, result };
      return result;
    } catch {
      return {
        ...empty,
        status: "temporarily_unavailable",
        reason: "catalog_unavailable",
      };
    }
  }

  const verified = parseVerification(process.env.VERIFIED_GROQ_MODELS);
  const empty: Readiness = {
    status: "setup_required",
    reason: "provider_opt_in_missing",
    hint: null,
    models: [],
    defaultModelId: null,
    checkedAt: verified.checkedAt,
    unavailableModels: [],
  };
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (apiKey !== "synthetic-sdk7-provider-key" || verified.status !== "ready") {
    return empty;
  }
  try {
    const response = await fetch(`${GROQ_BASE_URL}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return {
        ...empty,
        status: "temporarily_unavailable",
        reason: "catalog_unavailable",
      };
    }
    const data = (await response.json()) as { data?: Array<{ id: string }> };
    const listed = new Set((data.data ?? []).map((m) => m.id));
    const models = SYNTHETIC_SDK7_FIXTURE_MODELS.filter(
      (m) => verified.modelIds.includes(m.id) && listed.has(m.id)
    );
    return {
      status: models.length ? "ready" : "temporarily_unavailable",
      reason: models.length ? "ready" : "catalog_unavailable",
      hint: null,
      models,
      defaultModelId:
        models.find((m) => m.id === "openai/gpt-oss-20b")?.id ??
        models[0]?.id ??
        null,
      checkedAt: verified.checkedAt,
      unavailableModels: [],
    };
  } catch {
    return {
      ...empty,
      status: "temporarily_unavailable",
      reason: "catalog_unavailable",
    };
  }
}

/**
 * Standing owner rule: NO pay-per-use models (no paid Vercel AI Gateway credits,
 * no OpenAI/Anthropic API keys, no Antigravity/ChatGPT/Claude consumer hacks).
 *
 * Chain:
 * - Default: `gemini-4-hydrogen` (Vertex AI on Ultra credit `0140A2-72DEB2-62EDCD`)
 * - Escalation: `gemini-4-neon` (Vertex AI on Ultra credit)
 * - Fallback ONLY on Vertex failure/timeout: `claude-haiku-5.5` via GitHub Copilot SDK
 *   on the Cloud VM bridge (`assistant-computer-01`).
 */
async function vertexAvailability(): Promise<Readiness> {
  const hasVertex = vertexEnabled();
  const hasCopilotFallback = copilotFallbackEnabled();

  if (!hasVertex && !hasCopilotFallback) {
    return {
      status: "setup_required",
      reason: "provider_opt_in_missing",
      hint: "Vertex AI WIF is not configured for this deployment. Set GOOGLE_VERTEX_PROJECT_ID and GOOGLE_VERTEX_WORKLOAD_AUDIENCE and redeploy.",
      models: [],
      defaultModelId: null,
      checkedAt: null,
      unavailableModels: [],
    };
  }

  const cacheKey = `vertex-wif:${hasVertex}:${hasCopilotFallback}`;
  if (vertexCache?.key === cacheKey && vertexCache.expires > Date.now()) {
    return vertexCache.result;
  }

  const tokenOk = hasVertex
    ? await getVertexWifAccessToken()
        .then(() => true)
        .catch(() => false)
    : false;

  if (!tokenOk && !hasCopilotFallback) {
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

  const vertexModels = chatModels.filter(
    (m) => m.id === HYDROGEN || m.id === NEON
  );
  const result: Readiness = {
    status: "ready",
    reason: "ready",
    hint: null,
    models: vertexModels,
    defaultModelId: HYDROGEN,
    checkedAt: new Date().toISOString(),
    unavailableModels: [],
  };
  if (tokenOk) {
    vertexCache = { key: cacheKey, expires: Date.now() + 300_000, result };
  }
  return result;
}

export function getModelAvailability() {
  if (isSyntheticSdk7FixtureMode()) {
    return syntheticSdk7Availability();
  }
  return vertexAvailability();
}

export function getRequestModelAvailability() {
  if (isSyntheticSdk7FixtureMode()) {
    if (!legacyEnabled()) {
      return syntheticSdk7Availability();
    }
    const verified = parseVerification(process.env.VERIFIED_GROQ_MODELS);
    const models = SYNTHETIC_SDK7_FIXTURE_MODELS.filter((m) =>
      verified.modelIds.includes(m.id)
    );
    return Promise.resolve({
      status:
        verified.status === "ready"
          ? ("ready" as const)
          : ("setup_required" as const),
      models,
    });
  }
  const hasVertex = vertexEnabled();
  const hasOidcJwt = hasVertex && Boolean(resolveVercelOidcJwt());
  const hasCopilot = copilotFallbackEnabled();
  if (hasOidcJwt || hasCopilot) {
    if (hasOidcJwt) {
      // Warm STS token cache asynchronously in parallel with DB reads instead of blocking preflight
      getVertexWifAccessToken().catch(() => null);
    }
    const vertexModels = chatModels.filter(
      (m) => m.id === HYDROGEN || m.id === NEON
    );
    return Promise.resolve({
      status: "ready" as const,
      reason: "ready" as const,
      hint: null,
      models: vertexModels,
      defaultModelId: HYDROGEN,
      checkedAt: new Date().toISOString(),
      unavailableModels: [],
    });
  }
  return vertexAvailability();
}
