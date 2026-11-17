import { createGateway } from "ai";
import type { ChatModel } from "../models";
import {
  ARGON,
  gatewayEnabled,
  HYDROGEN,
  monthlyAllowance,
  type PremiumModelId,
  TERRA,
} from "./catalog";

const TERRA_COMPARISON_MODEL: ChatModel = {
  id: TERRA,
  name: "GPT-6.1 Terra",
  provider: "openai",
  description: "Pay-per-use comparison model (disabled in live app)",
  reasoningEffort: "medium",
};

export type ReadinessReason =
  | "ready"
  | "provider_opt_in_missing"
  | "spend_configuration_invalid"
  | "gateway_auth_missing"
  | "gateway_auth_rejected"
  | "catalog_unavailable"
  | "model_unavailable";

export type Readiness = {
  status: "ready" | "setup_required" | "temporarily_unavailable";
  reason: ReadinessReason;
  hint: string | null;
  models: ChatModel[];
  defaultModelId: string | null;
  checkedAt: string | null;
  unavailableModels: string[];
};

type CatalogProvider = {
  getAvailableModels(): Promise<{ models: { id: string }[] }>;
};

const HINTS: Record<Exclude<ReadinessReason, "ready">, string> = {
  provider_opt_in_missing:
    "No model lane is enabled for this deployment. Configure GOOGLE_VERTEX_PROJECT_ID + GOOGLE_VERTEX_WORKLOAD_AUDIENCE or AI_GATEWAY_USAGE_ENABLED=true and redeploy.",
  spend_configuration_invalid:
    "AI_MONTHLY_ALLOWANCE_USD must be a number above 0 and at most 10.",
  gateway_auth_missing:
    "AI Gateway is enabled but no credential reached the function. Enable OIDC for the Vercel project (or set AI_GATEWAY_API_KEY for this environment) and redeploy.",
  gateway_auth_rejected:
    "AI Gateway rejected the credential. Redeploy so a fresh OIDC token is issued, or replace AI_GATEWAY_API_KEY if one is set.",
  catalog_unavailable:
    "The AI Gateway model catalog could not be reached. This is usually temporary; try again shortly.",
  model_unavailable:
    "GPT-6.1 Terra (openai/gpt-6.1-terra) is not listed by AI Gateway for this account.",
};

/** Exact provider-prefixed slug used by AI Gateway. */
export function gatewaySlug(model: PremiumModelId | string) {
  if (model === HYDROGEN || model === ARGON) {
    return `google/${model}`;
  }
  return `openai/${model}`;
}

function notReady(
  reason: Exclude<ReadinessReason, "ready">,
  unavailableModels: string[] = []
): Readiness {
  return {
    status:
      reason === "catalog_unavailable" || reason === "model_unavailable"
        ? "temporarily_unavailable"
        : "setup_required",
    reason,
    hint: HINTS[reason],
    models: [],
    defaultModelId: null,
    checkedAt: null,
    unavailableModels,
  };
}

export function classifyGatewayFailure(
  error: unknown
): Exclude<
  ReadinessReason,
  "ready" | "provider_opt_in_missing" | "spend_configuration_invalid"
> {
  const e = error as {
    name?: string;
    statusCode?: number;
    cause?: { statusCode?: number } | null;
  } | null;
  if (e?.name === "GatewayAuthenticationError") {
    return typeof e.cause?.statusCode === "number"
      ? "gateway_auth_rejected"
      : "gateway_auth_missing";
  }
  if (e?.statusCode === 401 || e?.statusCode === 403) {
    return "gateway_auth_rejected";
  }
  return "catalog_unavailable";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(new Error("catalog_timeout"), { name: "TimeoutError" })
      );
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Establish readiness for the Gateway fallback lane (`openai/gpt-6.1-terra`).
 * Note: Google Gemini 4 models (`gemini-4-hydrogen`, `gemini-4-argon`) run on
 * Vertex AI via WIF (not Gateway) in production so they bill to the Google AI
 * Ultra Cloud credit (`0140A2-72DEB2-62EDCD`).
 */
export async function discoverGatewayReadiness({
  provider,
  timeoutMs = 8000,
  now = () => new Date(),
}: {
  provider?: CatalogProvider;
  timeoutMs?: number;
  now?: () => Date;
} = {}): Promise<Readiness> {
  if (!gatewayEnabled()) {
    return notReady("provider_opt_in_missing");
  }
  try {
    monthlyAllowance();
  } catch {
    return notReady("spend_configuration_invalid");
  }
  let listed: Set<string>;
  try {
    const catalog = await withTimeout(
      (provider ?? createGateway()).getAvailableModels(),
      timeoutMs
    );
    listed = new Set(catalog.models.map((model) => model.id));
  } catch (error) {
    return notReady(classifyGatewayFailure(error));
  }

  // Retained strictly for offline benchmark/readiness unit tests; live app
  // disables AI_GATEWAY_USAGE_ENABLED under the zero pay-per-use rule.
  const gatewayCandidates = [TERRA_COMPARISON_MODEL];
  const models = gatewayCandidates.filter((model) =>
    listed.has(gatewaySlug(model.id))
  );
  const unavailableModels = gatewayCandidates
    .filter((model) => !listed.has(gatewaySlug(model.id)))
    .map((model) => gatewaySlug(model.id));

  if (!models.some((model) => model.id === TERRA)) {
    return notReady("model_unavailable", unavailableModels);
  }
  return {
    status: "ready",
    reason: "ready",
    hint: null,
    models,
    defaultModelId: TERRA,
    checkedAt: now().toISOString(),
    unavailableModels,
  };
}
