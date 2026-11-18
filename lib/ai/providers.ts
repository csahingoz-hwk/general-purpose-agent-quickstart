import "server-only";
import { ChatbotError } from "../errors";
import { createCopilotHaikuVmAdapter } from "./copilot-vm-model";
import { createGroqModel } from "./groq-model";
import { parseVerification } from "./groq-verification";
import {
  COPILOT_HAIKU,
  copilotFallbackEnabled,
  isCopilotFallbackModel,
  isOpenAIPremiumModel,
  isSyntheticSdk7FixtureMode,
  isVertexModel,
  legacyEnabled,
  openAIEnabled,
  vertexEnabled,
} from "./routing/catalog";
import { createPremiumAdapter, createRoutedModel } from "./routing/model";
import { inferenceSession } from "./routing/session";
import { createVertexGeminiAdapter } from "./vertex-model";

export function getLanguageModel(modelId: string) {
  if (isSyntheticSdk7FixtureMode()) {
    if (isOpenAIPremiumModel(modelId)) {
      const session = inferenceSession.getStore();
      const key = process.env.OPENAI_API_KEY?.trim();
      if (
        !openAIEnabled() ||
        key !== "synthetic-sdk7-openai-key" ||
        !session?.available.includes(modelId)
      ) {
        throw new ChatbotError("offline:model_setup");
      }
      return createRoutedModel(modelId, session, (id) =>
        createPremiumAdapter(key, id)
      );
    }
    if (!legacyEnabled()) {
      throw new ChatbotError("offline:model_setup");
    }
    const apiKey = process.env.GROQ_API_KEY?.trim();
    const verified = parseVerification(process.env.VERIFIED_GROQ_MODELS);
    if (
      apiKey !== "synthetic-sdk7-provider-key" ||
      !verified.modelIds.includes(modelId)
    ) {
      throw new ChatbotError("offline:model_setup");
    }
    return createGroqModel(apiKey, modelId);
  }

  // Standing owner rule: NO pay-per-use models (no paid Vercel AI Gateway
  // credits, no OpenAI/Anthropic API keys).
  // Chain: Gemini 4 Hydrogen -> Argon (escalation) -> Copilot Claude Haiku 5.5
  // (fallback ONLY on Vertex failure/timeout via Cloud VM bridge).
  if (
    !isVertexModel(modelId) ||
    (!vertexEnabled() && !copilotFallbackEnabled())
  ) {
    throw new ChatbotError("offline:model_setup");
  }
  const session = inferenceSession.getStore();
  if (
    !session?.available.includes(modelId) &&
    !session?.available.includes(COPILOT_HAIKU)
  ) {
    throw new ChatbotError("offline:model_setup");
  }
  return createRoutedModel(
    modelId,
    session,
    (id) => {
      if (isVertexModel(id)) {
        return createVertexGeminiAdapter(id);
      }
      if (isCopilotFallbackModel(id)) {
        return createCopilotHaikuVmAdapter();
      }
      throw new ChatbotError("offline:model_setup");
    },
    { gateway: false, vertexSearch: true }
  );
}
