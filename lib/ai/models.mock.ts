import { type LanguageModel, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const mockResponses: Record<string, string> = {
  default: "This is a mock response for testing.",
  weather: "The weather in San Francisco is sunny and 72°F.",
  greeting: "Hello! How can I help you today?",
};

const mockUsage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

function getResponseForPrompt(prompt: unknown): string {
  const promptStr = JSON.stringify(prompt).toLowerCase();

  if (promptStr.includes("weather") || promptStr.includes("temperature")) {
    return mockResponses.weather;
  }
  if (
    promptStr.includes("hello") ||
    promptStr.includes("hi") ||
    promptStr.includes("hey")
  ) {
    return mockResponses.greeting;
  }

  return mockResponses.default;
}

const createMockModel = (title = false): LanguageModel =>
  new MockLanguageModelV4({
    provider: "mock",
    modelId: title ? "mock-title-model" : "mock-model",
    doGenerate: ({ prompt }) =>
      Promise.resolve({
        finishReason: { unified: "stop", raw: "stop" },
        usage: mockUsage,
        content: [
          {
            type: "text",
            text: title ? "Test conversation" : getResponseForPrompt(prompt),
          },
        ],
        warnings: [],
      }),
    doStream: ({ prompt }) =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t1" },
            {
              type: "text-delta",
              id: "t1",
              delta: title ? "Test conversation" : getResponseForPrompt(prompt),
            },
            { type: "text-end", id: "t1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: mockUsage,
            },
          ],
        }),
      }),
  });

export const chatModel = createMockModel();
export const titleModel = createMockModel(true);
