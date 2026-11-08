import { createOpenAI } from "@ai-sdk/openai";

export function createGroqModel(
  apiKey: string,
  modelId: string,
  fetcher: typeof fetch = fetch
) {
  return createOpenAI({
    apiKey: apiKey.trim(),
    baseURL: "https://api.groq.com/openai/v1",
    name: "groq",
    fetch: fetcher,
  }).chat(modelId);
}
