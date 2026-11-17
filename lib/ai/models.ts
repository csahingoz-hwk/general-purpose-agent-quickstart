export const DEFAULT_CHAT_MODEL = "gpt-6.1-terra";
export const FALLBACK_FLOOR_MODEL = "gemini-4-hydrogen";

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

// Candidates, not an availability assertion. Only verified IDs reach the UI.
// Owner floor: minimum GPT-6.1 Terra or Gemini 4 Hydrogen by default.
// GPT-6 Luna is kept solely for explicit manual selection by hand.
export const chatModels: ChatModel[] = [
  {
    id: "gpt-6.1-terra",
    name: "GPT-6.1 Terra",
    provider: "openai",
    description: "Default · deep reasoning, tools & web research",
    reasoningEffort: "medium",
  },
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    provider: "google",
    description: "Fast multimodal reasoning · floor tier",
    reasoningEffort: "medium",
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    provider: "openai",
    description: "Manual light option · low effort (research auto-escalates)",
    reasoningEffort: "low",
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    provider: "groq",
    description: "Legacy Groq · free-account quota applies",
    reasoningEffort: "low",
  },
  {
    id: "openai/gpt-oss-20b",
    name: "GPT OSS 20B",
    provider: "groq",
    description: "Legacy Groq · free-account quota applies",
    reasoningEffort: "low",
  },
];

export const allowedModelIds = new Set(chatModels.map((model) => model.id));

export function getCapabilities(): Record<string, ModelCapabilities> {
  return Object.fromEntries(
    chatModels.map((model) => [
      model.id,
      {
        tools: true,
        vision: model.provider === "openai" || model.provider === "google",
        reasoning: true,
      },
    ])
  );
}
