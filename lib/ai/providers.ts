import "server-only";
import { ChatbotError } from "../errors";
import { createGroqModel } from "./groq-model";
import { parseVerification } from "./groq-verification";
import {
  gatewayEnabled,
  isPremiumModel,
  isVertexModel,
  legacyEnabled,
  openAIEnabled,
  vertexEnabled,
} from "./routing/catalog";
import {
  createGatewayAdapter,
  createPremiumAdapter,
  createRoutedModel,
} from "./routing/model";
import { inferenceSession } from "./routing/session";
import { createVertexGeminiAdapter } from "./vertex-model";

export function getLanguageModel(modelId: string) {
  if (isPremiumModel(modelId)) {
    const session = inferenceSession.getStore();
    if (!session?.available.includes(modelId)) {
      throw new ChatbotError("offline:model_setup");
    }
    const useVertex = vertexEnabled();
    const useGateway = gatewayEnabled();
    return createRoutedModel(
      modelId,
      session,
      (id) => {
        // Google Gemini 4 models ALWAYS execute via zero-key Vertex WIF on
        // GCP project `project-cd0bc64c-0025-446c-b41` (`0140A2-72DEB2-62EDCD`
        // Google AI Ultra credit), NEVER via AI Studio key or paid AI Gateway.
        if (isVertexModel(id)) {
          if (!useVertex) {
            throw new ChatbotError("offline:model_setup");
          }
          return createVertexGeminiAdapter(id);
        }
        // Fallback model (`gpt-6.1-terra`) executes via Vercel AI Gateway (or OpenAI).
        if (useGateway) {
          return createGatewayAdapter(id);
        }
        const key = process.env.OPENAI_API_KEY?.trim();
        if (!openAIEnabled() || !key) {
          throw new ChatbotError("offline:model_setup");
        }
        return createPremiumAdapter(key, id);
      },
      { gateway: useGateway, vertexSearch: useVertex }
    );
  }
  if (!legacyEnabled()) {
    throw new ChatbotError("offline:model_setup");
  }
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const verified = parseVerification(process.env.VERIFIED_GROQ_MODELS);
  if (!apiKey || !verified.modelIds.includes(modelId)) {
    throw new ChatbotError("offline:model_setup");
  }
  return createGroqModel(apiKey, modelId);
}
