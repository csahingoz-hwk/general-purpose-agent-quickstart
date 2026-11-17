import "server-only";
import { ChatbotError } from "../errors";
import { isVertexModel, vertexEnabled } from "./routing/catalog";
import { createRoutedModel } from "./routing/model";
import { inferenceSession } from "./routing/session";
import { createVertexGeminiAdapter } from "./vertex-model";

export function getLanguageModel(modelId: string) {
  // Standing owner rule: NO pay-per-use models (no paid Vercel AI Gateway
  // credits, no OpenAI/Anthropic API keys). Only Vertex AI Gemini 4 models
  // covered by the Google AI Ultra Cloud credit (`0140A2-72DEB2-62EDCD`) run.
  if (!isVertexModel(modelId) || !vertexEnabled()) {
    throw new ChatbotError("offline:model_setup");
  }
  const session = inferenceSession.getStore();
  if (!session?.available.includes(modelId)) {
    throw new ChatbotError("offline:model_setup");
  }
  return createRoutedModel(
    modelId,
    session,
    (id) => {
      if (!isVertexModel(id)) {
        throw new ChatbotError("offline:model_setup");
      }
      return createVertexGeminiAdapter(id);
    },
    { gateway: false, vertexSearch: true }
  );
}
