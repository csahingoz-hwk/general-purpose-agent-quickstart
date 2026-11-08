import "server-only";
import { GROQ_BASE_URL, parseVerification } from "./groq-verification";
import { type ChatModel, chatModels, DEFAULT_CHAT_MODEL } from "./models";
import {
  gatewayCredential,
  gatewayEnabled,
  isPremiumModel,
  legacyEnabled,
  openAIEnabled,
} from "./routing/catalog";

type Ready = {
  status: "ready";
  models: ChatModel[];
  defaultModelId: string;
  checkedAt: string;
};
let premiumCache: { key: string; expires: number; result: Ready } | undefined;

export async function getModelAvailability() {
  if (!legacyEnabled()) {
    const empty = {
      status: "setup_required" as const,
      models: [],
      defaultModelId: null,
      checkedAt: null,
    };
    const useGateway = gatewayEnabled();
    if (!useGateway && !openAIEnabled()) {
      return empty;
    }
    const key = useGateway
      ? (gatewayCredential() ?? "")
      : (process.env.OPENAI_API_KEY?.trim() ?? "");
    const cacheKey = `${useGateway ? "gateway" : "openai"}:${key}`;
    if (premiumCache?.key === cacheKey && premiumCache.expires > Date.now()) {
      return premiumCache.result;
    }
    try {
      const response = await fetch(
        useGateway
          ? "https://ai-gateway.vercel.sh/v1/models"
          : "https://api.openai.com/v1/models",
        {
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        }
      );
      if (!response.ok) {
        return { ...empty, status: "temporarily_unavailable" as const };
      }
      const body = await response.json();
      const listed = new Set(
        (body.data ?? []).map((model: { id: string }) => model.id)
      );
      const models = chatModels.filter(
        (model) =>
          isPremiumModel(model.id) &&
          listed.has(useGateway ? `openai/${model.id}` : model.id)
      );
      // Luna must be available; never silently replace the default with Terra.
      if (!models.some((model) => model.id === DEFAULT_CHAT_MODEL)) {
        return { ...empty, status: "temporarily_unavailable" as const };
      }
      const result: Ready = {
        status: "ready",
        models,
        defaultModelId: DEFAULT_CHAT_MODEL,
        checkedAt: new Date().toISOString(),
      };
      premiumCache = { key: cacheKey, expires: Date.now() + 60_000, result };
      return result;
    } catch {
      return { ...empty, status: "temporarily_unavailable" as const };
    }
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
    // This is credential/model discovery, not a generation or billing operation.
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

/** Keep the verified legacy path free of per-turn catalog network I/O. */
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
