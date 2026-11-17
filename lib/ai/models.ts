export const DEFAULT_CHAT_MODEL = "gemini-4-hydrogen";
export const ESCALATED_RESEARCH_MODEL = "gemini-4-argon";

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
};

// Standing owner rule: NO pay-per-use models (no paid AI Gateway credits,
// no OpenAI/Anthropic API keys). Only models covered by the owner's existing
// Google AI Ultra Cloud credit (`0140A2-72DEB2-62EDCD` via keyless Vertex WIF
// on GCP project `project-cd0bc64c-0025-446c-b41`) are offered in the app.
export const chatModels: ChatModel[] = [
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    provider: "google",
    description: "Default · fast ~1s responses via Vertex AI on Ultra credit",
    reasoningEffort: "low",
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    provider: "google",
    description: "Deep research & hard questions · Vertex AI on Ultra credit",
    reasoningEffort: "medium",
  },
];

export const allowedModelIds = new Set(chatModels.map((model) => model.id));

export function getCapabilities(): Record<string, ModelCapabilities> {
  const entries: [string, ModelCapabilities][] = chatModels.map((model) => [
    model.id,
    {
      tools: true,
      vision: model.provider === "google",
      reasoning: true,
    },
  ]);
  // Preserve compatibility lookup for legacy persisted message metadata tests only.
  entries.push(["gpt-6-luna", { tools: true, vision: true, reasoning: true }]);
  entries.push([
    "gpt-6.1-terra",
    { tools: true, vision: true, reasoning: true },
  ]);
  return Object.fromEntries(entries);
}
