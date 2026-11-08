import "server-only";
import { ChatbotError } from "../errors";
import { createGroqModel } from "./groq-model";
import { parseVerification } from "./groq-verification";
import {
  gatewayCredential,
  gatewayEnabled,
  isPremiumModel,
  legacyEnabled,
  openAIEnabled,
} from "./routing/catalog";
import {
  createGatewayAdapter,
  createPremiumAdapter,
  createRoutedModel,
} from "./routing/model";
import { inferenceSession } from "./routing/session";

export function getLanguageModel(modelId: string) {
  if (isPremiumModel(modelId)) {
    const session = inferenceSession.getStore();
    if (!session?.available.includes(modelId)) {
      throw new ChatbotError("offline:model_setup");
    }
    const gatewayKey = gatewayCredential();
    if (gatewayEnabled() && gatewayKey) {
      return createRoutedModel(modelId, session, (id) =>
        createGatewayAdapter(gatewayKey, id)
      );
    }
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!openAIEnabled() || !key) {
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
  if (!apiKey || !verified.modelIds.includes(modelId)) {
    throw new ChatbotError("offline:model_setup");
  }
  // Explicit chat-completions adapter: never route to OpenAI or AI Gateway.
  return createGroqModel(apiKey, modelId);
}
