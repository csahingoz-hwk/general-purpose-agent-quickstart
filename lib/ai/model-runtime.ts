import "server-only";
import { GROQ_BASE_URL, parseVerification } from "./groq-verification";
import { chatModels, DEFAULT_CHAT_MODEL } from "./models";

export async function getModelAvailability() {
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
