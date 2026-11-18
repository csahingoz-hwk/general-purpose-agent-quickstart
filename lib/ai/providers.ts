import "server-only";
import { ChatbotError } from "../errors";
import { createCopilotHaikuVmAdapter } from "./copilot-vm-model";
import {
  COPILOT_HAIKU,
  copilotFallbackEnabled,
  isCopilotFallbackModel,
  isVertexModel,
  vertexEnabled,
} from "./routing/catalog";
import { createRoutedModel } from "./routing/model";
import { inferenceSession } from "./routing/session";
import { createVertexGeminiAdapter } from "./vertex-model";

export function getLanguageModel(modelId: string) {
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
