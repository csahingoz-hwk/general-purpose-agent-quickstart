import "server-only";
import { ChatbotError } from "../errors";
import { createGroqModel } from "./groq-model";
import { parseVerification } from "./groq-verification";

export function getLanguageModel(modelId: string) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const verified = parseVerification(process.env.VERIFIED_GROQ_MODELS);
  if (!apiKey || !verified.modelIds.includes(modelId)) {
    throw new ChatbotError("offline:model_setup");
  }
  // Explicit chat-completions adapter: never route to OpenAI or AI Gateway.
  return createGroqModel(apiKey, modelId);
}
