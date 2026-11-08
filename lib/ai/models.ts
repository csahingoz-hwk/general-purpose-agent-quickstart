export const DEFAULT_CHAT_MODEL = "openai/gpt-oss-20b";

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
export const chatModels: ChatModel[] = [
  {
    id: "openai/gpt-oss-20b",
    name: "Everyday chat",
    provider: "groq",
    description: "GPT OSS 20B · free-account quota applies",
    reasoningEffort: "low",
  },
  {
    id: "openai/gpt-oss-120b",
    name: "Detailed chat",
    provider: "groq",
    description: "GPT OSS 120B · free-account quota applies",
    reasoningEffort: "low",
  },
];

export const allowedModelIds = new Set(chatModels.map((model) => model.id));

export function getCapabilities(): Record<string, ModelCapabilities> {
  return Object.fromEntries(
    chatModels.map((model) => [
      model.id,
      { tools: true, vision: false, reasoning: true },
    ])
  );
}
