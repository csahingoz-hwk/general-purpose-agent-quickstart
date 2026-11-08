import { estimateModelTokens } from "./context/budget";

/** Nested artifact calls must obey the same provider/privacy policy as chat. */
export function artifactSettings(
  instructions: string,
  prompt: string,
  signal?: AbortSignal
) {
  if (estimateModelTokens({ instructions, prompt }) + 768 + 350 > 3400) {
    throw new Error("chat_context_budget");
  }
  return {
    instructions,
    prompt,
    maxOutputTokens: 768,
    maxRetries: 0,
    abortSignal: AbortSignal.any([
      AbortSignal.timeout(30_000),
      ...(signal ? [signal] : []),
    ]),
    providerOptions: { openai: { reasoningEffort: "low" } },
    telemetry: { recordInputs: false, recordOutputs: false },
  };
}
