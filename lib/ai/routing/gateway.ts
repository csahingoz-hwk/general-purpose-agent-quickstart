import { createGateway } from "ai";
import { type ChatModel, chatModels } from "../models";
import {
  gatewayEnabled,
  HYDROGEN,
  isPremiumModel,
  monthlyAllowance,
  type PremiumModelId,
  TERRA,
} from "./catalog";

/**
 * AI Gateway readiness, built on the native AI SDK Gateway provider.
 *
 * Authentication is resolved by the provider itself, in this order: an explicit
 * apiKey, AI_GATEWAY_API_KEY, then the Vercel OIDC token (the
 * `x-vercel-oidc-token` request header on Vercel deployments, or
 * VERCEL_OIDC_TOKEN locally). This module never reads or stores a credential.
 */

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
  /** Safe, actionable text for the owner. Never contains secrets or raw upstream bodies. */
  hint: string | null;
  models: ChatModel[];
  defaultModelId: string | null;
  checkedAt: string | null;
  /** Public model slugs the catalog did not list (e.g. Terra missing while Luna is ready). */
  unavailableModels: string[];
};

type CatalogProvider = {
  getAvailableModels(): Promise<{ models: { id: string }[] }>;
};

const HINTS: Record<Exclude<ReadinessReason, "ready">, string> = {
  provider_opt_in_missing:
    "No paid model lane is enabled for this deployment. Set AI_GATEWAY_USAGE_ENABLED=true for this Preview environment and redeploy.",
  spend_configuration_invalid:
    "AI_MONTHLY_ALLOWANCE_USD must be a number above 0 and at most 10.",
  gateway_auth_missing:
    "AI Gateway is enabled but no credential reached the function. Enable OIDC for the Vercel project (or set AI_GATEWAY_API_KEY for this environment) and redeploy.",
  gateway_auth_rejected:
    "AI Gateway rejected the credential. Redeploy so a fresh OIDC token is issued, or replace AI_GATEWAY_API_KEY if one is set.",
  catalog_unavailable:
    "The AI Gateway model catalog could not be reached. This is usually temporary; try again shortly.",
  model_unavailable:
    "Neither openai/gpt-6.1-terra nor google/gemini-4-hydrogen is listed by AI Gateway for this account.",
};

/** Exact provider-prefixed slug used by AI Gateway. */
export function gatewaySlug(model: PremiumModelId | string) {
  if (model === HYDROGEN) {
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

/** Map a native Gateway/AI SDK failure to a safe reason. Raw messages are never returned. */
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
    // The SDK words every catalog 401 as "No authentication provided", so the
    // message cannot tell the cases apart. A failure raised while resolving the
    // credential locally has no HTTP status on its cause; a server rejection does.
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
 * Establish readiness for the Gateway lane. Returns "ready" only after an
 * authenticated catalog call succeeded and listed the default model; nothing
 * here is mocked, hardcoded or inferred from environment variables.
 */
export async function discoverGatewayReadiness({
  provider,
  timeoutMs = 8000,
  now = () => new Date(),
}: {
  /** Injectable for tests. Production builds a fresh native provider per check. */
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
    // A fresh provider per check avoids the SDK's stale-while-revalidate catalog
    // cache and any cached failure; successes are cached by the caller.
    const catalog = await withTimeout(
      (provider ?? createGateway()).getAvailableModels(),
      timeoutMs
    );
    listed = new Set(catalog.models.map((model) => model.id));
  } catch (error) {
    return notReady(classifyGatewayFailure(error));
  }
  const models = chatModels.filter(
    (model) => isPremiumModel(model.id) && listed.has(gatewaySlug(model.id))
  );
  const unavailableModels = chatModels
    .filter(
      (model) => isPremiumModel(model.id) && !listed.has(gatewaySlug(model.id))
    )
    .map((model) => gatewaySlug(model.id));
  // Owner floor: default to GPT-6.1 Terra, or Gemini 4 Hydrogen if Terra is not
  // listed on the Gateway. Never promote GPT-6 Luna to default.
  const resolvedDefault = models.some((model) => model.id === TERRA)
    ? TERRA
    : models.some((model) => model.id === HYDROGEN)
      ? HYDROGEN
      : null;
  if (!resolvedDefault) {
    return notReady("model_unavailable", unavailableModels);
  }
  return {
    status: "ready",
    reason: "ready",
    hint: null,
    models,
    defaultModelId: resolvedDefault,
    checkedAt: now().toISOString(),
    unavailableModels,
  };
}
