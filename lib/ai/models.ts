export const DEFAULT_CHAT_MODEL = "gemini-4-hydrogen";
export const ESCALATED_RESEARCH_MODEL = "gemini-4-argon";
export const FALLBACK_CHAT_MODEL = "claude-haiku-5.5";

export const REGISTERED_APP_MODEL_IDS = [
  DEFAULT_CHAT_MODEL,
  ESCALATED_RESEARCH_MODEL,
  FALLBACK_CHAT_MODEL,
] as const;

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
// no OpenAI/Anthropic API keys). Primary chat runs on Google AI Ultra credit
// (`0140A2-72DEB2-62EDCD` via keyless Vertex WIF); automatic fallback on Vertex
// failure/timeout runs ONLY on GitHub Copilot SDK (`claude-haiku-5.5`) via the
// Cloud VM bridge.
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

// Hermetic CI wire-fixture candidates ONLY (`tests/sdk7/provider-fixture.ts`).
// Never exposed when `isSyntheticSdk7FixtureMode()` is false.
export const SYNTHETIC_SDK7_FIXTURE_MODELS: ChatModel[] = [
  {
    id: "gpt-6-luna",
    name: "Everyday chat",
    provider: "openai",
    description: "GPT-6 Luna · economical bilingual conversation",
    reasoningEffort: "low",
  },
  {
    id: "gpt-6.1-terra",
    name: "Detailed chat",
    provider: "openai",
    description: "GPT-6.1 Terra · deeper thinking when needed",
    reasoningEffort: "medium",
  },
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

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "gemini-4-hydrogen": "Gemini 4 Hydrogen",
  "gemini-4-argon": "Gemini 4 Argon",
  "claude-haiku-5.5": "Claude Haiku 5.5",
  "claude-haiku-4.5": "Claude Haiku 4.5",
};

export function getModelDisplayName(modelId: string): string {
  return MODEL_DISPLAY_NAMES[modelId] ?? modelId;
}

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
  entries.push([
    FALLBACK_CHAT_MODEL,
    { tools: true, vision: true, reasoning: false },
  ]);
  // Preserve compatibility lookup for legacy persisted message metadata & CI wire-fixture tests only.
  entries.push(["gpt-6-luna", { tools: true, vision: true, reasoning: true }]);
  entries.push([
    "gpt-6.1-terra",
    { tools: true, vision: true, reasoning: true },
  ]);
  entries.push([
    "openai/gpt-oss-20b",
    { tools: true, vision: false, reasoning: true },
  ]);
  entries.push([
    "openai/gpt-oss-120b",
    { tools: true, vision: false, reasoning: true },
  ]);
  return Object.fromEntries(entries);
}
