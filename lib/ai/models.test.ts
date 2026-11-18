import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { getResponseChunksByPrompt } from "@/tests/prompts/utils";

const mockUsage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

const mockFinishReason = { unified: "stop" as const, raw: undefined };

const mockGenerateResult: LanguageModelV4GenerateResult = {
  finishReason: mockFinishReason,
  usage: mockUsage,
  content: [{ type: "text", text: "Hello, world!" }],
  warnings: [],
};

const titleGenerateResult: LanguageModelV4GenerateResult = {
  finishReason: mockFinishReason,
  usage: mockUsage,
  content: [{ type: "text", text: "This is a test title" }],
  warnings: [],
};

export const chatModel = new MockLanguageModelV4({
  doGenerate: mockGenerateResult,
  doStream: async ({ prompt }) => ({
    stream: simulateReadableStream({
      chunkDelayInMs: 500,
      initialDelayInMs: 1000,
      chunks: getResponseChunksByPrompt(prompt),
    }),
  }),
});

export const reasoningModel = new MockLanguageModelV4({
  doGenerate: mockGenerateResult,
  doStream: async ({ prompt }) => ({
    stream: simulateReadableStream({
      chunkDelayInMs: 500,
      initialDelayInMs: 1000,
      chunks: getResponseChunksByPrompt(prompt, true),
    }),
  }),
});

export const titleModel = new MockLanguageModelV4({
  doGenerate: titleGenerateResult,
  doStream: async () => ({
    stream: simulateReadableStream({
      chunkDelayInMs: 500,
      initialDelayInMs: 1000,
      chunks: [
        { id: "1", type: "text-start" as const },
        { id: "1", type: "text-delta" as const, delta: "This is a test title" },
        { id: "1", type: "text-end" as const },
        {
          type: "finish" as const,
          finishReason: mockFinishReason,
          usage: mockUsage,
        },
      ],
    }),
  }),
});
