import "server-only";
import { chatModels } from "./models";
import {
  ARGON,
  copilotFallbackEnabled,
  HYDROGEN,
  vertexEnabled,
} from "./routing/catalog";
import type { Readiness } from "./routing/gateway";
import { getVertexWifAccessToken } from "./vertex-auth";

let vertexCache:
  | { key: string; expires: number; result: Readiness }
  | undefined;

/**
 * Standing owner rule: NO pay-per-use models (no paid Vercel AI Gateway credits,
 * no OpenAI/Anthropic API keys, no Antigravity/ChatGPT/Claude consumer hacks).
 *
 * Chain:
 * - Default: `gemini-4-hydrogen` (Vertex AI on Ultra credit `0140A2-72DEB2-62EDCD`)
 * - Escalation: `gemini-4-argon` (Vertex AI on Ultra credit)
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
    (m) => m.id === HYDROGEN || m.id === ARGON
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
  // Only cache healthy Vertex WIF tokens for 5 minutes; if running degraded on
  // Copilot fallback during a WIF outage, re-probe Vertex on subsequent turns.
  if (tokenOk) {
    vertexCache = { key: cacheKey, expires: Date.now() + 300_000, result };
  }
  return result;
}

export function getModelAvailability() {
  return vertexAvailability();
}

export function getRequestModelAvailability() {
  return vertexAvailability();
}
