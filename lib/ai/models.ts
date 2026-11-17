export const DEFAULT_CHAT_MODEL = "gemini-4-hydrogen";
export const ESCALATED_RESEARCH_MODEL = "gemini-4-argon";
export const FALLBACK_GATEWAY_MODEL = "gpt-6.1-terra";

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
// Primary lane: Google Vertex AI via keyless Vercel OIDC -> WIF on GCP project
// `project-cd0bc64c-0025-446c-b41` (billed to 0140A2-72DEB2-62EDCD Ultra credit).
// Fallback lane: GPT-6.1 Terra via Vercel AI Gateway. Never Luna or 3.8 Flash.
export const chatModels: ChatModel[] = [
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    provider: "google",
    description: "Default · Vertex AI on Google AI Ultra credit",
    reasoningEffort: "medium",
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    provider: "google",
    description: "Deep research & hard questions · Vertex AI on Ultra credit",
    reasoningEffort: "high",
  },
  {
    id: "gpt-6.1-terra",
    name: "GPT-6.1 Terra",
    provider: "openai",
    description: "Fallback & OpenAI option · Vercel AI Gateway",
    reasoningEffort: "medium",
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
  const entries: [string, ModelCapabilities][] = chatModels.map((model) => [
    model.id,
    {
      tools: true,
      vision: model.provider === "openai" || model.provider === "google",
      reasoning: true,
    },
  ]);
  // Preserve compatibility lookup for legacy persisted message metadata tests.
  entries.push(["gpt-6-luna", { tools: true, vision: true, reasoning: true }]);
  return Object.fromEntries(entries);
}
