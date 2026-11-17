import "server-only";
import { chatModels } from "./models";
import { ARGON, HYDROGEN, vertexEnabled } from "./routing/catalog";
import type { Readiness } from "./routing/gateway";
import { getVertexWifAccessToken } from "./vertex-auth";

let vertexCache:
  | { key: string; expires: number; result: Readiness }
  | undefined;

/**
 * Standing owner rule: NO pay-per-use models (no paid Vercel AI Gateway credits,
 * no OpenAI/Anthropic API keys).
 *
 * Only Google Vertex AI via keyless Vercel OIDC -> WIF (`vercel-pool` on
 * `project-cd0bc64c-0025-446c-b41`, covered by the $40/mo Google AI Ultra credit
 * `0140A2-72DEB2-62EDCD`) is exposed:
 * - Default: `gemini-4-hydrogen`
 * - Research / hard questions: `gemini-4-argon`
 */
async function vertexAvailability(): Promise<Readiness> {
  if (!vertexEnabled()) {
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

  const cacheKey = "vertex-wif";
  if (vertexCache?.key === cacheKey && vertexCache.expires > Date.now()) {
    return vertexCache.result;
  }

  const tokenOk = await getVertexWifAccessToken()
    .then(() => true)
    .catch(() => false);

  if (!tokenOk) {
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
  vertexCache = { key: cacheKey, expires: Date.now() + 300_000, result };
  return result;
}

export function getModelAvailability() {
  return vertexAvailability();
}

export function getRequestModelAvailability() {
  return vertexAvailability();
}
